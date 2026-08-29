import admin from 'firebase-admin';
import fs from 'fs';
import path from 'path';
import config from './index.js';
import logger from '../utils/logger.util.js';

let firebaseApp = null;
let messaging = null;

export const initializeFirebase = () => {
  if (firebaseApp) {
    return { app: firebaseApp, messaging };
  }

  try {
    if (admin.apps.length > 0) {
      firebaseApp = admin.app();
      messaging = admin.messaging(firebaseApp);
      return { app: firebaseApp, messaging };
    }

    let credential = null;
    const serviceAccountPath =
      config.firebase?.serviceAccountPath || './src/config/firebase-service-account.json';
    const resolvedPath = path.resolve(process.cwd(), serviceAccountPath);

    if (fs.existsSync(resolvedPath)) {
      const fileContent = JSON.parse(fs.readFileSync(resolvedPath, 'utf8'));
      credential = admin.credential.cert(fileContent);
      logger.info(`[Firebase] Initialized using service account file at: ${resolvedPath}`);
    } else if (config.firebase?.clientEmail && config.firebase?.privateKey) {
      credential = admin.credential.cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      });
      logger.info(
        `[Firebase] Initialized using environment credentials for project: ${config.firebase.projectId}`
      );
    }

    if (credential) {
      firebaseApp = admin.initializeApp({
        credential,
        projectId: config.firebase?.projectId || undefined,
      });
      messaging = admin.messaging(firebaseApp);
      logger.info('[Firebase] Firebase Admin SDK initialized successfully');
    } else {
      logger.warn('[Firebase] No valid Firebase credentials found. Push notifications will be disabled.');
    }
  } catch (error) {
    logger.error(`[Firebase] Failed to initialize Firebase Admin SDK: ${error.message}`);
  }

  return { app: firebaseApp, messaging };
};

export const getMessaging = () => {
  if (!messaging) {
    const initialized = initializeFirebase();
    return initialized.messaging;
  }
  return messaging;
};

export { admin };
export default { initializeFirebase, getMessaging, admin };
