import monitoringService from './monitoring.service.js';

class MonitoringController {
  async getMetricsSummary(req, res, next) {
    try {
      const data = await monitoringService.getMetricsSummary();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getServiceHealth(req, res, next) {
    try {
      const data = await monitoringService.getServiceHealth();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getSystemStats(req, res, next) {
    try {
      const data = await monitoringService.getSystemStats();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getRecentTraces(req, res, next) {
    try {
      const data = await monitoringService.getRecentTraces();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getRecentLogs(req, res, next) {
    try {
      const data = await monitoringService.getRecentLogs();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getApiRoutesBreakdown(req, res, next) {
    try {
      const data = await monitoringService.getApiRoutesBreakdown();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getAlertsData(req, res, next) {
    try {
      const data = await monitoringService.getAlertsData();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }

  async getPerformanceMetrics(req, res, next) {
    try {
      const data = await monitoringService.getPerformanceMetrics();
      return res.json({ success: true, data });
    } catch (err) {
      next(err);
    }
  }
}

export default new MonitoringController();
