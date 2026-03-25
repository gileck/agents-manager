---
title: File-Based Agent Configuration
description: Customizing agent prompts and execution config via .agents/ directory
summary: "The .agents/ directory provides git-tracked, per-project customization of agent prompts and execution parameters. Files override hardcoded defaults with a 2-tier resolution chain: File (.agents/) > Code (builder defaults)."
priority: 2
key_points:
  - "Directory: {projectPath}/.agents/{agentType}/ — prompt.md + config.json per agent"
  - "2-tier resolution: File > Code — each field resolves independently"
  - "CLI: npx agents-manager agents init|show|list — daemon-independent (filesystem only)"
  - "Loader: src/core/agents/agent-file-config-loader.ts — never throws, logs all decisions"
  - "Mode-specific prompts: prompt.revision.md, prompt.merge.md, prompt.resume.md, prompt.uncommitted.md"
---
# File-Based Agent Configuration

Customizing agent prompts and execution parameters via the `.agents/` directory.

## Overview

The `.agents/` directory provides per-project, git-tracked customization of agent behavior. Each agent type gets a subdirectory containing a `prompt.md` (instruction prompt) and `config.json` (execution parameters). These files override the hardcoded defaults in the prompt builder classes.

**Key files:**
- **Loader:** `src/core/agents/agent-file-config-loader.ts`
- **Writer/Scaffold:** `src/core/agents/agent-file-config-writer.ts`
- **CLI commands:** `src/cli/commands/agents-config.ts`
- **Types:** `AgentFileConfig`, `AgentFileConfigJson` in `src/shared/types.ts`

## Directory Structure

```
{projectPath}/
└── .agents/
    ├── planner/
    │   ├── prompt.md        # Instruction prompt (replaces buildPrompt())
    │   └── config.json      # Execution parameters (maxTurns, timeout, etc.)
    ├── implementor/
    │   ├── prompt.md
    │   ├── prompt.revision.md   # Mode-specific: used when revisionReason=changes_requested
    │   └── config.json
    ├── reviewer/
    │   ├── prompt.md
    │   └── config.json
    ├── designer/
    │   ├── prompt.md
    │   └── config.json
    ├── investigator/
    │   ├── prompt.md
    │   └── config.json
    └── ... (one directory per agent type)
```

## Resolution Chain (2-Tier)

Each field resolves independently through a 2-tier chain:

```
File (.agents/{agentType}/) → Code (hardcoded builder defaults)
```

- **Prompt:** `.agents/{agentType}/prompt.md` → `buildPrompt()` method on the prompt builder class
- **Config fields:** Each field in `config.json` is checked independently — present fields override, missing fields fall back to code defaults

This means you can override just `maxTurns` in config.json without needing to specify every field.

## prompt.md

### What It Replaces

`prompt.md` replaces **layer 1 only** — the agent's instruction prompt (what `buildPrompt()` returns). The system still automatically injects around it:
- Task context entries (prepended)
- Feedback and revision instructions
- Worktree guards and safety instructions
- Skills section
- Validation errors (appended on retry)
- Summary suffix (unless `{skipSummary}` is present)

### Template Variables

The prompt file is processed through `PromptRenderer` for variable substitution. Available variables:

| Variable | Description |
|----------|-------------|
| `{taskTitle}` | Task title |
| `{taskDescription}` | Task description |
| `{taskId}` | Task UUID |
| `{subtasksSection}` | Auto-generated subtask guidance |
| `{planSection}` | Existing task plan as markdown |
| `{planCommentsSection}` | Admin feedback on the plan |
| `{priorReviewSection}` | Prior review feedback (for re-reviews) |
| `{relatedTaskSection}` | Related task references |
| `{technicalDesignSection}` | Technical design document |
| `{technicalDesignCommentsSection}` | Design feedback comments |
| `{defaultBranch}` | Project default branch name |
| `{skillsSection}` | Available skills list |
| `{skipSummary}` | Include to suppress auto-appended summary instruction |

### Mode-Specific Prompt Files

Agents can have different prompts for different execution modes. The loader checks mode-specific files first, then falls back to the base `prompt.md`:

| Revision Reason | File Checked First | Fallback |
|---|---|---|
| `changes_requested` | `prompt.revision.md` | `prompt.md` |
| `merge_failed` | `prompt.merge.md` | `prompt.md` |
| `info_provided` | `prompt.resume.md` | `prompt.md` |
| `uncommitted_changes` | `prompt.uncommitted.md` | `prompt.md` |

Mode-specific files are only checked when `mode=revision` and a `revisionReason` is set. For `mode=new`, only `prompt.md` is used.

## config.json

### Fields

| Field | Type | Description |
|-------|------|-------------|
| `engine` | `string` | Agent engine (e.g., `"claude-code"`, `"cursor"`) |
| `model` | `string` | Model identifier |
| `maxTurns` | `integer` | Maximum agentic turns before stopping |
| `timeout` | `integer` | Execution timeout in milliseconds |
| `readOnly` | `boolean` | If true, agent cannot write files |
| `disallowedTools` | `string[]` | Tools the agent is not allowed to use |
| `outputFormat` | `object` | Structured output format specification |

### Validation

Each field is validated independently. Invalid fields are skipped (not the entire config):

- `engine`, `model` — must be non-empty string
- `maxTurns`, `timeout` — must be positive integer
- `readOnly` — must be boolean
- `disallowedTools` — must be array of strings
- `outputFormat` — must be non-null object
- Unknown fields are warned about and ignored

### Example

```json
{
  "maxTurns": 150,
  "timeout": 900000,
  "readOnly": false,
  "disallowedTools": ["Bash"]
}
```

## CLI Commands

The `agents` command group is **daemon-independent** — it operates directly on the filesystem and does not require the daemon to be running.

### `agents init`

Scaffold `.agents/` directory with default prompts and config extracted from the hardcoded builders.

```bash
npx agents-manager agents init [agentType] [--path <path>] [--force]
```

| Option | Description |
|--------|-------------|
| `[agentType]` | Optional — scaffold only this agent type. Omit to scaffold all. |
| `--path <path>` | Project path (defaults to CWD) |
| `--force` | Overwrite existing files |

### `agents show`

Display the effective (resolved) prompt and config with source attribution.

```bash
npx agents-manager agents show <agentType> [--path <path>] [--mode <mode>] [--revision-reason <reason>] [--prompt-only] [--config-only]
```

| Option | Description |
|--------|-------------|
| `--path <path>` | Project path (defaults to CWD) |
| `--mode <mode>` | Agent mode: `new` or `revision` (default: `new`) |
| `--revision-reason <reason>` | Revision reason for mode-specific prompt resolution |
| `--prompt-only` | Show only the prompt |
| `--config-only` | Show only the config |

Output shows the source of each value:
```
## Prompt (source: file)
...

## Config
  maxTurns: 150 (file)
  timeout: 600000 (default)
  readOnly: false (default)
```

### `agents list`

List all available agent types.

```bash
npx agents-manager agents list
```

## API & MCP

### Daemon API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/agent-definitions/types` | List all agent types |
| GET | `/api/agent-definitions/effective?projectId=&agentType=` | Get effective config with source attribution |
| POST | `/api/agent-definitions/init` | Initialize `.agents/` for a project |
| PUT | `/api/agent-definitions/prompt` | Write/update a prompt file |
| DELETE | `/api/agent-definitions/file-config` | Delete `.agents/{agentType}/` or entire `.agents/` |

### MCP Tools

Three MCP tools are available for external agent orchestration:

- **`list_agent_types`** — Returns array of available agent type names
- **`get_agent_config`** — Returns effective config with field-level source attribution (file/default)
- **`update_agent_prompt`** — Writes prompt.md content for a given agent type

## Error Handling & Logging

The loader (`loadAgentFileConfig`) follows strict error handling rules:

1. **Never throws** — always returns partial results
2. **All decisions are logged** via the `onLog` callback
3. **Missing files are normal** — ENOENT is not logged as an error
4. **Invalid fields are skipped individually** — one bad field doesn't break the rest
5. **Empty files are skipped** — treated as "not configured"
6. **JSON parse failures are logged** — with the specific error message

The execution config builder (`buildExecutionConfig`) logs source attribution for every field:
```
Using file-based prompt from /path/to/.agents/planner/prompt.md
Loaded config from /path/to/.agents/planner/config.json
```

## Scaffolding Internals

`initAgentFiles()` in `agent-file-config-writer.ts` uses a "marker context" to extract default prompts from builders. It creates a fake task/project with placeholder values (`{taskTitle}`, `{taskDescription}`, etc.) that match the PromptRenderer variables. This way, scaffolded prompt.md files show the template variables in place rather than empty strings.

The scaffolded `prompt.md` files include an HTML comment header documenting all available template variables.
