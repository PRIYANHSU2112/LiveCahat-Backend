import dotenv from 'dotenv';
import Joi from 'joi';

dotenv.config();

// Define validation for all environment variables
const envVarsSchema = Joi.object()
  .keys({
    NODE_ENV: Joi.string().valid('production', 'development', 'test').required(),
    PORT: Joi.number().default(5000),
    DATABASE_URI: Joi.string().required().description('Mongo DB URI'),
    REDIS_HOST: Joi.string().default('localhost').description('Redis host'),
    REDIS_PORT: Joi.number().default(6379).description('Redis port'),
    REDIS_PASSWORD: Joi.string().allow('').optional().description('Redis password'),
    JWT_SECRET: Joi.string().required().description('JWT Secret key'),
    JWT_ACCESS_EXPIRATION_MINUTES: Joi.number().default(30).description('minutes after which access tokens expire'),
    AGORA_APP_ID: Joi.string().allow('').optional().description('Agora App ID for RTC token generation'),
    AGORA_APP_CERTIFICATE: Joi.string().allow('').optional().description('Agora App Certificate for RTC token signing'),
    AGORA_AUTH_MODE: Joi.string().valid('secured', 'testing').optional().description('secured=signed token, testing=App ID only (null token)'),
  })
  .unknown();

const { value: envVars, error } = envVarsSchema.prefs({ errors: { label: 'key' } }).validate(process.env);

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

const config = {
  env: envVars.NODE_ENV,
  port: envVars.PORT,
  mongoose: {
    url: envVars.DATABASE_URI,
  },
  redis: {
    host: envVars.REDIS_HOST || 'localhost',
    port: envVars.REDIS_PORT || 6379,
    password: (envVars.REDIS_PASSWORD || '').trim() || undefined,
  },
  jwt: {
    secret: envVars.JWT_SECRET,
    accessExpirationMinutes: envVars.JWT_ACCESS_EXPIRATION_MINUTES,
  },
  agora: {
    appId: (envVars.AGORA_APP_ID || '').trim(),
    appCertificate: (envVars.AGORA_APP_CERTIFICATE || '').trim(),
    authMode:
      envVars.AGORA_AUTH_MODE ||
      ((envVars.AGORA_APP_CERTIFICATE || '').trim() ? 'secured' : 'testing'),
  },
};

export default config;
