import type { TaskDoc, DocArtifactType } from '../../shared/types';
import { getPhaseByDocType } from '../../shared/doc-phases';

/**
 * Build prompt sections for docs injection using the "full latest + summary rest" strategy.
 *
 * - The "primary" doc (matching the specified type, typically the current agent's phase)
 *   is included in full.
 * - All other docs are included as summaries only.
 * - If a doc has no summary, a note says "use read_task_artifact to view full content".
 *
 * @param docs - All docs for the task
 * @param primaryDocType - The doc type to include in full (e.g. 'plan' for implementor)
 * @returns Formatted markdown string for prompt injection
 */
export function buildDocsPromptSections(
  docs: TaskDoc[],
  primaryDocType: DocArtifactType,
): string {
  if (!docs || docs.length === 0) return '';

  const lines: string[] = [];
  const primary = docs.find(d => d.type === primaryDocType);
  const others = docs.filter(d => d.type !== primaryDocType);

  if (primary) {
    const phase = getPhaseByDocType(primary.type);
    lines.push(`\n## ${phase?.docTitle ?? primary.type}\n${primary.content}`);
  }

  for (const doc of others) {
    const phase = getPhaseByDocType(doc.type);
    const title = phase?.docTitle ?? doc.type;
    if (doc.summary) {
      lines.push(`\n## ${title} (Summary)\n${doc.summary}`);
    } else if (doc.content) {
      lines.push(`\n## ${title} (Summary)\nDocument available — use the read_task_artifact MCP tool with type="${doc.type}" to view full content.`);
    }
  }

  return lines.join('\n');
}

/**
 * Build a generic docs section that renders ALL docs as summaries with
 * instructions for reading full content via the `read_task_artifact` MCP tool.
 *
 * This is injected automatically by `BaseAgentPromptBuilder.buildExecutionConfig`
 * so every agent sees prior work products (investigation report, plan, design, etc.)
 * without per-agent template variables.
 *
 * @param docs - All docs for the task
 * @returns Formatted markdown string for prompt injection, or empty string if no docs
 */
export function buildGenericDocsSection(docs: TaskDoc[] | undefined): string {
  if (!docs || docs.length === 0) return '';

  const lines: string[] = [
    '## Available Task Documents',
    '',
    'The following documents have been produced for this task. Summaries are shown below.',
    'To read the full content of any document, use the `read_task_artifact` MCP tool with the specified type.',
    '',
  ];

  for (const doc of docs) {
    const phase = getPhaseByDocType(doc.type);
    const title = phase?.docTitle ?? doc.type;
    if (doc.summary) {
      lines.push(`### ${title}`);
      lines.push(`**Type:** \`${doc.type}\``);
      lines.push('');
      lines.push(doc.summary);
      lines.push('');
      lines.push(`_Use \`read_task_artifact\` with type=\`${doc.type}\` to read the full document._`);
      lines.push('');
    } else if (doc.content) {
      lines.push(`### ${title}`);
      lines.push(`**Type:** \`${doc.type}\``);
      lines.push('');
      lines.push(`Document available — use the \`read_task_artifact\` MCP tool with type=\`${doc.type}\` to view full content.`);
      lines.push('');
    }
  }

  return lines.join('\n');
}

/**
 * Find a specific doc by type from the docs array.
 * Convenience wrapper used by prompt builders that need direct access to a doc.
 */
export function findDoc(docs: TaskDoc[] | undefined, type: DocArtifactType): TaskDoc | undefined {
  return docs?.find(d => d.type === type);
}
