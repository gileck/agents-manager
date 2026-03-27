import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { ApiClient } from '../../client';
import type { PermissionMode } from '../../shared/types';

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

  registerIpcHandler(IPC_CHANNELS.CHAT_LIVE_MESSAGES, async (_, sessionId: string) => {
    return api.chat.getLiveMessages(sessionId);
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

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_UPDATE, async (_, sessionId: string, input: { name?: string; agentLib?: string | null; permissionMode?: PermissionMode | null; systemPromptAppend?: string | null; draft?: string | null }) => {
    return api.chat.updateSession(sessionId, input);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_DELETE, async (_, sessionId: string) => {
    return api.chat.deleteSession(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_HIDE, async (_, sessionId: string) => {
    return api.chat.hideSession(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_UNHIDE, async (_, sessionId: string) => {
    return api.chat.unhideSession(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_HIDE_ALL, async (_, projectId: string) => {
    return api.chat.hideAllSessions(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_LIST_ALL, async (_, projectId: string) => {
    return api.chat.listAllForProject(projectId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_AGENT_SESSION, async (_, taskId: string, agentRole: string) => {
    return api.chat.getAgentChatSession(taskId, agentRole);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_AGENTS_LIST, async () => {
    return api.chat.getRunningAgents();
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_TRACKED_TASKS, async (_, sessionId: string) => {
    return api.chat.getTrackedTasks(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_TRACK_TASK, async (_, sessionId: string, taskId: string) => {
    return api.chat.trackTask(sessionId, taskId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_UNTRACK_TASK, async (_, sessionId: string, taskId: string) => {
    return api.chat.untrackTask(sessionId, taskId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_ANSWER_QUESTION, async (_, sessionId: string, questionId: string, answers: Record<string, string>) => {
    return api.chat.answerQuestion(sessionId, questionId, answers);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_PERMISSION_RESPONSE, async (_, sessionId: string, requestId: string, allowed: boolean) => {
    return api.chat.sendPermissionResponse(sessionId, requestId, allowed);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_STATUS, async (_, sessionId: string) => {
    return api.chat.getSessionStatus(sessionId);
  });
}
