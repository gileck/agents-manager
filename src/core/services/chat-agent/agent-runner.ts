/**
 * Agent execution engine — the core streaming loop that runs an agent lib
 * and handles callbacks, hooks, subagent delegation, and post-run cleanup.
 *
 * Extracted from ChatAgentService.runAgent() to reduce the size of the
 * main service file. Receives all dependencies via a context object.
 */

import type { IChatMessageStore } from '../../interfaces/chat-message-store';
import type { IChatSessionStore } from '../../interfaces/chat-session-store';
import type { IAgentRunStore } from '../../interfaces/agent-run-store';
import type { ITaskContextStore } from '../../interfaces/task-context-store';
import type { AgentChatMessage, ChatImage, ChatAgentEvent, ChatSession, PermissionMode, AskUserQuestionItem } from '../../../shared/types';
import type { AgentLibRegistry } from '../agent-lib-registry';
import type { AgentLibCallbacks } from '../../interfaces/agent-lib';
import type { GenericMcpToolDefinition } from '../../interfaces/mcp-tool';
import type { AgentSubscriptionRegistry } from '../agent-subscription-registry';
import type { RunningAgent, InjectedMessage } from './chat-agent-helpers';
import { createTaskMcpServer } from '../../mcp/task-mcp-server';

import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppLogger } from '../app-logger';
import { getScreenshotStorageDir } from '../../utils/user-paths';

import {
  tagNestedSubagentMessage,
  WRITE_TOOL_NAMES,
  DEFAULT_CHAT_SUBAGENTS,
  AGENT_ROLE_TO_FEEDBACK_ENTRY_TYPE,
} from './chat-agent-helpers';

// ---------------------------------------------------------------------------
// Context interface — bundles the state and stores that runAgent needs
// ---------------------------------------------------------------------------

export interface RunAgentContext {
  // In-memory state Maps owned by ChatAgentService
  runningAgents: Map<string, RunningAgent>;
  liveTurnMessages: Map<string, AgentChatMessage[]>;
  allRunTurnMessages: Map<string, AgentChatMessage[]>;
  runningControllers: Map<string, AbortController>;
  runningRunIds: Map<string, string>;
  pendingQuestions: Map<string, { resolve: (answers: Record<string, string>) => void; reject: (err: Error) => void; sessionId: string }>;
  injectedQueue: Map<string, InjectedMessage[]>;

  // Stores
  chatMessageStore: IChatMessageStore;
  chatSessionStore: IChatSessionStore;
  agentRunStore: IAgentRunStore;
  taskContextStore?: ITaskContextStore;

  // Registries
  agentLibRegistry: AgentLibRegistry;
  subscriptionRegistry?: AgentSubscriptionRegistry;

  // Config
  imageStorageDir: string;

  // Callbacks
  deliverInjectedMessage: (msg: InjectedMessage) => Promise<void>;
  emitStatusChange: (sessionId: string, status: import('../../../shared/types').ChatSessionStatus) => void;
}

export interface RunAgentExtra {
  pipelineSessionId?: string;
  resumeSession?: boolean;
  isAgentChat?: boolean;
  agentRunId?: string;
  permissionMode?: PermissionMode | null;
  agentType?: string;
  taskId?: string;
  plugins?: Array<{ type: 'local'; path: string }>;
  enableStreaming?: boolean;
  enableStreamingInput?: boolean;
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export async function runAgent(
  ctx: RunAgentContext,
  sessionId: string,
  projectPath: string,
  systemPrompt: string | { type: 'preset'; preset: 'claude_code'; append?: string },
  prompt: string,
  abortController: AbortController,
  agentLibName: string,
  emitEvent: (event: ChatAgentEvent) => void,
  images?: ChatImage[],
  model?: string,
  extra?: RunAgentExtra,
): Promise<void> {
  getAppLogger().info('ChatAgentService', `runAgent() starting for session ${sessionId}`, { agentLibName, projectPath });

  const agentRunId = extra?.agentRunId;

  const imageDir = ctx.imageStorageDir;
  const screenshotDir = getScreenshotStorageDir();
  const tmpPath = path.join(projectPath, 'tmp');

  let costInputTokens: number | undefined;
  let costOutputTokens: number | undefined;
  let cacheReadInputTokens: number | undefined;
  let cacheCreationInputTokens: number | undefined;
  let totalCostUsd: number | undefined;
  let lastContextInputTokens: number | undefined;
  const turnMessages: AgentChatMessage[] = [];
  const allTurnMessages: AgentChatMessage[] = [];
  ctx.liveTurnMessages.set(sessionId, turnMessages);
  ctx.allRunTurnMessages.set(sessionId, allTurnMessages);

  // Safe wrapper: emit both event types from a single AgentChatMessage
  const emitMessage = (msg: AgentChatMessage) => {
    emitEvent({ type: 'message', message: msg });
    const agent = ctx.runningAgents.get(sessionId);
    if (agent) {
      agent.lastActivity = Date.now();
    }
    if (msg.type !== 'usage') {
      turnMessages.push(msg);
      allTurnMessages.push(msg);
    }
  };

  const emitText = (text: string) => {
    emitEvent({ type: 'text', text });
    emitMessage({ type: 'assistant_text', text, timestamp: Date.now() });
  };

  try {
    if (agentRunId) {
      emitMessage({ type: 'agent_run_info', agentRunId, timestamp: Date.now(), agentType: extra?.agentType, taskId: extra?.taskId });
    }

    const lib = ctx.agentLibRegistry.getLib(agentLibName);
    const features = lib.supportedFeatures();

    if (images && images.length > 0 && !features.images) {
      const warning = `\n[Note: Images are sent as file paths with the ${agentLibName} engine. The agent will use the Read tool to view them.]\n`;
      emitText(warning);
    }

    abortController.signal.addEventListener('abort', () => {
      lib.stop(sessionId).catch(err => getAppLogger().warn('ChatAgentService', 'Failed to stop agent lib', { error: err instanceof Error ? err.message : String(err) }));
    });

    // Determine readOnly and disallowedTools based on permissionMode
    const effectiveMode = extra?.permissionMode ?? 'read_only';
    let readOnly: boolean;
    let disallowedTools: string[] | undefined;

    if (effectiveMode === 'full_access') {
      readOnly = false;
    } else if (effectiveMode === 'read_write') {
      readOnly = false;
    } else {
      readOnly = true;
      disallowedTools = [...WRITE_TOOL_NAMES];
    }

    // Build hooks
    const postToolUseHook = (input: import('../../interfaces/agent-lib').PostToolUseHookInput) => {
      getAppLogger().debug('ChatAgentService', `PostToolUse: ${input.toolName}`, {
        toolUseId: input.toolUseId,
        responsePreview: typeof input.toolResponse === 'string'
          ? input.toolResponse.slice(0, 200)
          : JSON.stringify(input.toolResponse).slice(0, 200),
      });
    };

    const notificationHook = (input: import('../../interfaces/agent-lib').NotificationHookInput) => {
      getAppLogger().info('ChatAgentService', `Agent notification: ${input.title ?? ''} ${input.message}`);
      emitMessage({ type: 'notification', title: input.title, body: input.message, timestamp: Date.now() });
    };

    const stopHook = (input: import('../../interfaces/agent-lib').StopHookInput) => {
      getAppLogger().info('ChatAgentService', `Agent stop hook: stopHookActive=${input.stopHookActive}`);
    };

    const subagentStartHook = (input: import('../../interfaces/agent-lib').SubagentStartHookInput) => {
      getAppLogger().info('ChatAgentService', `Subagent started: ${input.agentType} (${input.agentId})`);
      emitMessage({ type: 'subagent_activity', agentName: input.agentType, status: 'started', toolUseId: input.agentId, timestamp: Date.now() });
    };

    const subagentStopHook = (input: import('../../interfaces/agent-lib').SubagentStopHookInput) => {
      getAppLogger().info('ChatAgentService', `Subagent stopped: ${input.agentType} (${input.agentId})`);
      emitMessage({ type: 'subagent_activity', agentName: input.agentType, status: 'completed', toolUseId: input.agentId, timestamp: Date.now() });
    };

    const requestQuestionAnswers = async (
      questionId: string,
      questions: AskUserQuestionItem[],
    ): Promise<Record<string, string>> => {
      emitMessage({ type: 'ask_user_question', questionId, questions, answered: false, timestamp: Date.now() });

      const waitingAgent = ctx.runningAgents.get(sessionId);
      if (waitingAgent && waitingAgent.status === 'running') {
        waitingAgent.status = 'waiting_for_input';
        ctx.emitStatusChange(sessionId, 'waiting_for_input');
      }

      let onAbort: (() => void) | undefined;
      try {
        const answers = await new Promise<Record<string, string>>((resolve, reject) => {
          ctx.pendingQuestions.set(questionId, { resolve, reject, sessionId });
          onAbort = () => {
            if (ctx.pendingQuestions.has(questionId)) {
              ctx.pendingQuestions.delete(questionId);
              reject(new Error('Agent stopped while waiting for user answer'));
            }
          };
          abortController.signal.addEventListener('abort', onAbort, { once: true });
        });
        if (onAbort) abortController.signal.removeEventListener('abort', onAbort);
        return answers;
      } catch (err) {
        if (onAbort) abortController.signal.removeEventListener('abort', onAbort);
        if (err instanceof Error && !err.message.includes('Agent stopped')) {
          getAppLogger().warn('ChatAgentService', 'Unexpected error while waiting for user answer', { error: err.message });
        }
        throw err;
      }
    };

    // Build images array for libs that support native images
    const libImages = (features.images && images && images.length > 0)
      ? images.map((img) => ({ base64: img.base64, mediaType: img.mediaType }))
      : undefined;

    const executeSessionId = extra?.pipelineSessionId ?? sessionId;

    // Build task MCP tool definitions for chat sessions
    let mcpToolsDefs: Record<string, GenericMcpToolDefinition[]> | undefined;
    let chatSession: ChatSession | null = null;
    if (!extra?.pipelineSessionId) {
      try {
        chatSession = await ctx.chatSessionStore.getSession(sessionId);
        if (chatSession?.projectId) {
          const daemonUrl = `http://127.0.0.1:${process.env.AM_DAEMON_PORT ?? 3847}`;
          const taskTools = await createTaskMcpServer(daemonUrl, { projectId: chatSession.projectId, sessionId, subscriptionRegistry: ctx.subscriptionRegistry });
          mcpToolsDefs = { 'taskManager': taskTools };
        }
      } catch (mcpErr) {
        getAppLogger().warn('ChatAgentService', 'Failed to create task MCP server, continuing without it', { error: mcpErr instanceof Error ? mcpErr.message : String(mcpErr) });
      }
    }

    // Build canUseTool callback that intercepts AskUserQuestion tool calls
    const canUseTool = async (toolName: string, input: Record<string, unknown>): Promise<
      { behavior: 'allow'; updatedInput?: Record<string, unknown> } |
      { behavior: 'deny'; message: string }
    > => {
      if (toolName !== 'AskUserQuestion') {
        return { behavior: 'allow' };
      }

      const questionId = randomUUID();
      const rawQuestions = Array.isArray(input.questions) ? input.questions : [];

      const questions: AskUserQuestionItem[] = rawQuestions
        .filter((q: unknown): q is Record<string, unknown> => q != null && typeof q === 'object')
        .map((q: Record<string, unknown>) => ({
          question: typeof q.question === 'string' ? q.question : '',
          header: typeof q.header === 'string' ? q.header : undefined,
          multiSelect: typeof q.multiSelect === 'boolean' ? q.multiSelect : undefined,
          options: Array.isArray(q.options)
            ? (q.options as unknown[]).filter((o): o is Record<string, unknown> => o != null && typeof o === 'object').map((o: Record<string, unknown>) => ({
                label: typeof o.label === 'string' ? o.label : String(o.label ?? ''),
                description: typeof o.description === 'string' ? o.description : undefined,
              }))
            : [],
        }));

      if (questions.length === 0) {
        return { behavior: 'deny', message: 'AskUserQuestion received no valid questions.' };
      }

      try {
        const answers = await requestQuestionAnswers(questionId, questions);
        return { behavior: 'allow', updatedInput: { questions: input.questions, answers } };
      } catch {
        return { behavior: 'deny', message: 'User did not answer (agent was stopped).' };
      }
    };

    // Add default subagents for thread chat sessions
    const isThreadChat = chatSession && chatSession.source !== 'agent-chat' && !extra?.pipelineSessionId;
    const agents = isThreadChat ? DEFAULT_CHAT_SUBAGENTS : undefined;

    const onClientToolCall: AgentLibCallbacks['onClientToolCall'] = async ({ toolName, toolUseId, toolInput }) => {
      if (toolName !== 'Task' && toolName !== 'task') {
        return { handled: false, success: false, content: '' };
      }

      const subagentType = typeof toolInput.subagent_type === 'string' ? toolInput.subagent_type : undefined;
      const subagentDef = subagentType ? agents?.[subagentType] : undefined;
      const agentName = subagentType ?? 'subagent';
      const taskPrompt = typeof toolInput.prompt === 'string'
        ? toolInput.prompt
        : typeof toolInput.description === 'string'
          ? toolInput.description
          : JSON.stringify(toolInput);
      const taskInput = JSON.stringify(toolInput);

      emitMessage({ type: 'tool_use', toolName: 'Task', toolId: toolUseId, input: taskInput.slice(0, 2000), timestamp: Date.now() });
      emitMessage({ type: 'subagent_activity', agentName, status: 'started', toolUseId, timestamp: Date.now() });

      try {
        const nestedResult = await lib.execute(`${executeSessionId}:task:${toolUseId}`, {
          prompt: taskPrompt,
          systemPrompt: subagentDef?.prompt ?? systemPrompt,
          cwd: projectPath,
          model,
          maxTurns: subagentDef?.maxTurns ?? 25,
          timeoutMs: 300000,
          allowedPaths: readOnly ? [tmpPath] : [projectPath, imageDir, screenshotDir, tmpPath],
          readOnlyPaths: readOnly ? [projectPath, imageDir, screenshotDir] : [],
          readOnly,
          permissionMode: effectiveMode,
          settingSources: ['project'] as Array<'user' | 'project' | 'local'>,
          ...(mcpToolsDefs ? { mcpTools: mcpToolsDefs } : {}),
          ...(extra?.plugins?.length ? { plugins: extra.plugins } : {}),
          canUseTool,
          disallowedTools: [...(disallowedTools ?? []), 'Task'],
        }, {
          onMessage: (msg: AgentChatMessage) => {
            const taggedMessage = tagNestedSubagentMessage(msg, toolUseId);
            if (!taggedMessage) return;
            emitMessage(taggedMessage);
          },
          onQuestionRequest: async ({ questionId, questions }) => {
            const answers = await requestQuestionAnswers(questionId, questions);
            return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, [value]]));
          },
          onClientToolCall: async () => ({ handled: true, success: false, content: 'Nested Task delegation is not supported yet.' }),
        });

        const resultText = (nestedResult.output || nestedResult.error || `Subagent ${agentName} completed.`).slice(0, 4000);
        emitMessage({ type: 'subagent_activity', agentName, status: 'completed', toolUseId, timestamp: Date.now() });
        emitMessage({ type: 'tool_result', toolId: toolUseId, result: resultText.slice(0, 2000), timestamp: Date.now() });
        return { handled: true, success: nestedResult.exitCode === 0, content: resultText };
      } catch (err) {
        const errorText = err instanceof Error ? err.message : String(err);
        emitMessage({ type: 'subagent_activity', agentName, status: 'completed', toolUseId, timestamp: Date.now() });
        emitMessage({ type: 'tool_result', toolId: toolUseId, result: errorText.slice(0, 2000), timestamp: Date.now() });
        return { handled: true, success: false, content: errorText };
      }
    };

    const enableStreaming = extra?.enableStreaming !== false;
    const enableStreamingInput = features.streamingInput && (extra?.enableStreamingInput === true);

    // Build callbacks
    const callbacks: AgentLibCallbacks = {
      onOutput: (chunk: string) => { emitEvent({ type: 'text', text: chunk }); },
      onMessage: (msg: AgentChatMessage) => { emitMessage(msg); },
      onUserToolResult: (toolUseId: string, content: string) => {
        emitMessage({ type: 'tool_result', toolId: toolUseId, result: content, timestamp: Date.now() });
      },
      onQuestionRequest: async ({ questionId, questions }) => {
        const answers = await requestQuestionAnswers(questionId, questions);
        return Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, [value]]));
      },
      onClientToolCall,
      ...(enableStreaming ? {
        onStreamEvent: (event: { type: string; [key: string]: unknown }) => {
          const delta = event.delta as { type?: string; text?: string; thinking?: string; partial_json?: string } | undefined;
          if (event.type === 'content_block_delta' && delta) {
            if (delta.type === 'text_delta' && typeof delta.text === 'string') {
              emitEvent({ type: 'stream_delta', delta: { type: 'stream_delta', deltaType: 'text_delta', delta: delta.text, timestamp: Date.now() } });
            } else if (delta.type === 'thinking_delta' && typeof delta.thinking === 'string') {
              emitEvent({ type: 'stream_delta', delta: { type: 'stream_delta', deltaType: 'thinking_delta', delta: delta.thinking, timestamp: Date.now() } });
            } else if (delta.type === 'input_json_delta' && typeof delta.partial_json === 'string') {
              emitEvent({ type: 'stream_delta', delta: { type: 'stream_delta', deltaType: 'input_json_delta', delta: delta.partial_json, timestamp: Date.now() } });
            }
          }
        },
      } : {}),
      // Per-turn completion for streaming-input sessions: execute() stays alive
      // across turns, so we must emit the sentinel and persist messages here
      // instead of waiting for execute() to return (which only happens on stop).
      ...(enableStreamingInput ? {
        onTurnComplete: () => {
          getAppLogger().info('ChatAgentService', `Streaming-input turn complete for session ${sessionId}`);

          // Snapshot and persist accumulated turn messages
          if (turnMessages.length > 0) {
            const snapshot = [...turnMessages];
            turnMessages.length = 0;
            ctx.chatMessageStore.addMessage({
              sessionId,
              role: 'assistant',
              content: JSON.stringify(snapshot),
            }).catch((persistErr) => {
              getAppLogger().logError('ChatAgentService', 'Failed to persist turn messages on turn complete', persistErr);
              // Restore messages so the finally block can retry persistence
              turnMessages.unshift(...snapshot);
            });
          }

          // Update in-memory agent status and emit to DB/WS.
          // Always idle on turn completion — waiting_for_input is set
          // exclusively by requestQuestionAnswers when a question is
          // actively asked. This keeps in-memory, DB, and WS in sync.
          const agent = ctx.runningAgents.get(sessionId);
          if (agent) {
            agent.status = 'idle';
            agent.lastActivity = Date.now();
          }
          getAppLogger().info('ChatAgentService', `onTurnComplete: emitting idle [session=${sessionId.slice(0, 8)}]`);
          ctx.emitStatusChange(sessionId, 'idle');

          // Status change event signals the client that this turn is done
          // (emitted by ctx.emitStatusChange above)
        },
      } : {}),
    };

    const executeOptions = {
      prompt,
      systemPrompt,
      sessionId: executeSessionId,
      cwd: projectPath,
      model,
      maxTurns: 50,
      allowedPaths: readOnly ? [tmpPath] : [projectPath, imageDir, screenshotDir, tmpPath],
      readOnlyPaths: readOnly ? [projectPath, imageDir, screenshotDir] : [],
      readOnly,
      permissionMode: effectiveMode,
      settingSources: ['project'] as Array<'user' | 'project' | 'local'>,
      ...(extra?.resumeSession ? { resumeSession: true } : {}),
      ...(disallowedTools ? { disallowedTools } : {}),
      hooks: {
        postToolUse: postToolUseHook,
        notification: notificationHook,
        stop: stopHook,
        subagentStart: subagentStartHook,
        subagentStop: subagentStopHook,
      },
      ...(libImages ? { images: libImages } : {}),
      ...(mcpToolsDefs ? { mcpTools: mcpToolsDefs } : {}),
      canUseTool,
      ...(agents ? { agents } : {}),
      ...(extra?.plugins?.length ? { plugins: extra.plugins } : {}),
      ...(enableStreamingInput ? { enableStreamingInput: true } : {}),
    };

    let result = await lib.execute(executeSessionId, executeOptions, callbacks);

    // Fallback: if session resume failed, retry without resume
    const errorLower = (result.error ?? '').toLowerCase();
    const outputLower = (result.output ?? '').toLowerCase();
    const isSessionError = errorLower.includes('session') || outputLower.includes('session');
    const isEmptyResult = !result.output && !result.error;
    const isZeroCost = !result.costInputTokens && !result.costOutputTokens;
    const isSessionInUse = /session\s+id\s+\S+\s+is\s+already\s+in\s+use/i.test(result.error ?? '') ||
                           /session\s+id\s+\S+\s+is\s+already\s+in\s+use/i.test(result.output ?? '');
    if (result.exitCode !== 0 && !result.killReason && isZeroCost &&
        ((extra?.resumeSession && (isSessionError || isEmptyResult)) || isSessionInUse)) {
      getAppLogger().warn('ChatAgentService', `Session error for ${executeSessionId}, retrying without resume`, { originalError: result.error ?? '(empty)', isSessionInUse, isResume: !!extra?.resumeSession });
      emitEvent({ type: 'text', text: '\n[Session error — starting fresh session]\n' });
      result = await lib.execute(executeSessionId, {
        ...executeOptions,
        resumeSession: false,
        ...(isSessionInUse ? { sessionId: undefined } : {}),
      }, callbacks);
    }

    if (result.costInputTokens != null || result.costOutputTokens != null) {
      emitMessage({
        type: 'usage',
        inputTokens: result.costInputTokens ?? 0,
        outputTokens: result.costOutputTokens ?? 0,
        ...(result.contextWindow ? { contextWindow: result.contextWindow } : {}),
        timestamp: Date.now(),
      });
    }

    costInputTokens = result.costInputTokens;
    costOutputTokens = result.costOutputTokens;
    cacheReadInputTokens = result.cacheReadInputTokens;
    cacheCreationInputTokens = result.cacheCreationInputTokens;
    totalCostUsd = result.totalCostUsd;
    lastContextInputTokens = result.lastContextInputTokens;

    if (result.durationMs != null || result.numTurns != null) {
      getAppLogger().debug('ChatAgentService', `Session ${sessionId} telemetry: durationMs=${result.durationMs}, durationApiMs=${result.durationApiMs}, numTurns=${result.numTurns}, contextWindow=${result.contextWindow}`);
    }

    if (result.error) {
      emitEvent({ type: 'text', text: `\n[Agent error: ${result.error}]\n` });
      const isStopped = result.error.includes('kill_reason=stopped');
      const isTimeout = result.error.includes('kill_reason=timeout') || result.error.includes('timed out');
      const errorStatus: 'cancelled' | 'timed_out' | 'failed' = isStopped ? 'cancelled' : isTimeout ? 'timed_out' : 'failed';
      emitMessage({ type: 'status', status: errorStatus, message: result.error, timestamp: Date.now() });
    }

    // Mark as completed successfully
    const agent = ctx.runningAgents.get(sessionId);
    if (agent) {
      agent.status = 'completed';
      agent.lastActivity = Date.now();
    }
    ctx.emitStatusChange(sessionId, 'completed');
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err);
    const errStack = err instanceof Error ? err.stack : undefined;
    if (abortController.signal.aborted) {
      getAppLogger().info('ChatAgentService', `Chat agent aborted for session ${sessionId}`);
      try { emitMessage({ type: 'status', status: 'cancelled', message: 'Agent stopped by user', timestamp: Date.now() }); } catch (emitErr) { getAppLogger().warn('ChatAgentService', 'Failed to emit cancellation status', { error: emitErr instanceof Error ? emitErr.message : String(emitErr) }); }
    } else {
      getAppLogger().logError('ChatAgentService', `Chat agent error for session ${sessionId}`, err);
      emitEvent({ type: 'text', text: `\nError: ${errMsg}\n` });
      try { emitMessage({ type: 'status', status: 'failed', message: errMsg, stack: errStack, timestamp: Date.now() }); } catch (emitErr) { getAppLogger().warn('ChatAgentService', 'Failed to emit error status', { error: emitErr instanceof Error ? emitErr.message : String(emitErr) }); }
    }
    const agent = ctx.runningAgents.get(sessionId);
    if (agent) {
      agent.status = 'failed';
      agent.lastActivity = Date.now();
    }
    const dbStatus = abortController.signal.aborted ? 'idle' : 'failed';
    ctx.emitStatusChange(sessionId, dbStatus);
  } finally {
    ctx.runningControllers.delete(sessionId);
    ctx.runningRunIds.delete(sessionId);
    ctx.liveTurnMessages.delete(sessionId);
    ctx.allRunTurnMessages.delete(sessionId);

    // Clean up orphaned pending questions
    const orphaned = [...ctx.pendingQuestions.entries()].filter(([, p]) => p.sessionId === sessionId);
    for (const [qId, pending] of orphaned) {
      ctx.pendingQuestions.delete(qId);
      pending.reject(new Error('Agent session ended'));
    }

    // Clean up completed agent after delay
    setTimeout(() => {
      const agent = ctx.runningAgents.get(sessionId);
      if (agent && agent.status !== 'running') {
        ctx.runningAgents.delete(sessionId);
      }
    }, 5000);

    // Persist assistant response (BEFORE sentinel)
    if (turnMessages.length > 0) {
      try {
        await ctx.chatMessageStore.addMessage({
          sessionId,
          role: 'assistant',
          content: JSON.stringify(turnMessages),
          costInputTokens,
          costOutputTokens,
          cacheReadInputTokens,
          cacheCreationInputTokens,
          totalCostUsd,
          lastContextInputTokens,
        });
      } catch (persistErr) {
        getAppLogger().logError('ChatAgentService', 'Failed to persist assistant response', persistErr);
        try { emitEvent({ type: 'text', text: '\n[Warning: Failed to save this response. It may not appear after refresh.]\n' }); } catch (deliveryErr) { getAppLogger().warn('ChatAgentService', 'persist-warning delivery failed', { error: deliveryErr instanceof Error ? deliveryErr.message : String(deliveryErr) }); }
      }
    }

    // Completion is signaled by the status change WS event
    // (emitted by ctx.emitStatusChange in the try/catch blocks above)
    getAppLogger().info('ChatAgentService', `Chat agent finished for session ${sessionId}`);

    // --- Post-sentinel async cleanup ---

    if (extra?.isAgentChat && extra?.taskId && ctx.taskContextStore && turnMessages.length > 0) {
      const agentRole = extra.agentType;
      const entryType = agentRole ? AGENT_ROLE_TO_FEEDBACK_ENTRY_TYPE[agentRole] : undefined;
      if (entryType) {
        try {
          const responseText = turnMessages
            .filter(m => m.type === 'assistant_text')
            .map(m => (m as { type: 'assistant_text'; text: string }).text)
            .join('\n');
          if (responseText.trim()) {
            await ctx.taskContextStore.addEntry({
              taskId: extra.taskId,
              source: agentRole ?? 'agent',
              entryType,
              summary: responseText.trim(),
              agentRunId: agentRunId,
            });
            getAppLogger().info('ChatAgentService', `Saved agent-chat response as TaskContextEntry (${entryType}) for task ${extra.taskId}`);
          }
        } catch (ctxErr) {
          getAppLogger().logError('ChatAgentService', 'Failed to save agent-chat response as TaskContextEntry', ctxErr);
        }
      }
    }

    if (agentRunId) {
      try {
        const existingRun = await ctx.agentRunStore.getRun(agentRunId);
        if (existingRun) {
          const agent = ctx.runningAgents.get(sessionId);
          const agentStatus = agent?.status ?? 'failed';
          const systemPromptText = typeof systemPrompt === 'string' ? systemPrompt : (systemPrompt.append ?? '');
          const resolvedPrompt = existingRun.prompt ? existingRun.prompt : `${systemPromptText}\n\n${prompt}`;
          if (resolvedPrompt.includes('[object Object]')) {
            getAppLogger().logError('ChatAgentService', `AgentRun ${agentRunId} prompt contains "[object Object]"`, new Error('Prompt serialization bug'));
          }
          await ctx.agentRunStore.updateRun(agentRunId, {
            status: agentStatus === 'completed' ? 'completed' : 'failed',
            completedAt: Date.now(),
            costInputTokens: (existingRun.costInputTokens ?? 0) + (costInputTokens ?? 0),
            costOutputTokens: (existingRun.costOutputTokens ?? 0) + (costOutputTokens ?? 0),
            cacheReadInputTokens: (existingRun.cacheReadInputTokens ?? 0) + (cacheReadInputTokens ?? 0),
            cacheCreationInputTokens: (existingRun.cacheCreationInputTokens ?? 0) + (cacheCreationInputTokens ?? 0),
            totalCostUsd: (existingRun.totalCostUsd ?? 0) + (totalCostUsd ?? 0),
            messages: [...(existingRun.messages ?? []), ...allTurnMessages],
            prompt: resolvedPrompt,
          });
        } else {
          getAppLogger().warn('ChatAgentService', `AgentRun ${agentRunId} not found in DB; skipping update`);
        }
      } catch (runErr) {
        getAppLogger().logError('ChatAgentService', 'Failed to update AgentRun', runErr);
      }
    }

    // Drain injected queue
    const queued = ctx.injectedQueue.get(sessionId);
    if (queued && queued.length > 0) {
      ctx.injectedQueue.delete(sessionId);
      for (const msg of queued) {
        try {
          await ctx.deliverInjectedMessage(msg);
        } catch (err) {
          getAppLogger().logError('ChatAgentService', 'Failed to deliver queued injected message', err);
        }
      }
    }
  }
}
