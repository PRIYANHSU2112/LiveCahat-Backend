import PlatformSettings from '../modules/platform-settings.model.js';
import settingsRuntime from './settings-runtime.service.js';
import auditLogService from './audit-log.service.js';
import { DEFAULT_PLATFORM_SETTINGS } from '../constants/settings.constant.js';

class PlatformSettingsService {
  async getSettings() {
    let doc = await PlatformSettings.findOne().lean();
    if (!doc) {
      doc = (await PlatformSettings.create({})).toObject();
      await settingsRuntime.persistPlatformToRedis(doc);
    }
    return this.#publicView(doc);
  }

  async updateSettings(data, actor = null, reqMeta = {}) {
    const before = await this.getSettings();

    const allowed = {};
    if (typeof data.maintenanceMode === 'boolean') allowed.maintenanceMode = data.maintenanceMode;
    if (typeof data.allowRegistrations === 'boolean') allowed.allowRegistrations = data.allowRegistrations;
    if (typeof data.defaultLanguage === 'string') allowed.defaultLanguage = data.defaultLanguage.trim();
    if (data.featureFlags && typeof data.featureFlags === 'object' && !Array.isArray(data.featureFlags)) {
      allowed.featureFlags = data.featureFlags;
    }

    const doc = await PlatformSettings.findOneAndUpdate(
      {},
      { $set: allowed },
      { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
    ).lean();

    await settingsRuntime.clearPlatformRedis();
    await settingsRuntime.persistPlatformToRedis(doc);
    await settingsRuntime.publishInvalidate('platform_settings');

    const after = this.#publicView(doc);

    auditLogService.record({
      actor,
      action: 'PLATFORM_SETTINGS_UPDATE',
      resource: 'PlatformSettings',
      resourceId: doc._id,
      permission: 'platform_settings.update',
      ip: reqMeta.ip,
      userAgent: reqMeta.userAgent,
      meta: { before, after },
    });

    return after;
  }

  #publicView(doc) {
    return {
      maintenanceMode: Boolean(doc?.maintenanceMode ?? DEFAULT_PLATFORM_SETTINGS.maintenanceMode),
      allowRegistrations: doc?.allowRegistrations !== false,
      defaultLanguage: doc?.defaultLanguage || DEFAULT_PLATFORM_SETTINGS.defaultLanguage,
      featureFlags:
        doc?.featureFlags && typeof doc.featureFlags === 'object' ? doc.featureFlags : {},
      updatedAt: doc?.updatedAt || null,
    };
  }
}

export default new PlatformSettingsService();
