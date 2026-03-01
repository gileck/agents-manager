import express from 'express';
import cors from 'cors';
import { createServer as createHttpServer } from 'http';
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
import { errorHandler } from './middleware/error-handler';
import type { AppServices } from '../core/providers/setup';

export function createServer(services: AppServices) {
  const app = express();
  app.use(cors({ origin: true }));
  app.use(express.json());

  // Register routes
  app.use(healthRoutes());

  // CRUD routes (data: projects, tasks, pipelines, etc.)
  app.use(projectRoutes(services));
  app.use(taskRoutes(services));
  app.use(pipelineRoutes(services));
  app.use(featureRoutes(services));
  app.use(kanbanRoutes(services));
  app.use(agentDefinitionRoutes(services));
  app.use(itemRoutes(services));
  app.use(settingsRoutes(services));
  app.use(dashboardRoutes(services));
  app.use(eventRoutes(services));

  // Action routes (side-effects: agents, chat, git, etc.)
  app.use(agentRoutes(services));
  app.use(chatRoutes(services));
  app.use(taskChatRoutes(services));
  app.use(telegramRoutes(services));
  app.use(gitRoutes(services));
  app.use(promptRoutes(services));
  app.use(artifactRoutes(services));

  // Error handler must be registered last
  app.use(errorHandler);

  const httpServer = createHttpServer(app);
  return { app, httpServer };
}
