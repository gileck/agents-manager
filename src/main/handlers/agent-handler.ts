import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { Task, Transition, TransitionContext, AgentMode, RevisionReason, HookResult, AgentChatMessage } from '../../shared/types';

export interface StreamingCallbacks {
  onOutput: (chunk: string) => void;
  onMessage: (msg: AgentChatMessage) => void;
  onStatus: (status: string) => void;
}

export interface AgentHandlerDeps {
  workflowService: IWorkflowService;
  taskEventLog: ITaskEventLog;
  agentRunStore?: import('../interfaces/agent-run-store').IAgentRunStore;
  createStreamingCallbacks?: (taskId: string) => StreamingCallbacks;
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
    const callbacks = deps.createStreamingCallbacks?.(task.id);
    const onOutput = callbacks?.onOutput ?? (() => {});
    const onMessage = callbacks?.onMessage ?? (() => {});
    const onStatus = callbacks?.onStatus ?? (() => {});
    // Fire-and-forget: agent runs asynchronously via WorkflowService (logs activity)
    deps.workflowService.startAgent(
      task.id, mode, agentType,
      revisionReason,
      onOutput,
      onMessage,
      onStatus,
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
              message: `Agent failed to start within 5s for task ${task.id} (mode=${mode}) — retrying once`,
              data: { mode, agentType, retried: true },
            });

            // Retry startAgent once
            try {
              await deps.workflowService.startAgent(
                task.id, mode, agentType,
                revisionReason,
                onOutput,
                onMessage,
                onStatus,
              );
            } catch (retryErr) {
              const retryMsg = retryErr instanceof Error ? retryErr.message : String(retryErr);
              try {
                await deps.taskEventLog.log({
                  taskId: task.id,
                  category: 'system',
                  severity: 'error',
                  message: `start_agent retry also failed for task ${task.id}: ${retryMsg}`,
                  data: { error: retryMsg, mode, agentType, retried: true },
                });
              } catch { /* db may be closed */ }
              return; // Don't schedule follow-up check if retry itself threw
            }

            // Follow-up verification 5s after retry
            setTimeout(async () => {
              try {
                const retryRuns = await deps.agentRunStore!.getRunsForTask(task.id);
                const retryActive = retryRuns.filter(r => r.status === 'running');
                if (retryActive.length === 0) {
                  await deps.taskEventLog.log({
                    taskId: task.id,
                    category: 'system',
                    severity: 'error',
                    message: `Agent still not running after retry for task ${task.id} (mode=${mode})`,
                    data: { mode, agentType, retried: true, finalCheck: true },
                  });
                }
              } catch { /* best-effort */ }
            }, 5000);
          }
        } catch { /* best-effort verification */ }
      }, 5000);
    }
    return { success: true };
  });
}
