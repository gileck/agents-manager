/**
 * Shared helpers, constants, and types for the chat agent subsystem.
 * Extracted from the monolithic chat-agent-service.ts to improve readability.
 */

import type { AgentChatMessage, ChatImage, ChatImageRef } from '../../../shared/types';
import type { SubagentDefinition } from '../../interfaces/agent-lib';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { getAppLogger } from '../app-logger';

// Re-export RunningAgent from shared types (canonical definition)
export type { RunningAgent } from '../../../shared/types';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface InjectedMessage {
  sessionId: string;
  content: string;
  metadata: Record<string, unknown>;
  queuedAt: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MEDIA_TYPE_TO_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};

export const WRITE_TOOL_NAMES = new Set([
  'Write', 'Edit', 'MultiEdit', 'NotebookEdit',
]);

export const DEFAULT_AGENT_LIB = 'claude-code';
export const CHAT_COMPLETE_SENTINEL = '__CHAT_COMPLETE__';

/**
 * Default subagent definitions for thread chat sessions.
 * These specialized subagents are available via the Task tool when running in
 * thread chat mode (desktop/telegram/cli sessions, not agent-chat or pipeline).
 */
export const DEFAULT_CHAT_SUBAGENTS: Record<string, SubagentDefinition> = {
  'code-reviewer': {
    description: 'Specialized for reviewing code changes. Delegates to this agent when asked to review diffs, PRs, or code quality.',
    prompt: 'You are a code review specialist. Analyze code changes for correctness, best practices, potential bugs, security issues, and readability. Provide specific, actionable feedback with file paths and line references.',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    model: 'sonnet',
    maxTurns: 15,
  },
  'researcher': {
    description: 'Specialized for codebase exploration and research. Delegates to this agent for understanding architecture, finding patterns, or investigating how things work.',
    prompt: 'You are a codebase research specialist. Explore the codebase to answer questions about architecture, patterns, dependencies, and implementation details. Be thorough in your search and provide comprehensive findings with relevant file paths.',
    tools: ['Read', 'Glob', 'Grep'],
    model: 'sonnet',
    maxTurns: 20,
  },
  'test-runner': {
    description: 'Specialized for running and analyzing tests. Delegates to this agent when asked to run tests, analyze test results, or investigate test failures.',
    prompt: 'You are a test execution and analysis specialist. Run tests, analyze results, identify failures, and provide clear summaries. When tests fail, investigate the root cause and suggest fixes.',
    tools: ['Read', 'Glob', 'Grep', 'Bash'],
    model: 'haiku',
    maxTurns: 10,
  },
};

/** Maps agent-chat agentRole → TaskContextEntry entryType for auto-saving responses. */
export const AGENT_ROLE_TO_FEEDBACK_ENTRY_TYPE: Record<string, string> = {
  planner: 'plan_feedback',
  designer: 'design_feedback',
  implementor: 'implementation_feedback',
  investigator: 'investigation_feedback',
  reviewer: 'review_feedback',
  'post-mortem-reviewer': 'post_mortem_feedback',
  'workflow-reviewer': 'workflow_review_feedback',
};

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Parse a user message content field that may be a JSON envelope with images and/or metadata. */
export function parseUserContent(content: string): { text: string; images?: ChatImageRef[]; metadata?: Record<string, unknown> } {
  if (content.startsWith('{')) {
    try {
      const parsed = JSON.parse(content);
      if (parsed && typeof parsed === 'object' && typeof parsed.text === 'string') {
        const images = Array.isArray(parsed.images) && parsed.images.length > 0
          ? (parsed.images as ChatImageRef[])
          : undefined;
        const metadata = parsed.metadata && typeof parsed.metadata === 'object'
          ? (parsed.metadata as Record<string, unknown>)
          : undefined;
        return { text: parsed.text, images, metadata };
      }
    } catch (err) {
      getAppLogger().warn('ChatAgentService', 'parseUserContent: Content starts with { but failed JSON parse', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return { text: content };
}

/** Extract plain text from a DB content field (handles both JSON array, JSON envelope, and legacy plain text). */
export function extractTextFromContent(content: string): string {
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
      getAppLogger().warn('ChatAgentService', 'extractTextFromContent: Content looks like JSON but failed to parse', { error: err instanceof Error ? err.message : String(err) });
    }
  }
  return parseUserContent(content).text;
}

/** Save images to disk and return refs with file paths. */
export async function saveImagesToDisk(sessionId: string, images: ChatImage[], imageStorageDir: string): Promise<ChatImageRef[]> {
  const safeSessionId = path.basename(sessionId);
  const baseDir = path.join(imageStorageDir, safeSessionId);
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

export function isDefaultSessionName(name: string): boolean {
  return name === 'General' || /^Session \d+$/.test(name);
}

/**
 * Session names set by themed thread creation (Feature Request, Bug Report, etc.)
 * that should still trigger auto-naming.
 * Maps label → short intent description for use in the auto-naming prompt.
 */
export const THEMED_SESSION_LABELS: Record<string, string> = {
  'Feature Request': 'feature request',
  'Bug Report': 'bug report',
  'Improvement': 'improvement',
  'Investigate Incident': 'incident investigation',
};

/** Check if a session name is eligible for auto-naming (default name or themed label). */
export function isAutoNameableSession(name: string): boolean {
  return isDefaultSessionName(name) || name in THEMED_SESSION_LABELS;
}

/** Parse plugins config from project config into typed array. */
export function parsePluginsConfig(raw: unknown): Array<{ type: 'local'; path: string }> | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const valid = raw.filter(
    (p): p is { type: 'local'; path: string } =>
      p && typeof p === 'object' && p.type === 'local' && typeof p.path === 'string',
  );
  return valid.length > 0 ? valid : undefined;
}

/** Tag an AgentChatMessage with a parent tool-use ID for UI nesting of subagent messages. */
export function tagNestedSubagentMessage(message: AgentChatMessage, parentToolUseId: string): AgentChatMessage | null {
  switch (message.type) {
    case 'assistant_text':
    case 'thinking':
    case 'tool_use':
    case 'tool_result':
      return {
        ...message,
        parentToolUseId,
      };
    case 'status':
    case 'agent_run_info':
      return null;
    default:
      return message;
  }
}
