import express from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import mongoSanitize from 'express-mongo-sanitize';
import xss from 'xss-clean';
import hpp from 'hpp';
import { rateLimit } from 'express-rate-limit';
import fs from 'fs';
import swaggerUi from 'swagger-ui-express';
import logger from './utils/logger.util.js';
import path from 'path';

// Import Routes
import routes from './routes/index.routes.js';
import { globalErrorHandler } from './middlewares/error.middleware.js';
import { responseTimeTracker } from './middlewares/response-time.middleware.js';
import { seedSuperAdmin } from './seeders/super-admin.seeder.js';
import { swaggerUiOptions } from './docs/swagger-ui.options.js';
import { seedXpSystem } from './seeders/xp.seeder.js';
import { seedCountries } from './seeders/country.seeder.js';

// Observability Imports
import { metricsMiddleware } from './observability/metrics.middleware.js';
import { getPrometheusMetrics, getMetricsContentType } from './observability/metrics.js';
import healthRoutes from './observability/health.routes.js';
import monitoringRoutes from './observability/monitoring.routes.js';

const app = express();

// ==========================================
// SEEDERS (Comment out after first run!)
// ==========================================
seedSuperAdmin();
seedXpSystem();
seedCountries();

// 1. GLOBAL MIDDLEWARES & METRICS INSTRUMENTATION
app.use(metricsMiddleware); // Collect Prometheus metrics & trace context
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false })); // Set security HTTP headers
app.use(cors()); // Enable CORS
app.options('*', cors());
app.use(express.json({ limit: '10kb' })); // Body parser, reading data from body into req.body
app.use(express.urlencoded({ extended: true, limit: '10kb' })); // Parse URL-encoded bodies
app.use(compression()); // Compress all responses

// 2. HEALTH & METRICS ENDPOINTS (No Auth)
app.use('/', healthRoutes);

app.get('/metrics', async (req, res) => {
  try {
    res.set('Content-Type', getMetricsContentType());
    res.end(await getPrometheusMetrics());
  } catch (err) {
    res.status(500).end(err);
  }
});

// 3. SECURITY MIDDLEWARES
app.use(mongoSanitize()); // Data sanitization against NoSQL query injection
app.use(xss()); // Data sanitization against XSS
app.use(hpp()); // Prevent parameter pollution

// Limit requests from same API (skip during full API test runs)
const limiter = rateLimit({
  max: 1000,
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!'
});
if (process.env.DISABLE_RATE_LIMIT !== 'true') {
  app.use('/api', limiter);
}

// Request Logger & Response Timer
app.use(responseTimeTracker);

// Swagger Documentation Setup
const swaggerPath = path.resolve('src/docs/swagger.json');
const swaggerDocument = JSON.parse(fs.readFileSync(swaggerPath, 'utf8'));
// Never let the browser/proxy cache the docs HTML, so UI tweaks always show up
const noCacheDocs = (req, res, next) => {
  res.set('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
};
app.get('/api-docs.json', (req, res) => res.json(swaggerDocument));
app.use('/api-docs', noCacheDocs, swaggerUi.serve, swaggerUi.setup(swaggerDocument, swaggerUiOptions));

// Test Dashboard Interface
app.get('/test', (req, res) => {
  res.sendFile(path.resolve('public/test.html'));
});

// Android App Links / Deep Linking verification
const assetLinksData = [
  {
    relation: ['delegate_permission/common.handle_all_urls'],
    target: {
      namespace: 'android_app',
      package_name: 'com.chatcorner',
      sha256_cert_fingerprints: [
        "86:F9:BF:0C:6F:2E:E6:11:9C:C9:B1:01:04:56:E9:A4:5D:34:2F:E1:4C:CC:29:88:60:70:4A:5E:AE:96:0D:9A"
      ],
    },
  },
];

app.get('/.well-known/assetlinks.json', (req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.json(assetLinksData);
});

// Deep link web landing & app redirect handler for /host, /invite, /register
const deepLinkHandler = (req, res) => {
  const pathName = req.path.replace(/^\//, ''); // 'host', 'invite', 'register'
  const refCode = req.query.ref || req.query.code || '';
  const type = req.query.type || '';
  const appSchemeUrl = `chatcorner://${pathName}?ref=${encodeURIComponent(refCode)}${type ? `&type=${encodeURIComponent(type)}` : ''}`;

  res.send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>ChatCorner - Welcome</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: #fff; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; padding: 20px; }
    .card { background: #1e293b; border-radius: 20px; padding: 32px 24px; max-width: 400px; width: 100%; text-align: center; box-shadow: 0 10px 25px rgba(0,0,0,0.5); }
    h1 { font-size: 22px; margin-bottom: 8px; color: #f8fafc; }
    p { font-size: 14px; color: #94a3b8; margin-bottom: 24px; line-height: 1.5; }
    .btn { display: block; width: 100%; box-sizing: border-box; background: linear-gradient(135deg, #6366f1, #8b5cf6); color: #fff; padding: 14px; border-radius: 12px; font-weight: 600; text-decoration: none; font-size: 16px; margin-bottom: 12px; }
    .code { font-family: monospace; background: #334155; padding: 6px 12px; border-radius: 6px; color: #38bdf8; font-weight: bold; }
  </style>
  <script>
    window.location.href = "${appSchemeUrl}";
  </script>
</head>
<body>
  <div class="card">
    <h1>ChatCorner</h1>
    <p>Opening in the app... ${refCode ? `<br><br>Referral Code: <span class="code">${refCode}</span>` : ''}</p>
    <a class="btn" href="${appSchemeUrl}">Open App</a>
  </div>
</body>
</html>`);
};

app.get(['/host', '/invite', '/register'], deepLinkHandler);

// Static assets under /public (optional local scripts, images, etc.)
app.use('/public', express.static(path.resolve('public')));
app.use('/.well-known', express.static(path.resolve('public/.well-known')));

// 4. ROUTES
app.use('/api/v1/monitoring', monitoringRoutes);
app.use('/api/v1', routes);
app.use('/api', routes);

// 4. UNHANDLED ROUTES
app.all('*', (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

// 5. GLOBAL ERROR HANDLER
app.use(globalErrorHandler);

export default app;
