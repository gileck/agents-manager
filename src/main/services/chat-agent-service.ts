import type { IChatMessageStore } from '../interfaces/chat-message-store';
import type { IProjectStore } from '../interfaces/project-store';
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

const SYSTEM_PROMPT = `You are a project assistant with read-only access to the codebase and full access to the \`am\` CLI for task management.

## Capabilities
- Read and explore project files (Read, Glob, Grep, LS tools)
- Run the \`am\` CLI to manage tasks, features, pipelines, and more (via Bash tool)
- Answer questions about code, architecture, and project state

## Rules
- You MUST NOT modify any files. Do not use Write, Edit, MultiEdit, or NotebookEdit tools.
- You CAN use Bash to run \`am\` CLI commands (e.g. \`am tasks list\`, \`am tasks create\`, \`am tasks update\`).
- You CAN use Bash for read-only commands like \`ls\`, \`cat\`, \`git log\`, \`git diff\`, etc.
- Be concise and helpful. Format responses with markdown when useful.
- When the user asks you to do something that requires modifying files, explain that you can only read files but can help plan changes or create tasks.`;

export class ChatAgentService {
  private runningControllers = new Map<string, AbortController>();

  constructor(
    private chatMessageStore: IChatMessageStore,
    private projectStore: IProjectStore,
  ) {}

  async send(
    projectId: string,
    message: string,
    onOutput: (chunk: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<{ userMessage: ChatMessage; sessionId: string }> {
    // Abort any previous running chat for this project
    this.stop(projectId);

    // Persist user message
    const userMessage = await this.chatMessageStore.addMessage({
      projectId,
      role: 'user',
      content: message,
    });

    const sessionId = userMessage.id;

    // Load project for path info
    const project = await this.projectStore.getProject(projectId);
    const projectPath = project?.path || process.cwd();

    // Load conversation history
    const history = await this.chatMessageStore.getMessagesForProject(projectId);

    // Build prompt with conversation history
    const conversationLines: string[] = [];
    // All messages except the latest user message (which becomes the prompt)
    for (const msg of history.slice(0, -1)) {
      const roleLabel = msg.role === 'user' ? 'User' : msg.role === 'assistant' ? 'Assistant' : 'System';
      conversationLines.push(`[${roleLabel}]: ${msg.content}`);
    }

    let prompt = '';
    if (conversationLines.length > 0) {
      prompt += '## Conversation History\n\n' + conversationLines.join('\n\n') + '\n\n---\n\n';
    }
    prompt += `[User]: ${message}\n\nRespond to the latest user message.`;

    // Run agent in background
    const abortController = new AbortController();
    this.runningControllers.set(projectId, abortController);

    this.runAgent(projectId, projectPath, prompt, abortController, onOutput, onMessage).catch((err) => {
      onOutput(`\nError: ${err instanceof Error ? err.message : String(err)}\n`);
      onOutput(CHAT_COMPLETE_SENTINEL);
    });

    return { userMessage, sessionId };
  }

  stop(projectId: string): void {
    const controller = this.runningControllers.get(projectId);
    if (controller) {
      controller.abort();
      this.runningControllers.delete(projectId);
    }
  }

  async getMessages(projectId: string): Promise<ChatMessage[]> {
    return this.chatMessageStore.getMessagesForProject(projectId);
  }

  async clearMessages(projectId: string): Promise<void> {
    this.stop(projectId);
    return this.chatMessageStore.clearMessages(projectId);
  }

  async summarizeMessages(projectId: string): Promise<ChatMessage[]> {
    this.stop(projectId);

    const messages = await this.chatMessageStore.getMessagesForProject(projectId);
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
      return `[${roleLabel}]: ${m.content}`;
    }).join('\n\n');

    const summaryPrompt = `Summarize the following conversation concisely. Capture key topics discussed, decisions made, and important context. Output only the summary text, nothing else.\n\n${conversationText}`;

    let summaryText = '';
    let summaryCostInput: number | undefined;
    let summaryCostOutput: number | undefined;
    try {
      const query = await this.loadQuery();
      for await (const message of query({
        prompt: summaryPrompt,
        options: {
          maxTurns: 1,
        },
      }) as AsyncIterable<SdkStreamMessage>) {
        if (message.type === 'assistant') {
          const assistantMsg = message as SdkAssistantMessage;
          for (const block of assistantMsg.message.content) {
            if (block.type === 'text') {
              summaryText += block.text;
            }
          }
        } else if (message.type === 'result') {
          const resultMsg = message as SdkResultMessage;
          summaryCostInput = resultMsg.usage?.input_tokens;
          summaryCostOutput = resultMsg.usage?.output_tokens;
        }
      }
    } catch (err) {
      summaryText = `[Summary generation failed: ${err instanceof Error ? err.message : String(err)}]\n\nOriginal conversation had ${messages.length} messages.`;
    }

    if (!summaryText.trim()) {
      summaryText = `Conversation summary: ${messages.length} messages exchanged.`;
    }

    // Combine historical costs + summarization costs onto the summary message
    const totalInputTokens = historicalInputTokens + (summaryCostInput ?? 0);
    const totalOutputTokens = historicalOutputTokens + (summaryCostOutput ?? 0);

    const result = await this.chatMessageStore.replaceAllMessages(projectId, [
      {
        projectId,
        role: 'system',
        content: `[Conversation Summary]\n\n${summaryText}`,
        costInputTokens: totalInputTokens || undefined,
        costOutputTokens: totalOutputTokens || undefined,
      },
    ]);

    return result;
  }

  private async runAgent(
    projectId: string,
    projectPath: string,
    prompt: string,
    abortController: AbortController,
    onOutput: (chunk: string) => void,
    onMessage?: (msg: AgentChatMessage) => void,
  ): Promise<void> {
    const query = await this.loadQuery();

    // Set up sandbox: read-only access to project path, block write tools
    const sandboxGuard = new SandboxGuard([], [projectPath]);

    let resultText = '';
    let costInputTokens: number | undefined;
    let costOutputTokens: number | undefined;

    // Track tool_use IDs in FIFO order so we can match tool_result events
    const pendingToolIds: string[] = [];

    // Safe wrapper: IPC delivery failure should not abort the agent stream
    const emitMessage = (msg: AgentChatMessage) => {
      try { onMessage?.(msg); } catch { /* IPC delivery failure is non-fatal */ }
    };

    try {
      for await (const message of query({
        prompt: `${SYSTEM_PROMPT}\n\n${prompt}`,
        options: {
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
              if (toolBlock.id) pendingToolIds.push(toolBlock.id);
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
        } else {
          const raw = message as unknown as Record<string, unknown>;
          // Check if this is a tool_result message
          if (raw.type === 'tool_result' || raw.subtype === 'tool_result') {
            const resultContent = (typeof raw.result === 'string' ? raw.result : '')
              || (typeof raw.summary === 'string' ? raw.summary : '')
              || '(no output)';
            const matchedToolId = pendingToolIds.shift();
            emitMessage({
              type: 'tool_result',
              toolId: matchedToolId,
              result: resultContent,
              timestamp: Date.now(),
            });
          }
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
      this.runningControllers.delete(projectId);

      // Persist assistant response with cost data
      if (resultText.trim()) {
        await this.chatMessageStore.addMessage({
          projectId,
          role: 'assistant',
          content: resultText,
          costInputTokens,
          costOutputTokens,
        });
      }

      onOutput(CHAT_COMPLETE_SENTINEL);
    }
  }

  private async loadQuery(): Promise<(opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>> {
    const mod = await importESM('@anthropic-ai/claude-agent-sdk');
    return mod.query as (opts: { prompt: string; options?: Record<string, unknown> }) => AsyncIterable<SdkStreamMessage>;
  }
}
