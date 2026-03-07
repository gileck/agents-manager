import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';

export function registerChatSessionHandlers(api: ApiClient): void {
  // ============================================
  // Chat Operations
  // ============================================

  // Streaming (CHAT_OUTPUT, CHAT_MESSAGE) is now delivered via WebSocket,
  // not via IPC callbacks. The REST endpoint returns when the send completes.
  registerIpcHandler(IPC_CHANNELS.CHAT_SEND, async (_, sessionId: string, message: string, images?: unknown) => {
    return api.chat.sendMessage(sessionId, message, images as unknown[] | undefined);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_STOP, async (_, sessionId: string) => {
    return api.chat.stopGeneration(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_MESSAGES, async (_, sessionId: string) => {
    return api.chat.getMessages(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_CLEAR, async (_, sessionId: string) => {
    return api.chat.clearMessages(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SUMMARIZE, async (_, sessionId: string) => {
    return api.chat.summarizeMessages(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_COSTS, async () => {
    return api.chat.getCosts();
  });

  // ============================================
  // Chat Session Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_CREATE, async (_, input: { scopeType: string; scopeId: string; name: string; agentLib?: string }) => {
    return api.chat.createSession(input);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_LIST, async (_, scopeType: string, scopeId: string) => {
    return api.chat.listSessions(scopeType, scopeId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_LIST_TASK_SESSIONS, async (_, projectId: string) => {
    return api.chat.listTaskSessionsForProject(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_UPDATE, async (_, sessionId: string, input: { name?: string; agentLib?: string | null }) => {
    return api.chat.updateSession(sessionId, input);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_DELETE, async (_, sessionId: string) => {
    return api.chat.deleteSession(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_AGENT_SESSION, async (_, taskId: string, agentRole: string) => {
    return api.chat.getAgentChatSession(taskId, agentRole);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_AGENTS_LIST, async () => {
    return api.chat.getRunningAgents();
  });
}
