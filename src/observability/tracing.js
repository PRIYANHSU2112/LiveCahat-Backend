import { NodeSDK } from '@opentelemetry/sdk-node';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import opentelemetryResources from '@opentelemetry/resources';
import opentelemetrySemConventions from '@opentelemetry/semantic-conventions';
import logger from '../utils/logger.util.js';

const createResource = (attrs) => {
  try {
    if (typeof opentelemetryResources.resourceFromAttributes === 'function') {
      return opentelemetryResources.resourceFromAttributes(attrs);
    }
    const Res = opentelemetryResources.Resource || opentelemetryResources.default?.Resource;
    if (typeof Res === 'function') {
      return new Res(attrs);
    }
  } catch (e) {
    return undefined;
  }
  return undefined;
};

const ATTR_SERVICE_NAME = opentelemetrySemConventions.ATTR_SERVICE_NAME || opentelemetrySemConventions.SemanticResourceAttributes?.SERVICE_NAME || 'service.name';
const ATTR_SERVICE_VERSION = opentelemetrySemConventions.ATTR_SERVICE_VERSION || opentelemetrySemConventions.SemanticResourceAttributes?.SERVICE_VERSION || 'service.version';

const tempoEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://tempo:4318/v1/traces';
const serviceName = process.env.OTEL_SERVICE_NAME || 'livechat-backend';

// In-memory trace store for API monitoring endpoint (holds recent 100 traces)
const recentTraces = [];
const MAX_RECENT_TRACES = 100;

export const recordTraceSpan = (spanData) => {
  recentTraces.unshift({
    id: spanData.traceId || `trace_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    traceId: spanData.traceId,
    timestamp: new Date().toISOString(),
    service: spanData.service || serviceName,
    name: spanData.name || 'HTTP Request',
    durationMs: spanData.durationMs || 0,
    statusCode: spanData.statusCode || 200,
    attributes: spanData.attributes || {}
  });

  if (recentTraces.length > MAX_RECENT_TRACES) {
    recentTraces.pop();
  }
};

export const getRecentTracesStore = () => recentTraces;

const traceExporter = new OTLPTraceExporter({
  url: tempoEndpoint,
});

const resource = createResource({
  [ATTR_SERVICE_NAME]: serviceName,
  [ATTR_SERVICE_VERSION]: '1.0.0',
});

const sdk = new NodeSDK({
  ...(resource ? { resource } : {}),
  traceExporter,
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-fs': { enabled: false },
      '@opentelemetry/instrumentation-express': { enabled: true },
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-mongoose': { enabled: true },
      '@opentelemetry/instrumentation-ioredis': { enabled: true }
    })
  ]
});

try {
  sdk.start();
  logger.info(`[OpenTelemetry] SDK initialized. Traces exporting to ${tempoEndpoint}`);
} catch (err) {
  logger.warn(`[OpenTelemetry] Failed to initialize tracing: ${err.message}`);
}

process.on('SIGTERM', () => {
  sdk.shutdown()
    .then(() => logger.info('[OpenTelemetry] SDK terminated cleanly'))
    .catch((err) => logger.error('[OpenTelemetry] Error terminating SDK', err))
    .finally(() => process.exit(0));
});

export default sdk;
