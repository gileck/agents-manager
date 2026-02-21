import type { AgentChatMessageToolUse, AgentChatMessageToolResult } from '../../../../shared/types';

export interface ToolRendererProps {
  toolUse: AgentChatMessageToolUse;
  toolResult?: AgentChatMessageToolResult;
  expanded: boolean;
  onToggle: () => void;
}
