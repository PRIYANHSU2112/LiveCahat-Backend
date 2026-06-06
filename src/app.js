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

// Import Routes
import userRoutes from './routes/user.routes.js';

const app = express();

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

// Request Logger
app.use((req, res, next) => {
  logger.info(`Incoming Request: ${req.method} ${req.url}`);
  next();
});

// Swagger Documentation Setup
const swaggerDocument = JSON.parse(fs.readFileSync('./src/docs/swagger.json', 'utf8'));
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));

// 3. ROUTES
app.use('/api/v1', userRoutes);

// 4. UNHANDLED ROUTES
app.all('*', (req, res, next) => {
  res.status(404).json({
    success: false,
    message: `Can't find ${req.originalUrl} on this server!`
  });
});

// 5. GLOBAL ERROR HANDLER
app.use((err, req, res, next) => {
  logger.error(err);
  const statusCode = err.statusCode || 500;
  res.status(statusCode).json({
    success: false,
    message: err.message,
    ...(process.env.NODE_ENV === 'development' && { stack: err.stack })
  });
});

export default app;
