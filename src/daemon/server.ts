import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'http';
import { healthRoutes } from './routes/health';
import { errorHandler } from './middleware/error-handler';
import type { AppServices } from '../core/providers/setup';

export function createServer(_services: AppServices) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  // Register routes
  app.use(healthRoutes());

  // Error handler must be registered last
  app.use(errorHandler);

  const httpServer = createHttpServer(app);
  return { app, httpServer };
}
