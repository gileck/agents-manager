/**
 * Conversation utility functions: summarization and auto-naming.
 *
 * These are one-shot LLM calls (not multi-turn agent execution) that
 * use lib.query() for a single prompt→response interaction.
 */

import type { IChatMessageStore } from '../../interfaces/chat-message-store';
import type { IChatSessionStore } from '../../interfaces/chat-session-store';
import type { IAgentLib } from '../../interfaces/agent-lib';
import type { ChatMessage, ChatSession } from '../../../shared/types';
import { getAppLogger } from '../app-logger';
import { parseUserContent, extractTextFromContent, isAutoNameableSession, THEMED_SESSION_LABELS } from './chat-agent-helpers';

// ---------------------------------------------------------------------------
// Context interface
// ---------------------------------------------------------------------------

export interface ConversationUtilsContext {
  chatMessageStore: IChatMessageStore;
  chatSessionStore: IChatSessionStore;
  compactedSessions: Set<string>;
  resolveLibForSession: (sessionId: string) => Promise<IAgentLib>;
  stop: (sessionId: string) => void;
}

// ---------------------------------------------------------------------------
// Summarize
// ---------------------------------------------------------------------------

export async function summarizeMessages(
  ctx: ConversationUtilsContext,
  sessionId: string,
): Promise<ChatMessage[]> {
  ctx.stop(sessionId);

  const messages = await ctx.chatMessageStore.getMessagesForSession(sessionId);
  if (messages.length === 0) return [];

  // Sum historical costs from existing messages
  let historicalInputTokens = 0;
  let historicalOutputTokens = 0;
  let historicalCacheReadInputTokens = 0;
  let historicalCacheCreationInputTokens = 0;
  let historicalTotalCostUsd = 0;
  for (const m of messages) {
    historicalInputTokens += m.costInputTokens ?? 0;
    historicalOutputTokens += m.costOutputTokens ?? 0;
    historicalCacheReadInputTokens += m.cacheReadInputTokens ?? 0;
    historicalCacheCreationInputTokens += m.cacheCreationInputTokens ?? 0;
    historicalTotalCostUsd += m.totalCostUsd ?? 0;
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
  let summaryCacheReadInputTokens: number | undefined;
  let summaryCacheCreationInputTokens: number | undefined;
  let summaryTotalCostUsd: number | undefined;
  try {
    const lib = await ctx.resolveLibForSession(sessionId);
    for await (const event of lib.query!(summaryPrompt, { maxTokens: 1000 })) {
      if (event.type === 'text') {
        summaryText += event.text;
      } else if (event.type === 'result') {
        summaryCostInput = event.usage?.input_tokens;
        summaryCostOutput = event.usage?.output_tokens;
        summaryCacheReadInputTokens = event.usage?.cache_read_input_tokens ?? undefined;
        summaryCacheCreationInputTokens = event.usage?.cache_creation_input_tokens ?? undefined;
        summaryTotalCostUsd = event.total_cost_usd ?? undefined;
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
  const totalCacheReadInputTokens = historicalCacheReadInputTokens + (summaryCacheReadInputTokens ?? 0);
  const totalCacheCreationInputTokens = historicalCacheCreationInputTokens + (summaryCacheCreationInputTokens ?? 0);
  const totalCostUsdValue = historicalTotalCostUsd + (summaryTotalCostUsd ?? 0);

  const summaryMsg = await ctx.chatMessageStore.addMessage({
    sessionId,
    role: 'system',
    content: `[Conversation Summary]\n\n${summaryText}`,
    costInputTokens: totalInputTokens || undefined,
    costOutputTokens: totalOutputTokens || undefined,
    cacheReadInputTokens: totalCacheReadInputTokens || undefined,
    cacheCreationInputTokens: totalCacheCreationInputTokens || undefined,
    totalCostUsd: totalCostUsdValue || undefined,
  });

  // Mark session as compacted so next sendMessage() starts a fresh SDK session
  ctx.compactedSessions.add(sessionId);

  return [summaryMsg];
}

// ---------------------------------------------------------------------------
// Auto-name
// ---------------------------------------------------------------------------

export async function autoNameSession(
  ctx: ConversationUtilsContext,
  sessionId: string,
  firstMessage: string,
  onRenamed: (session: ChatSession) => void,
  sessionName?: string,
): Promise<void> {
  try {
    const messageText = firstMessage.slice(0, 300);
    getAppLogger().info('ChatAgent', `Running autoNameSession with "${messageText.slice(0, 100)}"`);

    // Use an intent-aware prompt for themed threads (e.g. "Feature Request", "Bug Report")
    const themedContext = sessionName ? THEMED_SESSION_LABELS[sessionName] : undefined;
    const prompt = themedContext
      ? `Generate a short, descriptive title (3-8 words) for a ${themedContext} thread based on this first message. The title should clearly describe the topic. Return ONLY the title, with no quotes, punctuation, or explanation.\n\nFirst message: ${messageText}`
      : `Generate a short, descriptive name (3-6 words) for a chat session based on this first message. Return ONLY the name, with no quotes, punctuation, or explanation.\n\nFirst message: ${messageText}`;

    let generatedName = '';
    const start = Date.now();
    const lib = await ctx.resolveLibForSession(sessionId);
    for await (const event of lib.query!(prompt)) {
      if (event.type === 'text') generatedName += event.text;
    }
    const elapsed = Date.now() - start;

    // Strip leading/trailing punctuation/whitespace; enforce 50-char max
    const cleanedName = generatedName.trim().replace(/^[^\w]+|[^\w]+$/g, '').slice(0, 50);
    if (!cleanedName) return;

    // Re-fetch to guard against manual rename that happened during the async call
    const session = await ctx.chatSessionStore.getSession(sessionId);
    if (!session || !isAutoNameableSession(session.name)) return;

    const updatedSession = await ctx.chatSessionStore.updateSession(sessionId, { name: cleanedName });
    if (!updatedSession) return;

    getAppLogger().info('ChatAgent', `Changed session name to "${cleanedName}" (query took ${elapsed}ms)`);
    onRenamed(updatedSession);
  } catch {
    // Silent failure — session retains its default name
  }
}
