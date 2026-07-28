import client from 'prom-client';

// Collect default Node.js system metrics (CPU, Memory, GC, Event Loop Lag, Handles)
client.collectDefaultMetrics({
  prefix: 'livechat_',
  timeout: 5000
});

// Custom Prometheus Instruments
export const httpRequestDurationMicroseconds = new client.Histogram({
  name: 'livechat_http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status_code'],
  buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]
});

export const httpRequestsTotal = new client.Counter({
  name: 'livechat_http_requests_total',
  help: 'Total number of HTTP requests processed',
  labelNames: ['method', 'route', 'status_code']
});

export const httpRequestErrorsTotal = new client.Counter({
  name: 'livechat_http_request_errors_total',
  help: 'Total number of HTTP request errors',
  labelNames: ['method', 'route', 'status_code', 'error_type']
});

export const activeHttpConnections = new client.Gauge({
  name: 'livechat_active_http_connections',
  help: 'Number of active HTTP requests currently being handled'
});

export const mongoOperationDurationSeconds = new client.Histogram({
  name: 'livechat_mongo_operation_duration_seconds',
  help: 'Duration of MongoDB database operations in seconds',
  labelNames: ['operation', 'collection'],
  buckets: [0.001, 0.005, 0.01, 0.05, 0.1, 0.5, 1, 5]
});

export const redisCommandDurationSeconds = new client.Histogram({
  name: 'livechat_redis_command_duration_seconds',
  help: 'Duration of Redis commands in seconds',
  labelNames: ['command'],
  buckets: [0.0005, 0.001, 0.005, 0.01, 0.05, 0.1, 0.5]
});

export const cronJobDurationSeconds = new client.Histogram({
  name: 'livechat_cron_job_duration_seconds',
  help: 'Duration of background cron jobs in seconds',
  labelNames: ['job_name', 'status'],
  buckets: [0.1, 0.5, 1, 5, 10, 30, 60]
});

export const cronJobExecutionsTotal = new client.Counter({
  name: 'livechat_cron_job_executions_total',
  help: 'Total executions of background cron jobs',
  labelNames: ['job_name', 'status']
});

export const getPrometheusMetrics = async () => {
  return await client.register.metrics();
};

export const getMetricsContentType = () => client.register.contentType;

export default client;
