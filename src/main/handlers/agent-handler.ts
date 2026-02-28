import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { Task, Transition, TransitionContext, AgentMode, RevisionReason, HookResult } from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
function trySendToRenderer(...args: unknown[]): void {
  try {
    const { sendToRenderer } = require('@template/main/core/window');
    sendToRenderer(...args);
  } catch { /* Not in Electron context */ }
}

export interface AgentHandlerDeps {
  workflowService: IWorkflowService;
  taskEventLog: ITaskEventLog;
  agentRunStore?: import('../interfaces/agent-run-store').IAgentRunStore;
}

export function registerAgentHandler(engine: IPipelineEngine, deps: AgentHandlerDeps): void {
  engine.registerHook('start_agent', async (task: Task, transition: Transition, _context: TransitionContext, params?: Record<string, unknown>): Promise<HookResult> => {
    if (!params?.mode) {
      throw new Error(`start_agent hook on transition ${transition.from} → ${transition.to} is missing required "mode" param`);
    }
    if (!params.agentType) {
      throw new Error(`start_agent hook on transition ${transition.from} → ${transition.to} is missing required "agentType" param`);
    }
    const mode = params.mode as AgentMode;
    const agentType = params.agentType as string;
    const revisionReason = params.revisionReason as RevisionReason | undefined;
    // Fire-and-forget: agent runs asynchronously via WorkflowService (logs activity)
    deps.workflowService.startAgent(
      task.id, mode, agentType,
      revisionReason,
      (chunk) => { trySendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, task.id, chunk); },
      (msg) => { trySendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, task.id, msg); },
      (status) => { trySendToRenderer(IPC_CHANNELS.AGENT_STATUS, task.id, status); },
    ).catch(async (err) => {
      const msg = err instanceof Error ? err.message : String(err);
      try {
        await deps.taskEventLog.log({
          taskId: task.id,
          category: 'system',
          severity: 'error',
          message: `start_agent hook failed: ${msg}`,
          data: { error: msg, mode, agentType },
        });
      } catch { /* db may be closed during shutdown */ }
    });
    if (deps.agentRunStore) {
      setTimeout(async () => {
        try {
          const allRuns = await deps.agentRunStore!.getRunsForTask(task.id);
          const activeRuns = allRuns.filter(r => r.status === 'running');
          if (activeRuns.length === 0) {
            await deps.taskEventLog.log({
              taskId: task.id,
              category: 'system',
              severity: 'error',
              message: `Agent failed to start within 5s for task ${task.id} (mode=${mode})`,
              data: { mode, agentType },
            });
          }
        } catch { /* best-effort verification */ }
      }, 5000).unref();
    }
    return { success: true };
  });
}
