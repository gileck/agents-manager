import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../providers/setup';
import type { AgentMode } from '../../shared/types';

export function registerAgentHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.AGENT_START, async (_, taskId: string, mode: AgentMode, agentType?: string) => {
    validateId(taskId);
    return services.workflowService.startAgent(
      taskId, mode, agentType, undefined,
      (chunk) => sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk),
      (msg) => sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg),
      (status) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status),
    );
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_STOP, async (_, runId: string) => {
    validateId(runId);
    return services.workflowService.stopAgent(runId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_RUNS, async (_, taskId: string) => {
    validateId(taskId);
    return services.agentRunStore.getRunsForTask(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_GET, async (_, runId: string) => {
    validateId(runId);
    return services.agentRunStore.getRun(runId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_TASK_IDS, async () => {
    const runs = await services.agentRunStore.getActiveRuns();
    return [...new Set(runs.map((r) => r.taskId))];
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_RUNS, async () => {
    return services.agentRunStore.getActiveRuns();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ALL_RUNS, async () => {
    return services.agentRunStore.getAllRuns();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_SEND_MESSAGE, async (_, taskId: string, message: string) => {
    validateId(taskId);
    return services.workflowService.resumeAgent(taskId, message, {
      onOutput: (chunk) => sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk),
      onMessage: (msg) => sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg),
      onStatusChange: (status) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status),
    });
  });
}
