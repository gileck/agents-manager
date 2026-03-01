import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { AgentMode, RevisionReason } from '../../shared/types';

export function registerAgentHandlers(api: ApiClient): void {
  // Streaming callbacks are no longer set up here — the daemon broadcasts
  // agent output/message/status via WebSocket, and the Electron main process
  // forwards those WS events to the renderer separately.

  registerIpcHandler(IPC_CHANNELS.AGENT_START, async (_, taskId: string, mode: AgentMode, agentType: string, revisionReason?: RevisionReason) => {
    return api.agents.start(taskId, mode, agentType, revisionReason);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_STOP, async (_, runId: string) => {
    // The old IPC handler received only runId. The API client needs (taskId, runId)
    // but the daemon route ignores taskId — it only reads runId from the body.
    return api.agents.stop('_', runId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_RUNS, async (_, taskId: string) => {
    return api.agents.runs(taskId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_GET, async (_, runId: string) => {
    return api.agents.getRun(runId);
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_TASK_IDS, async () => {
    return api.agents.getActiveTaskIds();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ACTIVE_RUNS, async () => {
    return api.agents.getActiveRuns();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_ALL_RUNS, async () => {
    return api.agents.getAllRuns();
  });

  registerIpcHandler(IPC_CHANNELS.AGENT_SEND_MESSAGE, async (_, taskId: string, message: string) => {
    return api.agents.message(taskId, message);
  });
}
