import { trace } from '@opentelemetry/api';
import {
  httpRequestDurationMicroseconds,
  httpRequestsTotal,
  activeHttpConnections,
  httpRequestErrorsTotal
} from './metrics.js';
import { recordTraceSpan } from './tracing.js';

// Route normalizer (e.g., converts /api/v1/users/60d5ec49f1b2c80015f8e3a1 -> /api/v1/users/:id)
const normalizeRoute = (path) => {
  if (!path) return 'unknown';
  return path
    .replace(/\/[0-9a-fA-F]{24}/g, '/:id')
    .replace(/\/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/g, '/:uuid')
    .replace(/\/\d+/g, '/:id');
};

export const metricsMiddleware = (req, res, next) => {
  const start = process.hrtime();
  activeHttpConnections.inc();

  // Active OpenTelemetry trace context
  const activeSpan = trace.getActiveSpan();
  const traceId = activeSpan ? activeSpan.spanContext().traceId : `tr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;
  req.traceId = traceId;
  res.setHeader('X-Trace-Id', traceId);

  res.on('finish', () => {
    activeHttpConnections.dec();
    const diff = process.hrtime(start);
    const durationInSeconds = diff[0] + diff[1] / 1e9;
    const durationMs = (diff[0] * 1e3 + diff[1] * 1e-6).toFixed(2);
    
    const route = normalizeRoute(req.baseUrl ? `${req.baseUrl}${req.path}` : req.path);
    const method = req.method;
    const statusCode = res.statusCode.toString();

    // Record Prometheus Metrics
    httpRequestDurationMicroseconds.labels(method, route, statusCode).observe(durationInSeconds);
    httpRequestsTotal.labels(method, route, statusCode).inc();

    if (res.statusCode >= 400) {
      const errorType = res.statusCode >= 500 ? 'server_error' : 'client_error';
      httpRequestErrorsTotal.labels(method, route, statusCode, errorType).inc();
    }

    // Record trace in recent memory store
    recordTraceSpan({
      traceId,
      service: 'livechat-backend',
      name: `${method} ${route}`,
      durationMs: parseFloat(durationMs),
      statusCode: res.statusCode,
      attributes: {
        method,
        url: req.originalUrl,
        ip: req.ip || req.connection?.remoteAddress
      }
    });
  });

  next();
};
