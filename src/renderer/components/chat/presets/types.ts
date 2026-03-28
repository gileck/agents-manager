/**
 * Preset prop interfaces for the Chat UI components.
 *
 * These interfaces define the contract between the logic layer (hooks, utilities)
 * and UI rendering components. A "preset" is an alternative visual implementation
 * that consumes the same props — swapping the look-and-feel without changing behavior.
 */

import type {
  AgentChatMessage,
  ChatImage,
  ChatSession,
  PermissionMode,
  RunningAgent,
} from '../../../../shared/types';
import type { AgentSegment } from '../utils/group-messages';
import type { AgentLibOption, ModelOption } from '../ChatInput';
import type { ChatScope } from '../../../hooks/useChatSessions';
import type { useChatSessions } from '../../../hooks/useChatSessions';

// ---------------------------------------------------------------------------
// ChatPanel — top-level orchestrator
// ---------------------------------------------------------------------------

/** Props for the ChatPanel preset component. */
export interface ChatPanelPresetProps {
  /** Scope that determines which chat sessions are loaded. */
  scope: ChatScope;
  /** Optional override for the sessions hook return value. */
  sessionsOverride?: ReturnType<typeof useChatSessions>;
}

// ---------------------------------------------------------------------------
// ChatMessageList — renders the segmented message timeline
// ---------------------------------------------------------------------------

/** Props for the ChatMessageList preset component. */
export interface ChatMessageListPresetProps {
  /** Ordered array of chat messages to render. */
  messages: AgentChatMessage[];
  /** Whether the agent is currently running / streaming. */
  isRunning?: boolean;
  /** Whether the agent is waiting for user input (AskUserQuestion). Comes from useChat — single source of truth. */
  isWaitingForInput?: boolean;
  /** Called when the user edits & resends a previous message. */
  onEditMessage?: (text: string) => void;
  /** Called when the user clicks "Continue" or "Retry" after a stop/error. */
  onResume?: (text: string) => void;
  /** Called when the user allows or denies a tool permission request. */
  onPermissionResponse?: (requestId: string, allowed: boolean) => void;
}

// ---------------------------------------------------------------------------
// ChatInput — message composition area
// ---------------------------------------------------------------------------

/** Props for the ChatInput preset component. */
export interface ChatInputPresetProps {
  /** Callback to send a message, optionally with attached images. */
  onSend: (message: string, images?: ChatImage[]) => void;
  /** Callback to stop the running agent. */
  onStop?: () => void;
  /** Whether the agent is currently running. */
  isRunning: boolean;
  /** Whether a message is currently queued to be sent after the agent stops. */
  isQueued: boolean;
  /** Current token usage stats for displaying the context window indicator. */
  tokenUsage?: {
    inputTokens: number;
    outputTokens: number;
    lastContextInputTokens?: number | null;
    contextWindow?: number | null;
  };
  /** Available agent library engines. */
  agentLibs?: AgentLibOption[];
  /** Currently selected agent library name. */
  selectedAgentLib?: string;
  /** Callback when the user changes the agent library. */
  onAgentLibChange?: (lib: string) => void;
  /** Available model options. */
  models?: ModelOption[];
  /** Currently selected model value. */
  selectedModel?: string;
  /** Callback when the user changes the model. */
  onModelChange?: (model: string) => void;
  /** Current tool permission mode. */
  permissionMode?: PermissionMode | null;
  /** Callback when the user changes the permission mode. */
  onPermissionModeChange?: (mode: PermissionMode) => void;
  /** Callback to cancel a queued message. */
  onCancelQueue?: () => void;
  /** Prefill the input with a previous message (e.g., for edit-and-resend). */
  prefill?: { text: string; seq: number } | null;
  /** The last user message text, used for Arrow-Up-to-edit. */
  lastUserMessage?: string;
  /** Callback when the user presses Arrow-Up on an empty input. */
  onEditLastMessage?: () => void;
  /** Initial draft text loaded from persistence. */
  initialDraft?: string | null;
  /** Callback to persist draft text changes (debounced internally). */
  onDraftChange?: (draft: string) => void;
  /** Whether mid-execution message injection is enabled for this session. */
  enableStreamingInput?: boolean;
  /** Whether the agent is waiting for user input (AskUserQuestion). */
  isWaitingForInput?: boolean;
}

// ---------------------------------------------------------------------------
// AgentBlock — renders a single agent (Task) segment
// ---------------------------------------------------------------------------

/** Props for the AgentBlock preset component. */
export interface AgentBlockPresetProps {
  /** The agent segment data produced by `groupMessages()`. */
  segment: AgentSegment;
  /** Set of message indices whose tool details are currently expanded. */
  expandedTools: Set<number>;
  /** Toggle expansion of a tool detail at the given index. */
  onToggleTool: (index: number) => void;
  /** Whether the parent chat session is still running. */
  sessionRunning?: boolean;
  /** Whether the agent is waiting for user input (AskUserQuestion). */
  isWaitingForInput?: boolean;
}

// ---------------------------------------------------------------------------
// SessionTabs — tab bar for switching between chat sessions
// ---------------------------------------------------------------------------

/** Props for the SessionTabs preset component. */
export interface SessionTabsPresetProps {
  /** All available chat sessions. */
  sessions: ChatSession[];
  /** The ID of the currently active session (null if none). */
  currentSessionId: string | null;
  /** Running agents relevant to the current scope. */
  activeAgents: RunningAgent[];
  /** Switch to a different session by ID. */
  onSessionChange: (sessionId: string) => void;
  /** Create a new session with the given name. */
  onSessionCreate: (name: string) => void;
  /** Rename an existing session. */
  onSessionRename: (sessionId: string, newName: string) => void;
  /** Delete a session by ID. */
  onSessionDelete: (sessionId: string) => void;
}
