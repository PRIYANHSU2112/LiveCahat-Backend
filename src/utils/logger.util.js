import pino from 'pino';
import { trace } from '@opentelemetry/api';

/**
 * Production Pino Logger setup with trace correlation for Promtail/Loki.
 */
const isProduction = process.env.NODE_ENV === 'production';

const logger = pino({
  level: process.env.LOG_LEVEL || (isProduction ? 'info' : 'debug'),
  base: {
    service: process.env.OTEL_SERVICE_NAME || 'livechat-backend',
    env: process.env.NODE_ENV || 'development'
  },
  timestamp: pino.stdTimeFunctions.isoTime,
  mixin() {
    const activeSpan = trace.getActiveSpan();
    if (activeSpan) {
      const { traceId, spanId } = activeSpan.spanContext();
      return { traceId, spanId };
    }
    return {};
  },
  ...(isProduction
    ? {}
    : {
        transport: {
          target: 'pino-pretty',
          options: {
            colorize: true,
            translateTime: 'SYS:standard',
            ignore: 'pid,hostname'
          }
        }
      })
});

// In-memory ring buffer holding recent application logs (last 100 entries)
const recentLogs = [];
const MAX_LOG_ENTRIES = 100;

export const recordLogEntry = (entry) => {
  const activeSpan = trace.getActiveSpan();
  const traceId = activeSpan ? activeSpan.spanContext().traceId : null;

  recentLogs.unshift({
    id: `log_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
    timestamp: new Date().toISOString(),
    level: entry.level || 'info',
    message: entry.message || '',
    service: entry.service || process.env.OTEL_SERVICE_NAME || 'livechat-backend',
    traceId,
    details: entry.details || null
  });

  if (recentLogs.length > MAX_LOG_ENTRIES) {
    recentLogs.pop();
  }
};

export const getRecentLogsStore = () => recentLogs;

// Enhanced logger wrapper that records entries to the buffer
const enhancedLogger = {
  info: (msg, details) => {
    logger.info(details ? { details } : {}, msg);
    recordLogEntry({ level: 'info', message: typeof msg === 'string' ? msg : JSON.stringify(msg), details });
  },
  warn: (msg, details) => {
    logger.warn(details ? { details } : {}, msg);
    recordLogEntry({ level: 'warn', message: typeof msg === 'string' ? msg : JSON.stringify(msg), details });
  },
  error: (msg, details) => {
    logger.error(details ? { details } : {}, msg);
    recordLogEntry({ level: 'error', message: typeof msg === 'string' ? msg : JSON.stringify(msg), details });
  },
  debug: (msg, details) => {
    logger.debug(details ? { details } : {}, msg);
    recordLogEntry({ level: 'debug', message: typeof msg === 'string' ? msg : JSON.stringify(msg), details });
  }
};

export default enhancedLogger;
