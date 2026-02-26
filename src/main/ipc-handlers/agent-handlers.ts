import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../providers/setup';
import type { AgentMode } from '../../shared/types';

export function registerAgentHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.AGENT_START, async (_, taskId: string, mode: AgentMode, agentType?: string) => {
    validateId(taskId);
    return services.workflowService.startAgent(
      taskId, mode, agentType,
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
    // Always queue the message — the running agent will pick it up,
    // or a newly started agent will receive it on its first turn.
    services.agentService.queueMessage(taskId, message);

    const activeRuns = await services.agentRunStore.getActiveRuns();
    const running = activeRuns.find((r) => r.taskId === taskId && r.status === 'running');
    if (!running) {
      const runs = await services.agentRunStore.getRunsForTask(taskId);
      const lastRun = runs[0];
      const mode = lastRun?.mode || 'implement';
      const agentType = lastRun?.agentType || 'claude-code';
      await services.workflowService.startAgent(
        taskId, mode, agentType,
        (chunk) => sendToRenderer(IPC_CHANNELS.AGENT_OUTPUT, taskId, chunk),
        (msg) => sendToRenderer(IPC_CHANNELS.AGENT_MESSAGE, taskId, msg),
        (status) => sendToRenderer(IPC_CHANNELS.AGENT_STATUS, taskId, status),
      );
    }
  });
}
