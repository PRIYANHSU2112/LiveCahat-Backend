import { razorpayInstance, verifyWebhookSignature } from '../config/razorpay.config.js';
import PaymentTransaction from '../modules/payment-transaction.model.js';
import CoinTransaction from '../modules/coin-transaction.model.js';
import Wallet from '../modules/wallet.model.js';
import coinPackRepository from '../repositories/coin-pack.repository.js';
import ApiError from '../utils/ApiError.js';
import mongoose from 'mongoose';

class PaymentService {
  /**
   * Initialize a Coin Pack Purchase
   */
  async createCoinPackOrder(userId, coinPackId) {
    // 1. Fetch the coin pack
    const coinPack = await coinPackRepository.findById(coinPackId);
    if (!coinPack || !coinPack.isActive) {
      throw new ApiError(404, 'Coin pack not found or inactive');
    }

    // 2. Create Razorpay Order
    // Razorpay amount is in paise (₹1 = 100 paise)
    const options = {
      amount: Math.round(coinPack.price * 100),
      currency: 'INR',
      receipt: `rcpt_${userId}_${Date.now()}`
    };

    const order = await razorpayInstance.orders.create(options);

    // 3. Create Pending Payment Transaction
    const transaction = await PaymentTransaction.create({
      userId,
      coinPackId,
      amount: coinPack.price,
      currency: 'INR',
      paymentGateway: 'RAZORPAY',
      OrderId: order.id,
      status: 'PENDING'
    });

    return {
      transactionId: transaction._id,
      razorpayOrderId: order.id,
      amount: order.amount,
      currency: order.currency,
      coinPack
    };
  }

  /**
   * Handle Razorpay Webhook
   */
  async handleRazorpayWebhook(payload, signature, secret) {
    // 1. Verify Signature
    if (!verifyWebhookSignature(payload, signature, secret)) {
      throw new ApiError(400, 'Invalid webhook signature');
    }

    const event = JSON.parse(payload);

    if (event.event !== 'payment.captured') {
      return { status: 'ignored', reason: `Unhandled event type: ${event.event}` };
    }

    const paymentData = event.payload.payment.entity;
    const orderId = paymentData.order_id;
    const paymentId = paymentData.id;

    // Run within a transaction for ledger safety
    const session = await mongoose.startSession();
    session.startTransaction();

    try {
      // 2. Fetch Payment Transaction
      const transaction = await PaymentTransaction.findOne({ OrderId: orderId }).session(session);
      
      if (!transaction) {
        throw new Error(`Transaction with orderId ${orderId} not found`);
      }

      if (transaction.status === 'SUCCESS') {
        await session.abortTransaction();
        session.endSession();
        return { status: 'already_processed' };
      }

      // 3. Update Transaction to Success
      transaction.status = 'SUCCESS';
      transaction.gatewayTransactionId = paymentId;
      transaction.metadata = paymentData;
      await transaction.save({ session });

      // 4. Fetch the Coin Pack to know how many coins to add
      const coinPack = await coinPackRepository.findById(transaction.coinPackId);
      if (!coinPack) {
        throw new Error('Associated coin pack not found');
      }

      // 5. Update or Create Wallet
      let wallet = await Wallet.findOne({ userId: transaction.userId }).session(session);
      if (!wallet) {
        wallet = new Wallet({
          userId: transaction.userId,
          coinBalance: 0,
          totalRecharge: 0,
        });
      }

      const coinsToAdd = coinPack.coins;
      wallet.coinBalance += coinsToAdd;
      wallet.totalRecharge += transaction.amount;
      await wallet.save({ session });

      // 6. Create Coin Transaction (Ledger entry)
      await CoinTransaction.create([{
        userId: transaction.userId,
        type: 'CREDIT',
        amount: coinsToAdd,
        balanceAfter: wallet.coinBalance,
        referenceType: 'PURCHASE',
        referenceId: transaction._id,
        description: `Purchased ${coinsToAdd} coins via pack ${coinPack.name}`
      }], { session });

      // Commit
      await session.commitTransaction();
      session.endSession();

      return { status: 'success', coinsAdded: coinsToAdd };
    } catch (error) {
      await session.abortTransaction();
      session.endSession();
      throw error;
    }
  }
}

export const paymentService = new PaymentService();
