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
import { seedXpSystem } from './seeders/xp.seeder.js';

const app = express();

// ==========================================
// SEEDERS (Comment out after first run!)
// ==========================================
seedSuperAdmin();
seedXpSystem();

// 1. GLOBAL MIDDLEWARES
app.use(helmet()); // Set security HTTP headers
app.use(cors()); // Enable CORS
app.options('*', cors());
app.use(express.json({ limit: '10kb' })); // Body parser, reading data from body into req.body
app.use(express.urlencoded({ extended: true, limit: '10kb' })); // Parse URL-encoded bodies
app.use(compression()); // Compress all responses

// 2. SECURITY MIDDLEWARES
app.use(mongoSanitize()); // Data sanitization against NoSQL query injection
app.use(xss()); // Data sanitization against XSS
app.use(hpp()); // Prevent parameter pollution

// Limit requests from same API
const limiter = rateLimit({
  max: 100,
  windowMs: 60 * 60 * 1000,
  message: 'Too many requests from this IP, please try again in an hour!'
});
app.use('/api', limiter);

// Request Logger & Response Timer
app.use(responseTimeTracker);

// Swagger Documentation Setup
const swaggerDocument = JSON.parse(fs.readFileSync('./src/docs/swagger.json', 'utf8'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/api-docs.json', (req, res) => res.json(swaggerDocument));

// Test Dashboard Interface
app.get('/test', (req, res) => {
  res.sendFile(path.resolve('public/test.html'));
});

// 3. ROUTES
app.use('/api/v1', routes);

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
