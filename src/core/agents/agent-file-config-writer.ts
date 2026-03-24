import { mkdirSync, writeFileSync, existsSync, rmSync } from 'fs';
import { join } from 'path';
import type { AgentContext, AgentConfig, AgentFileConfigJson, AgentMode, RevisionReason, Task, Project } from '../../shared/types';
import { AGENT_BUILDERS } from './agent-builders';
import { loadAgentFileConfig } from './agent-file-config-loader';

/** Minimal context for extracting default prompts and config from builders. */
function createMarkerContext(): { context: AgentContext; config: AgentConfig } {
  const task: Task = {
    id: '{taskId}',
    projectId: 'proj-marker',
    pipelineId: 'pipe-marker',
    title: '{taskTitle}',
    description: '{taskDescription}',
    type: 'feature',
    size: null,
    complexity: null,
    status: 'planning',
    priority: 1,
    tags: [],
    parentTaskId: null,
    featureId: null,
    assignee: null,
    prLink: null,
    branchName: null,
    plan: null,
    investigationReport: null,
    technicalDesign: null,
    postMortem: null,
    debugInfo: null,
    subtasks: [],
    phases: null,
    planComments: [],
    technicalDesignComments: [],
    metadata: {},
    createdAt: Date.now(),
    updatedAt: Date.now(),
    createdBy: null,
  };

  const project: Project = {
    id: 'proj-marker',
    name: 'MarkerProject',
    description: null,
    path: '/marker/project',
    config: { defaultBranch: '{defaultBranch}' },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const context: AgentContext = {
    task,
    project,
    workdir: '/marker/workdir',
    mode: 'new',
  };

  const config: AgentConfig = {};

  return { context, config };
}

/** Header comment for scaffolded prompt.md files. */
const PROMPT_HEADER = [
  '<!-- ',
  '  Agent prompt template. This file is loaded at execution time and processed',
  '  through PromptRenderer for variable substitution.',
  '',
  '  Available variables:',
  '    {taskTitle}                    - Task title',
  '    {taskDescription}             - Task description',
  '    {taskId}                      - Task ID',
  '    {subtasksSection}             - Subtask list / tracking instructions',
  '    {planSection}                 - Plan document (if available)',
  '    {planCommentsSection}         - Plan feedback comments',
  '    {priorReviewSection}          - Prior review feedback (for re-reviews)',
  '    {relatedTaskSection}          - Related task references',
  '    {technicalDesignSection}      - Technical design document (if available)',
  '    {technicalDesignCommentsSection} - Design feedback comments',
  '    {defaultBranch}               - Default git branch name',
  '    {skillsSection}               - Available skills list',
  '    {skipSummary}                 - Include to suppress auto-appended summary instruction',
  '',
  '  The system automatically injects: feedback, task context, worktree guards,',
  '  skills, and validation errors around this prompt. You only need to provide',
  '  the agent role instructions and output format.',
  '-->',
  '',
].join('\n');

export interface InitResult {
  created: string[];
  skipped: string[];
}

/**
 * Scaffold `.agents/{agentType}/` directories with default prompt.md and config.json
 * extracted from the hardcoded prompt builders.
 */
export function initAgentFiles(
  projectPath: string,
  agentType?: string,
  options: { force?: boolean } = {},
): InitResult {
  const { force = false } = options;
  const agentsDir = join(projectPath, '.agents');
  const created: string[] = [];
  const skipped: string[] = [];

  const types = agentType ? [agentType] : Object.keys(AGENT_BUILDERS);

  // Validate agent type
  if (agentType && !AGENT_BUILDERS[agentType]) {
    const available = Object.keys(AGENT_BUILDERS).join(', ');
    throw new Error(`Unknown agent type "${agentType}". Available types: ${available}`);
  }

  for (const type of types) {
    const BuilderClass = AGENT_BUILDERS[type];
    if (!BuilderClass) continue;

    const typeDir = join(agentsDir, type);
    mkdirSync(typeDir, { recursive: true });

    const builder = new BuilderClass();
    const { context, config } = createMarkerContext();

    // --- Extract default prompt ---
    const promptPath = join(typeDir, 'prompt.md');
    if (!existsSync(promptPath) || force) {
      let promptContent: string;
      try {
        promptContent = builder.buildPrompt(context);
      } catch {
        promptContent = `<!-- Default prompt extraction failed for ${type}. Customize this file with your agent instructions. -->`;
      }
      writeFileSync(promptPath, PROMPT_HEADER + promptContent, 'utf-8');
      created.push(promptPath);
    } else {
      skipped.push(promptPath);
    }

    // --- Extract default config ---
    const configPath = join(typeDir, 'config.json');
    if (!existsSync(configPath) || force) {
      let configJson: AgentFileConfigJson;
      try {
        const defaults = builder.getDefaultConfigValues(context, config);
        configJson = {
          maxTurns: defaults.maxTurns,
          timeout: defaults.timeout,
          readOnly: defaults.readOnly,
        };
        if (defaults.disallowedTools) {
          configJson.disallowedTools = defaults.disallowedTools;
        }
        // Don't include outputFormat in scaffold (complex and agent-specific)
      } catch {
        configJson = {
          maxTurns: 100,
          timeout: 600000,
          readOnly: false,
        };
      }
      writeFileSync(configPath, JSON.stringify(configJson, null, 2) + '\n', 'utf-8');
      created.push(configPath);
    } else {
      skipped.push(configPath);
    }
  }

  return { created, skipped };
}

/**
 * Get the effective (resolved) prompt for an agent type, showing which source is used.
 */
export function showAgentConfig(
  projectPath: string,
  agentType: string,
  options: { mode?: AgentMode; revisionReason?: RevisionReason } = {},
): { prompt: string; promptSource: 'file' | 'default'; config: AgentFileConfigJson; configSources: Record<string, 'file' | 'default'>; hasFileConfig: boolean } {
  const BuilderClass = AGENT_BUILDERS[agentType];
  if (!BuilderClass) {
    const available = Object.keys(AGENT_BUILDERS).join(', ');
    throw new Error(`Unknown agent type "${agentType}". Available types: ${available}`);
  }

  const builder = new BuilderClass();
  const { context, config } = createMarkerContext();

  // Check for file-based prompt
  const mode = options.mode ?? 'new';
  const fileConfig = loadAgentFileConfig(projectPath, agentType, mode, options.revisionReason);

  let prompt: string;
  let promptSource: 'file' | 'default';
  if (fileConfig.prompt) {
    prompt = fileConfig.prompt;
    promptSource = 'file';
  } else {
    try {
      prompt = builder.buildPrompt(context);
    } catch {
      prompt = '<!-- Failed to extract default prompt -->';
    }
    promptSource = 'default';
  }

  // Build effective config with source attribution
  const defaults = builder.getDefaultConfigValues(context, config);
  const fc = fileConfig.config || {};

  const effectiveConfig: AgentFileConfigJson = {
    maxTurns: fc.maxTurns ?? defaults.maxTurns,
    timeout: fc.timeout ?? defaults.timeout,
    readOnly: fc.readOnly ?? defaults.readOnly,
  };
  if (fc.disallowedTools ?? defaults.disallowedTools) {
    effectiveConfig.disallowedTools = fc.disallowedTools ?? defaults.disallowedTools;
  }

  const configSources: Record<string, 'file' | 'default'> = {
    maxTurns: fc.maxTurns !== undefined ? 'file' : 'default',
    timeout: fc.timeout !== undefined ? 'file' : 'default',
    readOnly: fc.readOnly !== undefined ? 'file' : 'default',
    disallowedTools: fc.disallowedTools !== undefined ? 'file' : 'default',
  };

  const hasFileConfig = existsSync(join(projectPath, '.agents', agentType));

  return { prompt, promptSource, config: effectiveConfig, configSources, hasFileConfig };
}

/**
 * Write (or overwrite) the prompt file for an agent type.
 * Creates the `.agents/{agentType}/` directory if needed.
 * Returns the path that was written.
 */
export function writeAgentPrompt(
  projectPath: string,
  agentType: string,
  content: string,
): { path: string } {
  if (!AGENT_BUILDERS[agentType]) {
    const available = Object.keys(AGENT_BUILDERS).join(', ');
    throw new Error(`Unknown agent type "${agentType}". Available types: ${available}`);
  }

  const typeDir = join(projectPath, '.agents', agentType);
  mkdirSync(typeDir, { recursive: true });

  const promptPath = join(typeDir, 'prompt.md');
  writeFileSync(promptPath, content, 'utf-8');
  return { path: promptPath };
}

/**
 * Delete `.agents/{agentType}/` directory (reset to defaults).
 * If `agentType` is omitted, deletes the entire `.agents/` directory.
 * Returns the list of deleted paths.
 */
export function deleteAgentFiles(
  projectPath: string,
  agentType?: string,
): { deleted: string[] } {
  const deleted: string[] = [];

  if (agentType) {
    // Validate agent type
    if (!AGENT_BUILDERS[agentType]) {
      const available = Object.keys(AGENT_BUILDERS).join(', ');
      throw new Error(`Unknown agent type "${agentType}". Available types: ${available}`);
    }

    const typeDir = join(projectPath, '.agents', agentType);
    if (existsSync(typeDir)) {
      rmSync(typeDir, { recursive: true, force: true });
      deleted.push(typeDir);
    }
  } else {
    const agentsDir = join(projectPath, '.agents');
    if (existsSync(agentsDir)) {
      rmSync(agentsDir, { recursive: true, force: true });
      deleted.push(agentsDir);
    }
  }

  return { deleted };
}
