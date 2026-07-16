import settingsRuntime from '../services/settings-runtime.service.js';

/**
 * Memory-only maintenance gate for public customer auth endpoints.
 * Admin/agent email login is never blocked.
 */
export const checkMaintenanceMode = (req, res, next) => {
  if (!settingsRuntime.isMaintenanceMode()) {
    return next();
  }

  // Allow admin/agent password login and authenticated admin traffic
  if (req.path === '/login' || req.originalUrl?.includes('/auth/login')) {
    return next();
  }

  return res.status(503).json({
    success: false,
    message: 'Platform is under maintenance. Please try again later.',
    data: null,
  });
};

/**
 * Block new customer/listener OTP registration when registrations are disabled.
 * Memory-only — safe for edge auth routes.
 */
export const checkRegistrationsAllowed = (req, res, next) => {
  if (settingsRuntime.allowRegistrations()) {
    return next();
  }

  return res.status(403).json({
    success: false,
    message: 'New registrations are currently disabled.',
    data: null,
  });
};
