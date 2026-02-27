import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IChatSessionStore } from '../interfaces/chat-session-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ChatMessage, AgentChatMessage, ChatImage, ChatImageRef } from '../../shared/types';
import type { AgentLibRegistry } from './agent-lib-registry';
import type { AgentLibCallbacks } from '../interfaces/agent-lib';
import { SandboxGuard } from './sandbox-guard';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';

const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

/**
 * Lightweight mirrors of the SDK stream message types used for the
 * dynamically-imported `query()` iterable. Kept here rather than
 * importing from the SDK to avoid a hard compile-time dependency on
 * the ESM-only `@anthropic-ai/claude-agent-sdk` package.
 *
 * See: SDKAssistantMessage, SDKResultMessage, SDKMessage in sdk.d.ts
 */
interface SdkTextBlock { type: 'text'; text: string }
interface SdkToolUseBlock { type: 'tool_use'; name: string; input?: unknown }
type SdkContentBlock = SdkTextBlock | SdkToolUseBlock;

interface SdkAssistantMessage {
  type: 'assistant';
  message: { content: SdkContentBlock[] };
}
interface SdkResultMessage {
  type: 'result';
  subtype: string;
  errors?: string[];
  usage?: { input_tokens: number; output_tokens: number };
}
interface SdkOtherMessage {
  type: string;
  message?: { content?: SdkContentBlock[] };
  summary?: string;
  result?: string;
}
type SdkStreamMessage = SdkAssistantMessage | SdkResultMessage | SdkOtherMessage;

/** Callbacks from runSdkQuery for each message type. */
interface SdkQueryCallbacks {
  onText?: (text: string) => void;
  onToolUse?: (block: SdkToolUseBlock & { id?: string }) => void;
  onResult?: (msg: SdkResultMessage) => void;
  onUserToolResult?: (toolUseId: string, content: string) => void;
}

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

/** Parse a user message content field that may be a JSON envelope with images. */
function parseUserContent(content: string): { text: string; images?: ChatImageRef[] } {
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const images = Array.isArray(parsed.images) && parsed.images.length > 0
          ? (parsed.images as ChatImageRef[])
          : undefined;
        return { text: parsed.text, images };
      }
    } catch (err) {
      console.warn('[parseUserContent] Content starts with { but failed JSON parse:', err);
    }
  }
  return { text: content };
}

/** Extract plain text from a DB content field (handles both JSON array, JSON envelope, and legacy plain text). */
function extractTextFromContent(content: string): string {
  if (content.startsWith('[')) {
    try {
      const parsed = JSON.parse(content);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((m: { type: string }) => m.type === 'assistant_text')
          .map((m: { text: string }) => m.text)
          .join('');
      }
    } catch (err) {
      console.warn('[extractTextFromContent] Content looks like JSON but failed to parse:', err);
    }
  }
  return parseUserContent(content).text;
}

const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

function getImageStorageDir(): string {
  try {
    const { app } = require('electron');
    return path.join(app.getPath('userData'), 'chat-images');
  } catch (err) {
    const home = process.env.HOME;
    if (!home) {
      throw new Error(`Cannot determine image storage directory: Electron unavailable and HOME not set. ${err instanceof Error ? err.message : String(err)}`);
    }
    console.warn(`[ChatAgentService] Electron app.getPath unavailable, falling back to ${home}/.agents-manager/chat-images`);
    return path.join(home, '.agents-manager', 'chat-images');
  }
}

/** Save images to disk and return refs with file paths. */
async function saveImagesToDisk(sessionId: string, images: ChatImage[]): Promise<ChatImageRef[]> {
  const safeSessionId = path.basename(sessionId);
  const baseDir = path.join(getImageStorageDir(), safeSessionId);
  await fs.promises.mkdir(baseDir, { recursive: true });

  return Promise.all(images.map(async (img) => {
    const ext = MEDIA_TYPE_TO_EXT[img.mediaType] || 'png';
    const filename = `${randomUUID()}.${ext}`;
    const filePath = path.join(baseDir, filename);
    const buffer = Buffer.from(img.base64, 'base64');
    if (buffer.length === 0) {
      throw new Error(`Image "${img.name || 'unnamed'}" decoded to empty data`);
    }
    await fs.promises.writeFile(filePath, buffer);
    return {
      path: filePath,
      mediaType: img.mediaType,
      name: img.name || filename,
    };
  }));
}

const WRITE_TOOL_NAMES = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);

const PROJECT_SYSTEM_PROMPT = `You are a project assistant with read-only access to the codebase and full access to the \`npx agents-manager\` CLI for task management.

## Capabilities
- Read and explore project files (Read, Glob, Grep, LS tools)
- Run the \`npx agents-manager\` CLI to manage tasks, features, pipelines, and more (via Bash tool)
- Answer questions about code, architecture, and project state

## Rules
- You MUST NOT modify any files. Do not use Write, Edit, MultiEdit, or NotebookEdit tools.
- You CAN use Bash to run \`npx agents-manager\` CLI commands (e.g. \`npx agents-manager tasks list\`, \`npx agents-manager tasks create\`, \`npx agents-manager tasks update\`).
- You CAN use Bash for read-only commands like \`ls\`, \`cat\`, \`git log\`, \`git diff\`, etc.
- Be concise and helpful. Format responses with markdown when useful.
- When the user asks you to do something that requires modifying files, explain that you can only read files but can help plan changes or create tasks.`;

export interface RunningAgent {
  sessionId: string;
  sessionName: string;
  scopeType: 'project' | 'task';
  scopeId: string;
  projectId: string;
  projectName: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: number;
  lastActivity: number;
  messagePreview?: string;
}

const DEFAULT_AGENT_LIB = 'claude-code';

export class ChatAgentService {
  private runningControllers = new Map<string, AbortController>();
  private runningAgents = new Map<string, RunningAgent>();

  constructor(
    private chatMessageStore: IChatMessageStore,
    private chatSessionStore: IChatSessionStore,
    private projectStore: IProjectStore,
    private taskStore: ITaskStore,
    private pipelineStore: IPipelineStore,
    private agentLibRegistry: AgentLibRegistry,
    private getDefaultAgentLib: () => string = () => DEFAULT_AGENT_LIB,
  ) {}

  async send(
    sessionId: string,
    message: string,
    onOutput: (chunk: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
    images?: ChatImage[],
  ): Promise<{ userMessage: ChatMessage; sessionId: string }> {
    // Get session to find scope
    const session = await this.chatSessionStore.getSession(sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    // Don't abort previous running chat - allow parallel execution
    // but do check if there's already one running for this session
    if (this.runningControllers.has(sessionId)) {
      throw new Error('An agent is already running for this session');
    }

    // Save images to disk and build refs
    let imageRefs: ChatImageRef[] | undefined;
    if (images && images.length > 0) {
      imageRefs = await saveImagesToDisk(sessionId, images);
    }

    // Persist user message — store as JSON envelope if images are present
    const userContent = imageRefs
      ? JSON.stringify({ text: message, images: imageRefs })
      : message;
    const userMessage = await this.chatMessageStore.addMessage({
      sessionId,
      role: 'user',
      content: userContent,
    });

    // Resolve project path and system prompt based on scope
    const { projectPath, systemPrompt, projectId, projectName, projectDefaultAgentLib } = await this.resolveScope(session);

    // Resolve which agent lib to use: session > project config > global setting > hardcoded fallback
    let agentLibName = session.agentLib || projectDefaultAgentLib || this.getDefaultAgentLib() || DEFAULT_AGENT_LIB;

    // Validate the resolved agent lib exists; fall back with a warning if not
    const availableLibs = this.agentLibRegistry.listNames();
    if (!availableLibs.includes(agentLibName)) {
      onOutput(`\n[Warning: Agent engine "${agentLibName}" is not available. Falling back to "${DEFAULT_AGENT_LIB}".]\n`);
      agentLibName = DEFAULT_AGENT_LIB;
    }

    // Track running agent
    this.runningAgents.set(sessionId, {
      sessionId,
      sessionName: session.name,
      scopeType: session.scopeType,
      scopeId: session.scopeId,
      projectId,
      projectName,
      status: 'running',
      startedAt: Date.now(),
      lastActivity: Date.now(),
      messagePreview: message.slice(0, 100),
    });

    // Load conversation history
    const history = await this.chatMessageStore.getMessagesForSession(sessionId);

    // Build prompt with conversation history
    const conversationLines: string[] = [];
    // All messages except the latest user message (which becomes the prompt)
    for (const msg of history.slice(0, -1)) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      let line: string;
      if (msg.role === 'user') {
        const parsed = parseUserContent(msg.content);
        line = `[${roleLabel}]: ${parsed.text}`;
        if (parsed.images) {
          for (const img of parsed.images) {
            line += `\n  (Image: ${img.path})`;
          }
        }
      } else {
        const text = msg.role === 'assistant' ? extractTextFromContent(msg.content) : msg.content;
        line = `[${roleLabel}]: ${text}`;
      }
      conversationLines.push(line);
    }

    let prompt = '';
    if (conversationLines.length > 0) {
      prompt += '## Conversation History\n\n' + conversationLines.join('\n\n') + '\n\n---\n\n';
    }
    const userPart = message.trim()
      ? `[User]: ${message}`
      : (images?.length ? '[User]: (see attached images)' : '[User]: ');
    prompt += `${userPart}\n\nRespond to the latest user message.`;

    // Run agent in background
    const abortController = new AbortController();
    this.runningControllers.set(sessionId, abortController);

    // Pass current images (with base64 data) to runAgent for multimodal SDK prompt
    const currentImages = images;

    this.runAgent(sessionId, projectPath, systemPrompt, prompt, abortController, agentLibName, onOutput, onMessage, currentImages).catch((err) => {
      this.runningControllers.delete(sessionId);
      onOutput(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
      onOutput(CHAT_COMPLETE_SENTINEL);
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
      // Clean up failed agent after a delay
      setTimeout(() => {
        const agent = this.runningAgents.get(sessionId);
        if (agent && agent.status === 'failed') {
          this.runningAgents.delete(sessionId);
        }
      }, 5000);
    });

    return { userMessage, sessionId };
  }

  stop(sessionId: string): void {
    const controller = this.runningControllers.get(sessionId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(sessionId);
      const agent = this.runningAgents.get(sessionId);
      if (agent && agent.status === 'running') {
        agent.status = 'failed';
        agent.lastActivity = Date.now();
      }
    }
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    return this.chatMessageStore.getMessagesForSession(sessionId);
  }

  async clearMessages(sessionId: string): Promise<void> {
    this.stop(sessionId);
    return this.chatMessageStore.clearMessages(sessionId);
  }

  async summarizeMessages(sessionId: string): Promise<ChatMessage[]> {
    this.stop(sessionId);

    const messages = await this.chatMessageStore.getMessagesForSession(sessionId);
    if (messages.length === 0) return [];

    // Sum historical costs from existing messages
    let historicalInputTokens = 0;
    let historicalOutputTokens = 0;
    for (const m of messages) {
      historicalInputTokens += m.costInputTokens ?? 0;
      historicalOutputTokens += m.costOutputTokens ?? 0;
    }

    // Build a summarization prompt
    const conversationText = messages.map((m) => {
      const roleLabel = m.role === 'user' ? 'User' : m.role === 'assistant' ? 'Assistant' : 'System';
      const text = m.role === 'user' ? parseUserContent(m.content).text
        : m.role === 'assistant' ? extractTextFromContent(m.content) : m.content;
      return `[${roleLabel}]: ${text}`;
    }).join('\n\n');

    const summaryPrompt = `Summarize the following conversation concisely. Capture key topics discussed, decisions made, and important context. Output only the summary text, nothing else.\n\n${conversationText}`;

    let summaryText = '';
    let summaryCostInput: number | undefined;
    let summaryCostOutput: number | undefined;
    try {
      await this.runSdkQuery(summaryPrompt, { maxTurns: 1 }, {
        onText: (text) => { summaryText += text; },
        onResult: (msg) => {
          summaryCostInput = msg.usage?.input_tokens;
          summaryCostOutput = msg.usage?.output_tokens;
        },
      });
    } catch (err) {
      summaryText = `[Summary generation failed: ${err instanceof Error ? err.message : String(err)}]\n\nOriginal conversation had ${messages.length} messages.`;
    }

    if (!summaryText.trim()) {
      summaryText = `Conversation summary: ${messages.length} messages exchanged.`;
    }

    // Combine historical costs + summarization costs onto the summary message
    const totalInputTokens = historicalInputTokens + (summaryCostInput ?? 0);
    const totalOutputTokens = historicalOutputTokens + (summaryCostOutput ?? 0);

    const result = await this.chatMessageStore.replaceAllMessages(sessionId, [
      {
        sessionId,
        role: 'system',
        content: `[Conversation Summary]\n\n${summaryText}`,
        costInputTokens: totalInputTokens || undefined,
        costOutputTokens: totalOutputTokens || undefined,
      },
    ]);

    return result;
  }

  async getRunningAgents(): Promise<RunningAgent[]> {
    // Clean up stale agents (older than 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    for (const [sessionId, agent] of this.runningAgents) {
      if (agent.status !== 'running' && agent.lastActivity < oneHourAgo) {
        this.runningAgents.delete(sessionId);
      }
    }
    return Array.from(this.runningAgents.values());
  }

  private async resolveScope(session: { scopeType: string; scopeId: string }): Promise<{
    projectPath: string;
    systemPrompt: string;
    projectId: string;
    projectName: string;
    projectDefaultAgentLib?: string;
  }> {
    if (session.scopeType === 'task') {
      const task = await this.taskStore.getTask(session.scopeId);
      if (!task) throw new Error(`Task not found: ${session.scopeId}`);
      const project = await this.projectStore.getProject(task.projectId);
      if (!project?.path) throw new Error(`Project not found or has no path for task: ${session.scopeId}`);
      const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);
      const systemPrompt = this.buildTaskSystemPrompt(task, pipeline?.name ?? task.pipelineId);
      return {
        projectPath: project.path,
        systemPrompt,
        projectId: task.projectId,
        projectName: project.name,
        projectDefaultAgentLib: project.config?.defaultAgentLib as string | undefined,
      };
    }

    if (session.scopeType !== 'project') {
      throw new Error(`Unknown scope type: ${session.scopeType}`);
    }

    // Project scope
    const project = await this.projectStore.getProject(session.scopeId);
    if (!project?.path) throw new Error(`Project not found or has no path: ${session.scopeId}`);
    return {
      projectPath: project.path,
      systemPrompt: PROJECT_SYSTEM_PROMPT,
      projectId: session.scopeId,
      projectName: project.name,
      projectDefaultAgentLib: project.config?.defaultAgentLib as string | undefined,
    };
  }

  private buildTaskSystemPrompt(
    task: { id: string; title: string; status: string; description?: string | null; priority?: number; assignee?: string | null; plan?: string | null; technicalDesign?: string | null },
    pipelineName: string,
  ): string {
    const lines: string[] = [
      `You are a task assistant for task #${task.id}: "${task.title}".`,
      `Current status: ${task.status} | Pipeline: ${pipelineName}`,
      '',
      '## Task Details',
    ];

    if (task.description) lines.push(`- Description: ${task.description}`);
    if (task.priority !== undefined) lines.push(`- Priority: P${task.priority}`);
    if (task.assignee) lines.push(`- Assignee: ${task.assignee}`);
    if (task.plan) lines.push(`\n### Plan\n${task.plan}`);
    if (task.technicalDesign) lines.push(`\n### Technical Design\n${task.technicalDesign}`);

    lines.push('');
    lines.push('## Capabilities');
    lines.push('- Read and explore project files (Read, Glob, Grep, LS tools)');
    lines.push('- Run `npx agents-manager` CLI commands to manage THIS task (via Bash tool)');
    lines.push('- Answer questions about the task, code, and project');
    lines.push('');
    lines.push('## Rules');
    lines.push('- You MUST NOT modify any files. Do not use Write, Edit, MultiEdit, or NotebookEdit tools.');
    lines.push(`- Focus on task #${task.id}. Use \`npx agents-manager tasks get ${task.id}\` to refresh task state.`);
    lines.push('- Be concise and helpful. Format responses with markdown when useful.');
    lines.push('- When the user asks you to do something that requires modifying files, explain that you can only read files but can help plan changes or create tasks.');
    lines.push('');
    lines.push('## Useful commands');
    lines.push(`- npx agents-manager tasks get ${task.id}`);
    lines.push(`- npx agents-manager tasks update ${task.id} --title/--description/--priority/--assignee`);
    lines.push(`- npx agents-manager tasks transition ${task.id} <status>`);
    lines.push(`- npx agents-manager tasks transitions ${task.id}`);
    lines.push(`- npx agents-manager tasks subtask list/add/update/remove ${task.id}`);
    lines.push(`- npx agents-manager deps list/add/remove ${task.id}`);
    lines.push(`- npx agents-manager events list --task ${task.id}`);
    lines.push(`- npx agents-manager prompts list --task ${task.id}`);

    return lines.join('\n');
  }

  private async runAgent(
    sessionId: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    abortController: AbortController,
    agentLibName: string,
    onOutput: (chunk: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
    images?: ChatImage[],
  ): Promise<void> {
    // Determine whether to use the AgentLib abstraction or the direct SDK
    const useAgentLib = agentLibName !== DEFAULT_AGENT_LIB;

    // Set up sandbox: read-only access to project path, block write tools
    const sandboxGuard = new SandboxGuard([], [projectPath]);

    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;
    const turnMessages: AgentChatMessage[] = [];

    // Safe wrapper: IPC delivery failure should not abort the agent stream
    const emitMessage = (msg: AgentChatMessage) => {
      try {
        onMessage?.(msg);
      } catch (err) {
        console.warn('[ChatAgentService] IPC message delivery failed:', err);
      }
      // Update last activity (outside try so IPC failure does not skip it)
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.lastActivity = Date.now();
      }
      // Collect all messages except usage (stored in row-level cost fields)
      if (msg.type !== 'usage') {
        turnMessages.push(msg);
      }
    };

    try {
      if (useAgentLib) {
        // Use AgentLib abstraction for non-claude-code engines
        if (images && images.length > 0) {
          const warning = '\n[Warning: Image attachments are only supported with Claude Code engine. Images will be ignored.]\n';
          onOutput(warning);
          emitMessage({ type: 'assistant_text', text: warning, timestamp: Date.now() });
        }
        // Wire abort signal to AgentLib.stop() so the Stop button works
        const lib = this.agentLibRegistry.getLib(agentLibName);
        abortController.signal.addEventListener('abort', () => {
          lib.stop(sessionId).catch(err => console.warn('[ChatAgentService] Failed to stop agent lib:', err));
        });
        await this.runViaAgentLib(lib, sessionId, projectPath, systemPrompt, prompt, onOutput, emitMessage);
      } else {
        // Use direct SDK for claude-code (preserves existing rich streaming behavior)
        await this.runViaDirectSdk(sessionId, projectPath, systemPrompt, prompt, abortController, sandboxGuard, onOutput, emitMessage, (input, output) => {
          costInputTokens = input;
          costOutputTokens = output;
        }, images);
      }

      // Mark as completed successfully
      const agent = this.runningAgents.get(sessionId);
      if (agent) {
        agent.status = 'completed';
        agent.lastActivity = Date.now();
      }
    } finally {
      this.runningControllers.delete(sessionId);

      // Clean up completed agent after a delay to allow UI to show completion status
      setTimeout(() => {
        const agent = this.runningAgents.get(sessionId);
        if (agent && agent.status !== 'running') {
          this.runningAgents.delete(sessionId);
        }
      }, 5000); // 5 second delay

      // Persist assistant response with cost data (full structured messages as JSON)
      if (turnMessages.length > 0) {
        try {
          await this.chatMessageStore.addMessage({
            sessionId,
            role: 'assistant',
            content: JSON.stringify(turnMessages),
            costInputTokens,
            costOutputTokens,
          });
        } catch (persistErr) {
          console.error('[ChatAgentService] Failed to persist assistant response:', persistErr);
          try { onOutput('\n[Warning: Failed to save this response. It may not appear after refresh.]\n'); } catch (deliveryErr) { console.warn('[ChatAgentService] persist-warning delivery failed:', deliveryErr); }
        }
      }

      onOutput(CHAT_COMPLETE_SENTINEL);
    }
  }

  private async runViaAgentLib(
    lib: import('../interfaces/agent-lib').IAgentLib,
    sessionId: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    onOutput: (chunk: string) => void,
    emitMessage: (msg: AgentChatMessage) => void,
  ): Promise<void> {

    const callbacks: AgentLibCallbacks = {
      onOutput: (chunk: string) => {
        onOutput(chunk);
        emitMessage({ type: 'assistant_text', text: chunk, timestamp: Date.now() });
      },
      onMessage: (msg: AgentChatMessage) => {
        emitMessage(msg);
      },
    };

    const result = await lib.execute(sessionId, {
      prompt: `${systemPrompt}\n\n${prompt}`,
      cwd: projectPath,
      maxTurns: 50,
      timeoutMs: 300000,
      allowedPaths: [],
      readOnlyPaths: [projectPath],
      readOnly: true,
    }, callbacks);

    if (result.costInputTokens != null && result.costOutputTokens != null) {
      emitMessage({
        type: 'usage',
        inputTokens: result.costInputTokens,
        outputTokens: result.costOutputTokens,
        timestamp: Date.now(),
      });
    }

    if (result.error) {
      onOutput(`\n[Agent error: ${result.error}]\n`);
      emitMessage({ type: 'assistant_text', text: `\n[Agent error: ${result.error}]\n`, timestamp: Date.now() });
    }
  }

  private async runViaDirectSdk(
    sessionId: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    abortController: AbortController,
    sandboxGuard: SandboxGuard,
    onOutput: (chunk: string) => void,
    emitMessage: (msg: AgentChatMessage) => void,
    onCost: (input: number | undefined, output: number | undefined) => void,
    images?: ChatImage[],
  ): Promise<void> {
    // Build prompt: if images are present, use multimodal content blocks
    const fullPromptText = `${systemPrompt}\n\n${prompt}`;
    let sdkPrompt: string | AsyncIterable<{ message: { role: string; content: unknown[] } }>;

    if (images && images.length > 0) {
      const contentBlocks: unknown[] = [
        { type: 'text', text: fullPromptText },
      ];
      for (const img of images) {
        contentBlocks.push({
          type: 'image',
          source: {
            type: 'base64',
            media_type: img.mediaType,
            data: img.base64,
          },
        });
      }
      // Wrap in an async iterable that yields a single user message
      sdkPrompt = (async function* () {
        yield { message: { role: 'user', content: contentBlocks } };
      })();
    } else {
      sdkPrompt = fullPromptText;
    }

    await this.runSdkQuery(
      sdkPrompt,
      {
        cwd: projectPath,
        abortController,
        permissionMode: 'bypassPermissions',
        allowDangerouslySkipPermissions: true,
        maxTurns: 50,
        hooks: {
          preToolUse: (toolName: string, toolInput: Record<string, unknown>) => {
            // Hard-block write tools
            if (WRITE_TOOL_NAMES.has(toolName)) {
              return { decision: 'block', reason: 'Chat agent has read-only access. File modifications are not allowed.' };
            }
            const result = sandboxGuard.evaluateToolCall(toolName, toolInput);
            if (!result.allow) {
              return { decision: 'block', reason: result.reason };
            }
            return undefined;
          },
        },
      },
      {
        onText: (text) => {
          onOutput(text);
          emitMessage({ type: 'assistant_text', text, timestamp: Date.now() });
        },
        onToolUse: (block) => {
          const toolSummary = `\n> Tool: ${block.name}\n`;
          onOutput(toolSummary);
          emitMessage({
            type: 'tool_use',
            toolName: block.name,
            toolId: block.id,
            input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}, null, 2),
            timestamp: Date.now(),
          });
        },
        onResult: (resultMsg) => {
          if (resultMsg.errors?.length) {
            const errorText = `\n[Agent errors: ${resultMsg.errors.join('; ')}]\n`;
            onOutput(errorText);
            emitMessage({ type: 'assistant_text', text: errorText, timestamp: Date.now() });
          }
          const costIn = resultMsg.usage?.input_tokens;
          const costOut = resultMsg.usage?.output_tokens;
          onCost(costIn, costOut);
          if (costIn != null && costOut != null) {
            emitMessage({
              type: 'usage',
              inputTokens: costIn,
              outputTokens: costOut,
              timestamp: Date.now(),
            });
          }
        },
        onUserToolResult: (toolUseId, content) => {
          emitMessage({
            type: 'tool_result',
            toolId: toolUseId,
            result: content,
            timestamp: Date.now(),
          });
        },
      },
    );
  }

  /**
   * Shared helper that loads the SDK `query()` function, iterates over
   * the resulting async stream, and dispatches events to the provided
   * callbacks. Used by both `runViaDirectSdk` (chat) and
   * `summarizeMessages` (one-shot summarization) to avoid duplicating
   * the SDK message loop.
   */
  private async runSdkQuery(
    prompt: string | AsyncIterable<unknown>,
    options: Record<string, unknown>,
    callbacks: SdkQueryCallbacks,
  ): Promise<void> {
    const query = await this.loadQuery();

    for await (const message of query({ prompt, options }) as AsyncIterable<SdkStreamMessage>) {
      if (message.type === 'assistant') {
        const assistantMsg = message as SdkAssistantMessage;
        for (const block of assistantMsg.message.content) {
          if (block.type === 'text') {
            callbacks.onText?.(block.text);
          } else if (block.type === 'tool_use') {
            callbacks.onToolUse?.(block as SdkToolUseBlock & { id?: string });
          }
        }
      } else if (message.type === 'result') {
        callbacks.onResult?.(message as SdkResultMessage);
      } else if (message.type === 'user') {
        // SDK emits tool results as SDKUserMessage with tool_result content blocks
        const userMsg = message as unknown as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: unknown }> } };
        if (!userMsg.message?.content) {
          console.warn('[ChatAgentService] user message with unexpected structure:', JSON.stringify(message).slice(0, 200));
        } else {
          for (const block of userMsg.message.content) {
            if (block.type === 'tool_result' && block.tool_use_id) {
              const resultContent = typeof block.content === 'string' ? block.content
                : (Array.isArray(block.content) ? block.content.map((b: { text?: string }) => b.text || '').join('') : '(no output)');
              callbacks.onUserToolResult?.(block.tool_use_id, resultContent);
            }
          }
        }
      } else {
        // Handle other message types that may contain text content
        const otherMsg = message as SdkOtherMessage;
        if (otherMsg.message?.content) {
          for (const block of otherMsg.message.content) {
            if (block.type === 'text') {
              callbacks.onText?.(block.text);
            }
          }
        }
      }
    }
  }

  private async loadQuery(): Promise<(opts: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string | AsyncIterable<unknown>; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
