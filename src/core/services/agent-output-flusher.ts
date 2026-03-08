import type { AgentChatMessage, AgentRunUpdateInput } from '../../shared/types';
import type { IAgentRunStore } from '../interfaces/agent-run-store';
import type { IAgent } from '../interfaces/agent';

/** Maximum output buffer size before truncation (5 MB). */
const MAX_OUTPUT_BUFFER = 5 * 1024 * 1024;

/** Maximum number of agent messages to buffer. */
const MAX_MESSAGES_BUFFER = 10_000;

/** Interval between periodic DB flushes (ms). */
const FLUSH_INTERVAL_MS = 3000;

/**
 * Buffers agent output text and structured messages, periodically
 * flushing them to the agent run store so data survives page refreshes.
 *
 * Also flushes live cost and progress data from the running agent instance.
 */
export class AgentOutputFlusher {
  private outputBuffer = '';
  private readonly messagesBuffer: AgentChatMessage[] = [];
  private flushInterval: ReturnType<typeof setInterval> | null = null;
  private metadataFlushed = false;
  private flushErrorCount = 0;

  constructor(
    private agentRunStore: IAgentRunStore,
    private runId: string,
    private agent: IAgent,
    private onLog: (message: string) => void,
  ) {}

  /** Start the periodic flush timer. */
  start(): void {
    if (this.flushInterval) return;
    this.flushInterval = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  /** Stop the periodic flush timer. */
  stop(): void {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
      this.flushInterval = null;
    }
  }

  /** Append text to the output buffer (capped at MAX_OUTPUT_BUFFER). */
  appendOutput(chunk: string): void {
    if (this.outputBuffer.length < MAX_OUTPUT_BUFFER) {
      this.outputBuffer += chunk;
      if (this.outputBuffer.length > MAX_OUTPUT_BUFFER) {
        this.outputBuffer = this.outputBuffer.slice(0, MAX_OUTPUT_BUFFER) + '\n[output truncated]';
      }
    }
  }

  /** Append a structured message to the messages buffer. */
  appendMessage(msg: AgentChatMessage): void {
    if (this.messagesBuffer.length < MAX_MESSAGES_BUFFER) {
      this.messagesBuffer.push(msg);
    }
  }

  /** Return a snapshot of buffered messages (for final persistence). */
  getBufferedMessages(): AgentChatMessage[] {
    return [...this.messagesBuffer];
  }

  /** Return the current buffered output text. */
  getBufferedOutput(): string {
    return this.outputBuffer;
  }

  private flush(): void {
    const flushData: AgentRunUpdateInput = {};
    if (this.outputBuffer) {
      flushData.output = this.outputBuffer;
    }
    if (this.messagesBuffer.length > 0) {
      flushData.messages = [...this.messagesBuffer];
    }
    // Flush live cost and progress data from agent
    const agentAny = this.agent as unknown as {
      accumulatedInputTokens?: number;
      accumulatedOutputTokens?: number;
      accumulatedCacheReadInputTokens?: number;
      accumulatedCacheCreationInputTokens?: number;
      lastMessageCount?: number;
      lastTimeout?: number;
      lastMaxTurns?: number;
    };
    if (agentAny.accumulatedInputTokens != null && agentAny.accumulatedInputTokens > 0) {
      flushData.costInputTokens = agentAny.accumulatedInputTokens;
    }
    if (agentAny.accumulatedOutputTokens != null && agentAny.accumulatedOutputTokens > 0) {
      flushData.costOutputTokens = agentAny.accumulatedOutputTokens;
    }
    if (agentAny.accumulatedCacheReadInputTokens != null && agentAny.accumulatedCacheReadInputTokens > 0) {
      flushData.cacheReadInputTokens = agentAny.accumulatedCacheReadInputTokens;
    }
    if (agentAny.accumulatedCacheCreationInputTokens != null && agentAny.accumulatedCacheCreationInputTokens > 0) {
      flushData.cacheCreationInputTokens = agentAny.accumulatedCacheCreationInputTokens;
    }
    if (agentAny.lastMessageCount != null && agentAny.lastMessageCount > 0) {
      flushData.messageCount = agentAny.lastMessageCount;
    }
    // Flush timeout/maxTurns once
    if (!this.metadataFlushed) {
      if (agentAny.lastTimeout != null) flushData.timeoutMs = agentAny.lastTimeout;
      if (agentAny.lastMaxTurns != null) flushData.maxTurns = agentAny.lastMaxTurns;
      if (agentAny.lastTimeout != null || agentAny.lastMaxTurns != null) this.metadataFlushed = true;
    }
    if (Object.keys(flushData).length > 0) {
      this.agentRunStore.updateRun(this.runId, flushData).catch((err) => {
        this.flushErrorCount++;
        if (this.flushErrorCount === 1 || this.flushErrorCount % 10 === 0) {
          this.onLog(`Flush to DB failed (count=${this.flushErrorCount}): ${err instanceof Error ? err.message : String(err)}`);
        }
      });
    }
  }
}
