import mongoose from 'mongoose';
import PaymentGateway from '../modules/payment-gateway.model.js';
import settingsRuntime from './settings-runtime.service.js';
import auditLogService from './audit-log.service.js';
import { encryptSecret, maskSecretLast4, canEncryptSecrets } from '../utils/settings-crypto.util.js';
import ApiError from '../utils/ApiError.js';

class PaymentGatewayService {
  async list() {
    const docs = await PaymentGateway.find({ isDeleted: false }).sort({ provider: 1 }).lean();
    return docs.map((d) => this.#toPublic(d));
  }

  async getById(id) {
    const doc = await PaymentGateway.findOne({ _id: id, isDeleted: false }).lean();
    if (!doc) throw new ApiError(404, 'Payment gateway not found');
    return this.#toPublic(doc);
  }

  async create(data, actor = null, reqMeta = {}) {
    const provider = String(data.provider || '').toUpperCase();
    const existing = await PaymentGateway.findOne({ provider, isDeleted: false }).lean();
    if (existing) throw new ApiError(409, `Gateway ${provider} already exists`);

    if ((data.secret || data.webhookSecret) && !canEncryptSecrets()) {
      throw new ApiError(500, 'Cannot store secrets: SETTINGS_ENCRYPTION_KEY is not configured.');
    }

    const payload = {
      provider,
      displayName: data.displayName || provider,
      mode: data.mode || 'sandbox',
      isEnabled: Boolean(data.isEnabled),
      isDefault: Boolean(data.isDefault),
      publicKey: data.publicKey || '',
      merchantId: data.merchantId || '',
      config: data.config && typeof data.config === 'object' ? data.config : {},
    };

    if (data.secret) {
      payload.secretEncrypted = encryptSecret(data.secret);
      payload.secretLast4 = maskSecretLast4(data.secret);
    }
    if (data.webhookSecret) {
      payload.webhookSecretEncrypted = encryptSecret(data.webhookSecret);
      payload.webhookSecretLast4 = maskSecretLast4(data.webhookSecret);
    }

    if (payload.isDefault) {
      await PaymentGateway.updateMany({ isDeleted: false }, { $set: { isDefault: false } });
      payload.isEnabled = true;
    }

    const doc = await PaymentGateway.create(payload);
    await this.#refreshRuntime();

    const publicDoc = this.#toPublic(doc.toObject());
    auditLogService.record({
      actor,
      action: 'PAYMENT_GATEWAY_CREATE',
      resource: 'PaymentGateway',
      resourceId: doc._id,
      permission: 'payment_gateway.create',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      meta: { after: this.#sanitizeAudit(publicDoc) },
    });

    return publicDoc;
  }

  async update(id, data, actor = null, reqMeta = {}) {
    const doc = await PaymentGateway.findOne({ _id: id, isDeleted: false });
    if (!doc) throw new ApiError(404, 'Payment gateway not found');

    const before = this.#toPublic(doc.toObject());

    if ((data.secret || data.webhookSecret) && !canEncryptSecrets()) {
      throw new ApiError(500, 'Cannot store secrets: SETTINGS_ENCRYPTION_KEY is not configured.');
    }

    if (data.displayName != null) doc.displayName = data.displayName;
    if (data.mode != null) doc.mode = data.mode;
    if (typeof data.isEnabled === 'boolean') doc.isEnabled = data.isEnabled;
    if (data.publicKey != null) doc.publicKey = data.publicKey;
    if (data.merchantId != null) doc.merchantId = data.merchantId;
    if (data.config && typeof data.config === 'object') doc.config = data.config;

    if (data.secret) {
      doc.secretEncrypted = encryptSecret(data.secret);
      doc.secretLast4 = maskSecretLast4(data.secret);
    }
    if (data.webhookSecret) {
      doc.webhookSecretEncrypted = encryptSecret(data.webhookSecret);
      doc.webhookSecretLast4 = maskSecretLast4(data.webhookSecret);
    }

    if (data.isDefault === true) {
      await PaymentGateway.updateMany(
        { _id: { $ne: doc._id }, isDeleted: false },
        { $set: { isDefault: false } }
      );
      doc.isDefault = true;
      doc.isEnabled = true;
    } else if (data.isDefault === false) {
      doc.isDefault = false;
    }

    if (doc.isDefault && doc.isEnabled === false) {
      throw new ApiError(400, 'Cannot disable the default payment gateway. Assign another default first.');
    }

    await doc.save();
    await this.#refreshRuntime();

    const after = this.#toPublic(doc.toObject());
    auditLogService.record({
      actor,
      action: 'PAYMENT_GATEWAY_UPDATE',
      resource: 'PaymentGateway',
      resourceId: doc._id,
      permission: 'payment_gateway.update',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      meta: { before: this.#sanitizeAudit(before), after: this.#sanitizeAudit(after) },
    });

    return after;
  }

  async setDefault(id, actor = null, reqMeta = {}) {
    const session = await mongoose.startSession();
    session.startTransaction();
    try {
      const doc = await PaymentGateway.findOne({ _id: id, isDeleted: false }).session(session);
      if (!doc) throw new ApiError(404, 'Payment gateway not found');

      await PaymentGateway.updateMany(
        { isDeleted: false },
        { $set: { isDefault: false } },
        { session }
      );
      doc.isDefault = true;
      doc.isEnabled = true;
      await doc.save({ session });

      await session.commitTransaction();
      session.endSession();

      await this.#refreshRuntime();
      const after = this.#toPublic(doc.toObject());

      auditLogService.record({
        actor,
        action: 'PAYMENT_GATEWAY_SET_DEFAULT',
        resource: 'PaymentGateway',
        resourceId: doc._id,
        permission: 'payment_gateway.update',
        ip: reqMeta.ip,
        userAgent: reqMeta.userAgent,
        meta: { after: this.#sanitizeAudit(after) },
      });

      return after;
    } catch (err) {
      await session.abortTransaction();
      session.endSession();
      throw err;
    }
  }

  async setStatus(id, isEnabled, actor = null, reqMeta = {}) {
    const doc = await PaymentGateway.findOne({ _id: id, isDeleted: false });
    if (!doc) throw new ApiError(404, 'Payment gateway not found');

    if (doc.isDefault && isEnabled === false) {
      throw new ApiError(400, 'Cannot disable the default payment gateway. Assign another default first.');
    }

    doc.isEnabled = Boolean(isEnabled);
    await doc.save();
    await this.#refreshRuntime();

    const after = this.#toPublic(doc.toObject());
    auditLogService.record({
      actor,
      action: 'PAYMENT_GATEWAY_STATUS',
      resource: 'PaymentGateway',
      resourceId: doc._id,
      permission: 'payment_gateway.update',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      meta: { isEnabled: after.isEnabled, provider: after.provider },
    });

    return after;
  }

  async remove(id, actor = null, reqMeta = {}) {
    const doc = await PaymentGateway.findOne({ _id: id, isDeleted: false });
    if (!doc) throw new ApiError(404, 'Payment gateway not found');
    if (doc.isDefault) {
      throw new ApiError(400, 'Cannot delete the default payment gateway. Assign another default first.');
    }

    doc.isDeleted = true;
    doc.isEnabled = false;
    doc.isDefault = false;
    await doc.save();
    await this.#refreshRuntime();

    auditLogService.record({
      actor,
      action: 'PAYMENT_GATEWAY_DELETE',
      resource: 'PaymentGateway',
      resourceId: doc._id,
      permission: 'payment_gateway.delete',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      meta: { provider: doc.provider },
    });

    return { deleted: true, id: doc._id };
  }

  async #refreshRuntime() {
    const docs = await PaymentGateway.find({ isDeleted: false }).lean();
    await settingsRuntime.clearGatewaysRedis();
    await settingsRuntime.persistGatewaysToRedis(docs);
    await settingsRuntime.publishInvalidate('payment_gateways');
  }

  #toPublic(doc) {
    return {
      _id: doc._id,
      provider: doc.provider,
      displayName: doc.displayName,
      mode: doc.mode,
      isEnabled: Boolean(doc.isEnabled),
      isDefault: Boolean(doc.isDefault),
      publicKey: doc.publicKey || '',
      merchantId: doc.merchantId || '',
      hasSecret: Boolean(doc.secretEncrypted?.ciphertext),
      hasWebhookSecret: Boolean(doc.webhookSecretEncrypted?.ciphertext),
      secretLast4: doc.secretLast4 || null,
      webhookSecretLast4: doc.webhookSecretLast4 || null,
      config: doc.config || {},
      createdAt: doc.createdAt,
      updatedAt: doc.updatedAt,
    };
  }

  #sanitizeAudit(view) {
    if (!view) return view;
    const { hasSecret, hasWebhookSecret, secretLast4, webhookSecretLast4, ...rest } = view;
    return { ...rest, hasSecret, hasWebhookSecret, secretLast4, webhookSecretLast4 };
  }
}

export default new PaymentGatewayService();
