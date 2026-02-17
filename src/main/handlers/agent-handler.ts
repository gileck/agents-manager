import type { IPipelineEngine } from '../interfaces/pipeline-engine';
import type { IWorkflowService } from '../interfaces/workflow-service';
import type { ITaskEventLog } from '../interfaces/task-event-log';
import type { Task, Transition, AgentMode } from '../../shared/types';
import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { sendToRenderer } from '@template/main/core/window';

export interface AgentHandlerDeps {
  workflowService: IWorkflowService;
  taskEventLog: ITaskEventLog;
}

export function registerAgentHandler(engine: IPipelineEngine, deps: AgentHandlerDeps): void {
  engine.registerHook('start_agent', async (task: Task, transition: Transition) => {
    const hookDef = transition.hooks?.find((h) => h.name === 'start_agent');
    if (!hookDef?.params?.mode) {
      throw new Error(`start_agent hook on transition ${transition.from} → ${transition.to} is missing required "mode" param`);
    }
    if (!hookDef.params.agentType) {
      throw new Error(`start_agent hook on transition ${transition.from} → ${transition.to} is missing required "agentType" param`);
    }
    const mode = hookDef.params.mode as AgentMode;
    const agentType = hookDef.params.agentType as string;
    // Fire-and-forget: agent runs asynchronously via WorkflowService (logs activity)
    deps.workflowService.startAgent(task.id, mode, agentType, (chunk) => {
      try {
        sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, task.id, chunk);
      } catch { /* window may be closed */ }
    }).catch(async (err) => {
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
  });
}
