/**
 * Chat agent subsystem barrel export.
 *
 * Re-exports the main ChatAgentService class and related types so that
 * existing consumers can import from either this folder or the legacy
 * path (`../chat-agent-service`) interchangeably.
 */
export { ChatAgentService } from '../chat-agent-service';
export type { RunningAgent, InjectedMessage } from './chat-agent-helpers';
export {
  parseUserContent,
  extractTextFromContent,
  saveImagesToDisk,
  isDefaultSessionName,
  isAutoNameableSession,
  parsePluginsConfig,
  tagNestedSubagentMessage,
  WRITE_TOOL_NAMES,
  DEFAULT_AGENT_LIB,
  CHAT_COMPLETE_SENTINEL,
  DEFAULT_CHAT_SUBAGENTS,
  AGENT_ROLE_TO_FEEDBACK_ENTRY_TYPE,
  THEMED_SESSION_LABELS,
} from './chat-agent-helpers';
