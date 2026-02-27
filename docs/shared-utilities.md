# Shared Utilities

Shared utility modules live in `src/shared/` and are imported by both the main process and the renderer. They must remain free of Electron or Node-specific APIs.

## cost-utils.ts

Token-to-cost calculation and formatting utilities.

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `ModelPricing` | interface | `{ inputPerMTok: number; outputPerMTok: number }` |
| `MODEL_PRICING_TABLE` | const array | Pattern-based pricing table; first match wins (versioned entries before generic family patterns) |
| `calculateCost(inputTokens, outputTokens, model?)` | function | Returns dollar cost from token counts; falls back to Sonnet pricing if model is unrecognized |
| `formatCost(dollars)` | function | Formats a dollar amount for display (e.g. `$0.03`, `$0.0012`) |
| `formatTokens(count)` | function | Formats a token count with locale-aware thousand separators |

### Pricing tier structure

Entries are evaluated in order; the first entry whose `pattern` appears as a case-insensitive substring of the model identifier wins. Versioned model entries (e.g. `claude-3-5-sonnet`) are listed before generic family patterns (e.g. `sonnet`) so that specific pricing takes priority.

## phase-utils.ts

Phase calculation logic for multi-phase task implementation.

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `getActivePhase(phases)` | function | Returns the first `in_progress` phase, or first `pending` phase, or `null` |
| `getActivePhaseIndex(phases)` | function | Returns the 0-based index of the active phase, or `-1` |
| `isMultiPhase(task)` | function | Returns `true` if the task has more than one implementation phase |
| `hasPendingPhases(phases)` | function | Returns `true` if any phases are not yet completed |
| `getAllSubtasksFromPhases(phases)` | function | Flattens all subtasks from all phases into a single array |

## agent-message-utils.ts

Utility for converting structured agent chat messages into raw text format.

### Exports

| Export | Type | Description |
|--------|------|-------------|
| `messagesToRawText(messages)` | function | Converts `AgentChatMessage[]` into the raw text format produced by agent `emit()`. Used during live streaming and on page reload. |
