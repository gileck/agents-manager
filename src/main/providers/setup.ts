import type Database from 'better-sqlite3';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { IActivityLog } from '../interfaces/activity-log';
import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { ITaskArtifactStore } from '../interfaces/task-artifact-store';
import type { ITaskPhaseStore } from '../interfaces/task-phase-store';
import type { IPendingPromptStore } from '../interfaces/pending-prompt-store';
import type { IAgentFramework } from '../interfaces/agent-framework';
import type { IWorktreeManager } from '../interfaces/worktree-manager';
import type { IGitOps } from '../interfaces/git-ops';
import type { IScmPlatform } from '../interfaces/scm-platform';
import type { INotificationRouter } from '../interfaces/notification-router';
import type { IAgentService } from '../interfaces/agent-service';
import type { IWorkflowService } from '../interfaces/workflow-service';
import { SqliteProjectStore } from '../stores/sqlite-project-store';
import { SqlitePipelineStore } from '../stores/sqlite-pipeline-store';
import { SqliteTaskStore } from '../stores/sqlite-task-store';
import { SqliteTaskEventLog } from '../stores/sqlite-task-event-log';
import { SqliteActivityLog } from '../stores/sqlite-activity-log';
import { SqliteAgentRunStore } from '../stores/sqlite-agent-run-store';
import { SqliteTaskArtifactStore } from '../stores/sqlite-task-artifact-store';
import { SqliteTaskPhaseStore } from '../stores/sqlite-task-phase-store';
import { SqlitePendingPromptStore } from '../stores/sqlite-pending-prompt-store';
import { PipelineEngine } from '../services/pipeline-engine';
import { AgentFrameworkImpl } from '../services/agent-framework-impl';
import { AgentService } from '../services/agent-service';
import { WorkflowService } from '../services/workflow-service';
import { StubWorktreeManager } from '../services/stub-worktree-manager';
import { StubGitOps } from '../services/stub-git-ops';
import { StubScmPlatform } from '../services/stub-scm-platform';
import { StubNotificationRouter } from '../services/stub-notification-router';
import { ScriptedAgent, happyPlan } from '../agents/scripted-agent';
import type { Task, Transition, TransitionContext, GuardResult } from '../../shared/types';

export interface AppServices {
  // Phase 1
  projectStore: IProjectStore;
  pipelineStore: IPipelineStore;
  taskStore: ITaskStore;
  taskEventLog: ITaskEventLog;
  activityLog: IActivityLog;
  pipelineEngine: IPipelineEngine;
  // Phase 2
  agentRunStore: IAgentRunStore;
  taskArtifactStore: ITaskArtifactStore;
  taskPhaseStore: ITaskPhaseStore;
  pendingPromptStore: IPendingPromptStore;
  agentFramework: IAgentFramework;
  worktreeManager: IWorktreeManager;
  gitOps: IGitOps;
  scmPlatform: IScmPlatform;
  notificationRouter: INotificationRouter;
  agentService: IAgentService;
  workflowService: IWorkflowService;
}

export function createAppServices(db: Database.Database): AppServices {
  // Phase 1 stores
  const projectStore = new SqliteProjectStore(db);
  const pipelineStore = new SqlitePipelineStore(db);
  const taskStore = new SqliteTaskStore(db, pipelineStore);
  const taskEventLog = new SqliteTaskEventLog(db);
  const activityLog = new SqliteActivityLog(db);
  const pipelineEngine = new PipelineEngine(pipelineStore, taskStore, taskEventLog, db);

  // Register built-in guards
  pipelineEngine.registerGuard('has_pr', (task: Task): GuardResult => {
    if (task.prLink) {
      return { allowed: true };
    }
    return { allowed: false, reason: 'Task must have a PR link' };
  });

  pipelineEngine.registerGuard('dependencies_resolved', (task: Task, _transition: Transition, _context: TransitionContext, dbRef: unknown): GuardResult => {
    const sqliteDb = dbRef as Database.Database;
    const row = sqliteDb.prepare(`
      SELECT COUNT(*) as count FROM task_dependencies td
      JOIN tasks t ON t.id = td.depends_on_task_id
      JOIN pipelines p ON p.id = t.pipeline_id
      WHERE td.task_id = ?
      AND t.status NOT IN (
        SELECT json_extract(s.value, '$.name')
        FROM pipelines p2, json_each(p2.statuses) s
        WHERE p2.id = t.pipeline_id
        AND json_extract(s.value, '$.isFinal') = 1
      )
    `).get(task.id) as { count: number };

    if (row.count === 0) {
      return { allowed: true };
    }
    return { allowed: false, reason: `${row.count} unresolved dependencies` };
  });

  // Phase 2 stores
  const agentRunStore = new SqliteAgentRunStore(db);
  const taskArtifactStore = new SqliteTaskArtifactStore(db);
  const taskPhaseStore = new SqliteTaskPhaseStore(db);
  const pendingPromptStore = new SqlitePendingPromptStore(db);

  // Phase 2 infrastructure (stubs — real implementations later)
  const worktreeManager = new StubWorktreeManager();
  const gitOps = new StubGitOps();
  const scmPlatform = new StubScmPlatform();
  const notificationRouter = new StubNotificationRouter();

  // Agent framework + adapters
  const agentFramework = new AgentFrameworkImpl();
  agentFramework.registerAgent(new ScriptedAgent(happyPlan));

  // Agent service
  const agentService = new AgentService(
    agentFramework, agentRunStore, worktreeManager,
    gitOps, scmPlatform, taskStore, projectStore, pipelineEngine,
    taskEventLog, taskArtifactStore, taskPhaseStore, pendingPromptStore,
  );

  // Workflow service
  const workflowService = new WorkflowService(
    taskStore, projectStore, pipelineEngine, pipelineStore,
    taskEventLog, activityLog, agentRunStore, pendingPromptStore,
    taskArtifactStore, agentService, scmPlatform,
  );

  return {
    projectStore,
    pipelineStore,
    taskStore,
    taskEventLog,
    activityLog,
    pipelineEngine,
    agentRunStore,
    taskArtifactStore,
    taskPhaseStore,
    pendingPromptStore,
    agentFramework,
    worktreeManager,
    gitOps,
    scmPlatform,
    notificationRouter,
    agentService,
    workflowService,
  };
}
