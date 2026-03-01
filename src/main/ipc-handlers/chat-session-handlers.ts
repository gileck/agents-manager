import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler, validateId } from '@template/main/ipc/ipc-registry';
import { sendToRenderer } from '@template/main/core/window';
import type { AppServices } from '../../core/providers/setup';
import type { ChatImage } from '../../shared/types';
import { buildDesktopSystemPrompt } from '../../core/services/chat-prompt-parts';

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES_PER_MESSAGE = 5;
const MAX_IMAGE_SIZE_BYTES = 10 * 1024 * 1024; // ~10MB base64

function validateImages(images: unknown): ChatImage[] | undefined {
  if (images === undefined || images === null) return undefined;
  if (!Array.isArray(images)) throw new Error('images must be an array');
  if (images.length > MAX_IMAGES_PER_MESSAGE) throw new Error(`Maximum ${MAX_IMAGES_PER_MESSAGE} images per message`);
  for (const img of images) {
    if (!img || typeof img !== 'object') throw new Error('Each image must be an object');
    if (!VALID_IMAGE_TYPES.has(img.mediaType)) throw new Error(`Invalid image type: ${img.mediaType}. Allowed: png, jpeg, gif, webp`);
    if (typeof img.base64 !== 'string' || img.base64.length === 0) throw new Error('Image base64 data is required');
    if (img.base64.length > MAX_IMAGE_SIZE_BYTES) throw new Error('Image too large (max ~10MB)');
  }
  return images as ChatImage[];
}

export function registerChatSessionHandlers(services: AppServices): void {
  // ============================================
  // Chat Operations
  // ============================================

  registerIpcHandler(IPC_CHANNELS.CHAT_SEND, async (_, sessionId: string, message: string, images?: unknown) => {
    validateId(sessionId);
    if (typeof message !== 'string') {
      throw new Error('Message must be a string');
    }
    const validatedImages = validateImages(images);
    if (!message.trim() && !validatedImages?.length) {
      throw new Error('Message text or images are required');
    }
    if (message.length > 10000) {
      throw new Error('Message is too long (max 10000 characters)');
    }

    const scope = await services.chatAgentService.getSessionScope(sessionId);
    const systemPrompt = buildDesktopSystemPrompt(scope);

    const { userMessage, completion } = await services.chatAgentService.send(
      sessionId,
      message,
      {
        systemPrompt,
        onEvent: (event) => {
          if (event.type === 'text') {
            sendToRenderer(IPC_CHANNELS.CHAT_OUTPUT, sessionId, event.text);
          } else if (event.type === 'message') {
            sendToRenderer(IPC_CHANNELS.CHAT_MESSAGE, sessionId, event.message);
          }
        },
        images: validatedImages,
      },
    );

    // Sentinel is now an IPC-level concern
    completion.catch(() => {}).finally(() => {
      sendToRenderer(IPC_CHANNELS.CHAT_OUTPUT, sessionId, CHAT_COMPLETE_SENTINEL);
    });

    return { userMessage, sessionId };
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
    return services.chatSessionStore.listSessionsForScope(
      scopeType as 'project' | 'task',
      scopeId,
      { excludeSources: ['telegram'] },
    );
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
