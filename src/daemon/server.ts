import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer, type Server as HttpServer } from 'http';
import path from 'path';
import fs from 'fs';
import { healthRoutes } from './routes/health';
import { projectRoutes } from './routes/projects';
import { taskRoutes } from './routes/tasks';
import { pipelineRoutes } from './routes/pipelines';
import { featureRoutes } from './routes/features';
import { kanbanRoutes } from './routes/kanban';
import { agentDefinitionRoutes } from './routes/agent-definitions';
import { itemRoutes } from './routes/items';
import { settingsRoutes } from './routes/settings';
import { dashboardRoutes } from './routes/dashboard';
import { eventRoutes } from './routes/events';
import { agentRoutes } from './routes/agents';
import { chatRoutes } from './routes/chat';
import { taskChatRoutes } from './routes/task-chat';
import { telegramRoutes } from './routes/telegram';
import { gitRoutes } from './routes/git';
import { promptRoutes } from './routes/prompts';
import { artifactRoutes } from './routes/artifacts';
import { automatedAgentRoutes } from './routes/automated-agents';
import { notificationRoutes } from './routes/notifications';
import { shellRoutes } from './routes/shell';
import { devServerRoutes } from './routes/dev-servers';
import { screenshotRoutes } from './routes/screenshots';
import { errorHandler } from './middleware/error-handler';
import type { AppServices } from '../core/providers/setup';
import type { DaemonWsServer } from './ws/ws-server';

/** Mutable holder resolved after the WS server is created */
export type WsHolder = { server?: DaemonWsServer };

export function createServer(services: AppServices, wsHolder: WsHolder = {}): { app: express.Application; httpServer: HttpServer } {
  const app = express();
  app.use(cors({
    origin: (origin, cb) => {
      // Allow requests with no origin (Electron, CLI, same-origin) and localhost origins
      if (!origin || /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)) {
        cb(null, true);
      } else {
        cb(new Error('CORS blocked'));
      }
    },
  }));
  app.use(express.json({ limit: '50mb' }));

  // Register routes
  app.use(healthRoutes());

  // CRUD routes (data: projects, tasks, pipelines, etc.)
  app.use(projectRoutes(services));
  app.use(taskRoutes(services, wsHolder));
  app.use(pipelineRoutes(services));
  app.use(featureRoutes(services));
  app.use(kanbanRoutes(services));
  app.use(agentDefinitionRoutes(services));
  app.use(itemRoutes(services));
  app.use(settingsRoutes(services));
  app.use(dashboardRoutes(services));
  app.use(eventRoutes(services));
  app.use(notificationRoutes(services));

  // Action routes (side-effects: agents, chat, git, etc.)
  app.use(agentRoutes(services, wsHolder));
  app.use(chatRoutes(services, wsHolder));
  app.use(taskChatRoutes(services, wsHolder));
  app.use(telegramRoutes(services, wsHolder));
  app.use(gitRoutes(services));
  app.use(promptRoutes(services));
  app.use(artifactRoutes(services));
  app.use(automatedAgentRoutes(services, wsHolder));
  app.use(devServerRoutes(services));
  app.use(screenshotRoutes(services));

  // Utility routes (no services dependency)
  app.use(shellRoutes());

  // Serve web UI bundle if built (dist-web/ exists)
  const webDistPath = path.resolve(__dirname, '..', 'dist-web');
  if (fs.existsSync(webDistPath)) {
    app.use(express.static(webDistPath));
    // SPA fallback — serve index.html for non-API GET requests
    app.use((req, res, next) => {
      if (req.method !== 'GET' || req.path.startsWith('/api/')) return next();
      res.sendFile(path.join(webDistPath, 'index.html'));
    });
  }

  // Error handler must be registered last
  app.use(errorHandler);

  const httpServer = createHttpServer(app);
  return { app, httpServer };
}
