import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../providers/setup';

export function registerChatSessionHandlers(services: AppServices): void {
  // ============================================
  // Chat Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.CHAT_SEND, async (_, sessionId: string, message: string) => {
    validateId(sessionId);
    if (!message || typeof message !== 'string') {
      throw new Error('Message is required and must be a string');
    }
    if (message.length > 10000) {
      throw new Error('Message is too long (max 10000 characters)');
    }
    return services.chatAgentService.send(
      sessionId,
      message,
      (chunk) => sendToRenderer(IPC_CHANNELS.CHAT_OUTPUT, sessionId, chunk),
      (msg) => sendToRenderer(IPC_CHANNELS.CHAT_MESSAGE, sessionId, msg),
    );
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_STOP, async (_, sessionId: string) => {
    validateId(sessionId);
    services.chatAgentService.stop(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_MESSAGES, async (_, sessionId: string) => {
    validateId(sessionId);
    return services.chatAgentService.getMessages(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_CLEAR, async (_, sessionId: string) => {
    validateId(sessionId);
    return services.chatAgentService.clearMessages(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SUMMARIZE, async (_, sessionId: string) => {
    validateId(sessionId);
    return services.chatAgentService.summarizeMessages(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_COSTS, async () => {
    return services.chatMessageStore.getCostSummary();
  });

  // ============================================
  // Chat Session Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_CREATE, async (_, input: { scopeType: string; scopeId: string; name: string; agentLib?: string }) => {
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected object');
    }
    if (!input.scopeType || (input.scopeType !== 'project' && input.scopeType !== 'task')) {
      throw new Error('scopeType must be "project" or "task"');
    }
    validateId(input.scopeId);
    if (!input.name || typeof input.name !== 'string') {
      throw new Error('Session name is required and must be a string');
    }
    if (input.name.length > 100) {
      throw new Error('Session name must be 100 characters or less');
    }
    if (input.name.trim().length === 0) {
      throw new Error('Session name cannot be empty');
    }
    // Verify the scope target exists and derive projectId
    let projectId: string;
    if (input.scopeType === 'project') {
      const project = await services.projectStore.getProject(input.scopeId);
      if (!project) throw new Error('Project not found');
      projectId = project.id;
    } else {
      const task = await services.taskStore.getTask(input.scopeId);
      if (!task) throw new Error('Task not found');
      projectId = task.projectId;
    }
    // Validate agentLib if provided
    if (input.agentLib) {
      const validLibs = services.agentLibRegistry.listNames();
      if (!validLibs.includes(input.agentLib)) {
        throw new Error(`Unknown agent lib: ${input.agentLib}. Available: ${validLibs.join(', ')}`);
      }
    }
    return services.chatSessionStore.createSession({
      scopeType: input.scopeType as 'project' | 'task',
      scopeId: input.scopeId,
      name: input.name.trim(),
      agentLib: input.agentLib,
      projectId,
    });
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_LIST, async (_, scopeType: string, scopeId: string) => {
    if (!scopeType || (scopeType !== 'project' && scopeType !== 'task')) {
      throw new Error('scopeType must be "project" or "task"');
    }
    validateId(scopeId);
    return services.chatSessionStore.listSessionsForScope(scopeType as 'project' | 'task', scopeId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_UPDATE, async (_, sessionId: string, input: { name?: string; agentLib?: string | null }) => {
    validateId(sessionId);
    if (!input || typeof input !== 'object') {
      throw new Error('Invalid input: expected object');
    }
    if (input.name !== undefined) {
      if (typeof input.name !== 'string') {
        throw new Error('Session name must be a string');
      }
      if (input.name.length > 100) {
        throw new Error('Session name must be 100 characters or less');
      }
      if (input.name.trim().length === 0) {
        throw new Error('Session name cannot be empty');
      }
    }
    // Verify session exists
    const session = await services.chatSessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    const updateInput: { name?: string; agentLib?: string | null } = {};
    if (input.name !== undefined) updateInput.name = input.name.trim();
    if (input.agentLib !== undefined) {
      if (input.agentLib !== null) {
        const validLibs = services.agentLibRegistry.listNames();
        if (!validLibs.includes(input.agentLib)) {
          throw new Error(`Unknown agent lib: ${input.agentLib}. Available: ${validLibs.join(', ')}`);
        }
      }
      updateInput.agentLib = input.agentLib;
    }
    return services.chatSessionStore.updateSession(sessionId, updateInput);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_SESSION_DELETE, async (_, sessionId: string) => {
    validateId(sessionId);
    // Verify session exists
    const session = await services.chatSessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }
    // Stop any running agent for this session before deleting
    services.chatAgentService.stop(sessionId);
    return services.chatSessionStore.deleteSession(sessionId);
  });

  registerIpcHandler(IPC_CHANNELS.CHAT_AGENTS_LIST, async () => {
    return services.chatAgentService.getRunningAgents();
  });
}
