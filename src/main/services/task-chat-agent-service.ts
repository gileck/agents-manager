import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { ITaskStore } from '../interfaces/task-store';
import type { IProjectStore } from '../interfaces/project-store';
import type { IPipelineStore } from '../interfaces/pipeline-store';
import type { ChatMessage, AgentChatMessage } from '../../shared/types';
import { SandboxGuard } from './sandbox-guard';

const importESM = new Function('specifier', 'return import(specifier)') as (specifier: string) => Promise<Record<string, unknown>>;

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

const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

const WRITE_TOOL_NAMES = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);

function taskScopeKey(taskId: string): string {
  return `task:${taskId}`;
}

export class TaskChatAgentService {
  private runningControllers = new Map<string, AbortController>();

  constructor(
    private chatMessageStore: IChatMessageStore,
    private taskStore: ITaskStore,
    private projectStore: IProjectStore,
    private pipelineStore: IPipelineStore,
  ) {}

  async send(
    taskId: string,
    message: string,
    onOutput: (chunk: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<{ userMessage: ChatMessage; sessionId: string }> {
    this.stop(taskId);

    const scopeKey = taskScopeKey(taskId);

    const userMessage = await this.chatMessageStore.addMessage({
      sessionId: scopeKey,
      role: 'user',
      content: message,
    });

    const sessionId = userMessage.id;

    // Load task, project, and pipeline for context
    const task = await this.taskStore.getTask(taskId);
    if (!task) throw new Error(`Task not found: ${taskId}`);
    const project = await this.projectStore.getProject(task.projectId);
    const projectPath = project?.path || process.cwd();
    const pipeline = await this.pipelineStore.getPipeline(task.pipelineId);

    // Build task-specific system prompt
    const systemPrompt = this.buildSystemPrompt(task, pipeline?.name ?? task.pipelineId);

    // Load conversation history
    const history = await this.chatMessageStore.getMessagesForSession(scopeKey);

    const conversationLines: string[] = [];
    for (const msg of history.slice(0, -1)) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      conversationLines.push(`[${roleLabel}]: ${msg.content}`);
    }

    let prompt = '';
    if (conversationLines.length > 0) {
      prompt += '## Conversation History\n\n' + conversationLines.join('\n\n') + '\n\n---\n\n';
    }
    prompt += `[User]: ${message}\n\nRespond to the latest user message.`;

    const abortController = new AbortController();
    this.runningControllers.set(taskId, abortController);

    this.runAgent(taskId, scopeKey, projectPath, systemPrompt, prompt, abortController, onOutput, onMessage).catch((err) => {
      onOutput(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
      onOutput(CHAT_COMPLETE_SENTINEL);
    });

    return { userMessage, sessionId };
  }

  stop(taskId: string): void {
    const controller = this.runningControllers.get(taskId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(taskId);
    }
  }

  async getMessages(taskId: string): Promise<ChatMessage[]> {
    return this.chatMessageStore.getMessagesForSession(taskScopeKey(taskId));
  }

  async clearMessages(taskId: string): Promise<void> {
    this.stop(taskId);
    return this.chatMessageStore.clearMessages(taskScopeKey(taskId));
  }

  private buildSystemPrompt(
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
    taskId: string,
    scopeKey: string,
    projectPath: string,
    systemPrompt: string,
    prompt: string,
    abortController: AbortController,
    onOutput: (chunk: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<void> {
    const query = await this.loadQuery();

    const sandboxGuard = new SandboxGuard([], [projectPath]);

    let resultText = '';
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;

    const emitMessage = (msg: AgentChatMessage) => {
      try { onMessage?.(msg); } catch (err) { console.warn('[TaskChatAgentService] emitMessage failed:', err); }
    };

    try {
      for await (const message of query({
        prompt: `${systemPrompt}\n\n${prompt}`,
        options: {
          cwd: projectPath,
          abortController,
          permissionMode: 'bypassPermissions',
          allowDangerouslySkipPermissions: true,
          maxTurns: 50,
          hooks: {
            preToolUse: (toolName: string, toolInput: Record<string, unknown>) => {
              if (WRITE_TOOL_NAMES.has(toolName)) {
                return { decision: 'block', reason: 'Task chat agent has read-only access. File modifications are not allowed.' };
              }
              const result = sandboxGuard.evaluateToolCall(toolName, toolInput);
              if (!result.allow) {
                return { decision: 'block', reason: result.reason };
              }
              return undefined;
            },
          },
        },
      }) as AsyncIterable<SdkStreamMessage>) {
        if (message.type === 'assistant') {
          const assistantMsg = message as SdkAssistantMessage;
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              resultText += block.text;
              onOutput(block.text);
              emitMessage({ type: 'assistant_text', text: block.text, timestamp: Date.now() });
            } else if (block.type === 'tool_use') {
              const toolBlock = block as SdkToolUseBlock & { id?: string };
              const toolSummary = `\n> Tool: ${block.name}\n`;
              onOutput(toolSummary);
              emitMessage({
                type: 'tool_use',
                toolName: block.name,
                toolId: toolBlock.id,
                input: typeof block.input === 'string' ? block.input : JSON.stringify(block.input ?? {}, null, 2),
                timestamp: Date.now(),
              });
            }
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SdkResultMessage;
          if (resultMsg.errors?.length) {
            const errorText = `\n[Agent errors: ${resultMsg.errors.join('; ')}]\n`;
            onOutput(errorText);
            emitMessage({ type: 'assistant_text', text: errorText, timestamp: Date.now() });
          }
          costInputTokens = resultMsg.usage?.input_tokens;
          costOutputTokens = resultMsg.usage?.output_tokens;
          if (costInputTokens != null && costOutputTokens != null) {
            emitMessage({
              type: 'usage',
              inputTokens: costInputTokens,
              outputTokens: costOutputTokens,
              timestamp: Date.now(),
            });
          }
        } else if (message.type === 'user') {
          // SDK emits tool results as SDKUserMessage with tool_result content blocks
          const userMsg = message as unknown as { message?: { content?: Array<{ type: string; tool_use_id?: string; content?: unknown }> } };
          if (!userMsg.message?.content) {
            console.warn('[TaskChatAgentService] user message with unexpected structure:', JSON.stringify(message).slice(0, 200));
          } else {
            for (const block of userMsg.message.content) {
              if (block.type === 'tool_result' && block.tool_use_id) {
                const resultContent = typeof block.content === 'string' ? block.content
                  : (Array.isArray(block.content) ? block.content.map((b: { text?: string }) => b.text || '').join('') : '(no output)');
                emitMessage({
                  type: 'tool_result',
                  toolId: block.tool_use_id,
                  result: resultContent,
                  timestamp: Date.now(),
                });
              }
            }
          }
        } else {
          const otherMsg = message as SdkOtherMessage;
          if (otherMsg.message?.content) {
            for (const block of otherMsg.message.content) {
              if (block.type === 'text') {
                resultText += block.text;
                onOutput(block.text);
                emitMessage({ type: 'assistant_text', text: block.text, timestamp: Date.now() });
              }
            }
          }
        }
      }
    } finally {
      // Only delete if this is still the active controller (avoids race with a new send())
      if (this.runningControllers.get(taskId) === abortController) {
        this.runningControllers.delete(taskId);
      }

      if (resultText.trim()) {
        try {
          await this.chatMessageStore.addMessage({
            sessionId: scopeKey,
            role: 'assistant',
            content: resultText,
            costInputTokens,
            costOutputTokens,
          });
        } catch (persistErr) {
          console.error('[TaskChatAgentService] Failed to persist assistant response:', persistErr);
        }
      }

      onOutput(CHAT_COMPLETE_SENTINEL);
    }
  }

  private async loadQuery(): Promise<(opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
