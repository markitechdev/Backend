import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import compression from 'compression';
import { env, missingEnv } from './config/env.js';
import routes from './routes/index.js';
import { notFoundHandler, errorHandler } from './middleware/errorHandler.js';

export const createApp = () => {
  const app = express();

  // Behind Vercel's proxy: use the real client IP (needed for per-user login rate limits)
  if (env.isServerless || process.env.TRUST_PROXY) app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet());
  app.use(compression());
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use(cors({
    origin: (origin, cb) => {
      // allow same-origin / curl / server-to-server requests with no Origin header
      if (!origin || env.isAllowedOrigin(origin)) return cb(null, true);
      cb(new Error(`Origin ${origin} is not allowed by CORS`));
    },
    credentials: true,
  }));

  if (env.nodeEnv !== 'test') app.use(morgan('dev'));

  // Misconfigured deployment: say exactly what is missing instead of crashing.
  if (missingEnv.length) {
    app.use((_req, res) => res.status(500).json({
      success: false,
      error: { status: 500, code: 'SERVER_MISCONFIGURED', message: `Missing environment variables: ${missingEnv.join(', ')}` },
    }));
  }

  app.get('/', (_req, res) => res.json({
    success: true,
    data: { name: 'Inventory Management System API', version: '1.0.0', docs: '/api/health' },
  }));

  app.use('/api', routes);
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
};
