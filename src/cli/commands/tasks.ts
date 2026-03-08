import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { Subtask, SubtaskStatus, TaskType, TaskSize, TaskComplexity } from '../../shared/types';
import { output, type OutputOptions } from '../output';
import { requireProject, resolveTaskId } from '../context';
import { readStdinOrValue } from '../stdin';
import { handleCliError } from '../error';

export function registerTaskCommands(program: Command, api: ApiClient): void {
  const tasks = program.command('tasks').description('Manage tasks');

  tasks
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .option('--type <type>', 'Filter by type (bug|feature|improvement)')
    .option('--size <size>', 'Filter by size (xs|sm|md|lg|xl)')
    .option('--complexity <complexity>', 'Filter by complexity (low|medium|high)')
    .option('--priority <n>', 'Filter by priority', parseInt)
    .option('--assignee <name>', 'Filter by assignee')
    .option('--feature <id>', 'Filter by feature ID')
    .option('--parent <id>', 'Filter by parent task ID')
    .option('--tag <tag>', 'Filter by tag')
    .option('--search <text>', 'Free-text search')
    .action(async (cmdOpts: {
      status?: string;
      type?: string;
      size?: string;
      complexity?: string;
      priority?: number;
      assignee?: string;
      feature?: string;
      parent?: string;
      tag?: string;
      search?: string;
    }) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);
        const list = await api.tasks.list({
          projectId: project.id,
          status: cmdOpts.status,
          type: cmdOpts.type as TaskType | undefined,
          size: cmdOpts.size as TaskSize | undefined,
          complexity: cmdOpts.complexity as TaskComplexity | undefined,
          priority: cmdOpts.priority,
          assignee: cmdOpts.assignee,
          featureId: cmdOpts.feature,
          parentTaskId: cmdOpts.parent,
          tag: cmdOpts.tag,
          search: cmdOpts.search,
        });
        const rows = list.map((t) => {
          const done = t.subtasks.filter((s) => s.status === 'done').length;
          const total = t.subtasks.length;
          return {
            status: t.status,
            type: t.type,
            size: t.size ?? '',
            complexity: t.complexity ?? '',
            priority: t.priority,
            title: t.title,
            id: t.id,
            ...(total > 0 ? { subtasks: `${done}/${total}` } : {}),
          };
        });
        output(rows, opts);
      } catch (err) {
        handleCliError(err, 'Failed to list tasks');
      }
    });

  tasks
    .command('get <id>')
    .alias('show')
    .description('Get task details')
    .option('--field <name>', 'Extract single field value (raw output)')
    .action(async (id: string, cmdOpts: { field?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const task = await api.tasks.get(id);

        if (cmdOpts.field) {
          const validFields = [
            'plan', 'technicalDesign', 'debugInfo', 'phases', 'subtasks',
            'metadata', 'prLink', 'branchName', 'description', 'type', 'size',
            'complexity', 'tags', 'assignee', 'featureId', 'parentTaskId',
          ];
          if (!validFields.includes(cmdOpts.field)) {
            console.error(`Invalid field: ${cmdOpts.field}\nValid fields: ${validFields.join(', ')}`);
            process.exitCode = 1;
            return;
          }
          const value = (task as unknown as Record<string, unknown>)[cmdOpts.field];
          if (value === null || value === undefined) {
            if (opts.json) {
              console.log('null');
            }
            return;
          }
          if (typeof value === 'object') {
            console.log(JSON.stringify(value, null, 2));
          } else {
            console.log(String(value));
          }
          return;
        }

        const deps = await api.tasks.getDependencies(id) as { id: string }[];
        const transitions = await api.tasks.getTransitions(id) as { to: string }[];
        const detail = {
          ...task,
          dependencies: deps.map((d) => d.id),
          validTransitions: transitions.map((t) => t.to),
        };
        output(detail, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get task');
      }
    });

  tasks
    .command('create')
    .description('Create a new task')
    .requiredOption('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--type <type>', 'Task type (bug|feature|improvement)', 'feature')
    .option('--size <size>', 'Task size (xs|sm|md|lg|xl)')
    .option('--complexity <complexity>', 'Task complexity (low|medium|high)')
    .option('--pipeline <id>', 'Pipeline ID')
    .option('--priority <n>', 'Task priority', parseInt)
    .option('--assignee <name>', 'Assignee')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--debug-info <text>', 'Debug info for bug investigation')
    .option('--feature <id>', 'Feature ID')
    .option('--parent-task <id>', 'Parent task ID')
    .option('--pr-link <link>', 'PR link')
    .option('--branch-name <name>', 'Branch name')
    .option('--metadata <json>', 'Metadata JSON object')
    .action(async (cmdOpts: {
      title: string;
      description?: string;
      type?: string;
      size?: string;
      complexity?: string;
      pipeline?: string;
      priority?: number;
      assignee?: string;
      tags?: string;
      debugInfo?: string;
      feature?: string;
      parentTask?: string;
      prLink?: string;
      branchName?: string;
      metadata?: string;
    }) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);

        let pipelineId = cmdOpts.pipeline;
        if (!pipelineId) {
          try {
            const settings = await api.settings.get();
            pipelineId = settings.defaultPipelineId || 'pipeline-agent';
          } catch (settingsErr) {
            console.error(`Warning: Could not fetch default pipeline (${settingsErr instanceof Error ? settingsErr.message : 'unknown error'}). Using 'pipeline-agent'.`);
            pipelineId = 'pipeline-agent';
          }
        }

        let metadata: Record<string, unknown> | undefined;
        if (cmdOpts.metadata) {
          try {
            metadata = JSON.parse(cmdOpts.metadata);
          } catch {
            console.error('Invalid JSON for --metadata');
            process.exitCode = 1;
            return;
          }
        }

        const task = await api.tasks.create({
          projectId: project.id,
          pipelineId,
          title: cmdOpts.title,
          description: cmdOpts.description,
          type: cmdOpts.type as TaskType | undefined,
          size: cmdOpts.size as TaskSize | undefined,
          complexity: cmdOpts.complexity as TaskComplexity | undefined,
          debugInfo: cmdOpts.debugInfo,
          priority: cmdOpts.priority,
          assignee: cmdOpts.assignee,
          tags: cmdOpts.tags?.split(',').map((t) => t.trim()),
          featureId: cmdOpts.feature,
          parentTaskId: cmdOpts.parentTask,
          prLink: cmdOpts.prLink,
          branchName: cmdOpts.branchName,
          metadata,
          createdBy: 'user',
        });
        output(task, opts);
      } catch (err) {
        handleCliError(err, 'Failed to create task');
      }
    });

  tasks
    .command('update <id>')
    .description('Update a task')
    .option('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--type <type>', 'Task type (bug|feature|improvement)')
    .option('--size <size>', 'Task size (xs|sm|md|lg|xl, use "" to clear)')
    .option('--complexity <complexity>', 'Task complexity (low|medium|high, use "" to clear)')
    .option('--priority <n>', 'Task priority', parseInt)
    .option('--assignee <name>', 'Assignee')
    .option('--tags <tags>', 'Comma-separated tags')
    .option('--pipeline <id>', 'Pipeline ID')
    .option('--debug-info <text>', 'Debug info for bug investigation')
    .option('--plan <text>', 'Set plan (use - for stdin)')
    .option('--technical-design <text>', 'Set technical design (use - for stdin)')
    .option('--pr-link <link>', 'Set PR link (use "" to clear)')
    .option('--branch-name <name>', 'Set branch name (use "" to clear)')
    .option('--feature <id>', 'Set feature ID (use "" to clear)')
    .option('--parent-task <id>', 'Set parent task ID (use "" to clear)')
    .option('--metadata <json>', 'Merge metadata (JSON object)')
    .option('--phases <json>', 'Set implementation phases (JSON array)')
    .action(async (id: string, cmdOpts: {
      title?: string;
      description?: string;
      type?: string;
      size?: string;
      complexity?: string;
      priority?: number;
      assignee?: string;
      tags?: string;
      pipeline?: string;
      debugInfo?: string;
      plan?: string;
      technicalDesign?: string;
      prLink?: string;
      branchName?: string;
      feature?: string;
      parentTask?: string;
      metadata?: string;
      phases?: string;
    }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        if (cmdOpts.parentTask) {
          cmdOpts.parentTask = await resolveTaskId(api, cmdOpts.parentTask);
        }
        const planValue = await readStdinOrValue(cmdOpts.plan);
        const designValue = await readStdinOrValue(cmdOpts.technicalDesign);

        const updateInput: Record<string, unknown> = {};
        if (cmdOpts.title !== undefined) updateInput.title = cmdOpts.title;
        if (cmdOpts.description !== undefined) updateInput.description = cmdOpts.description;
        if (cmdOpts.type !== undefined) updateInput.type = cmdOpts.type;
        if (cmdOpts.size !== undefined) updateInput.size = cmdOpts.size || null;
        if (cmdOpts.complexity !== undefined) updateInput.complexity = cmdOpts.complexity || null;
        if (cmdOpts.debugInfo !== undefined) updateInput.debugInfo = cmdOpts.debugInfo;
        if (cmdOpts.priority !== undefined) updateInput.priority = cmdOpts.priority;
        if (cmdOpts.assignee !== undefined) updateInput.assignee = cmdOpts.assignee || null;
        if (cmdOpts.tags !== undefined) updateInput.tags = cmdOpts.tags.split(',').map((t) => t.trim());
        if (cmdOpts.pipeline !== undefined) updateInput.pipelineId = cmdOpts.pipeline;
        if (planValue !== undefined) updateInput.plan = planValue || null;
        if (designValue !== undefined) updateInput.technicalDesign = designValue || null;
        if (cmdOpts.prLink !== undefined) updateInput.prLink = cmdOpts.prLink || null;
        if (cmdOpts.branchName !== undefined) updateInput.branchName = cmdOpts.branchName || null;
        if (cmdOpts.feature !== undefined) updateInput.featureId = cmdOpts.feature || null;
        if (cmdOpts.parentTask !== undefined) updateInput.parentTaskId = cmdOpts.parentTask || null;

        if (cmdOpts.metadata !== undefined) {
          try {
            updateInput.metadata = JSON.parse(cmdOpts.metadata);
          } catch {
            console.error('Invalid JSON for --metadata');
            process.exitCode = 1;
            return;
          }
        }

        if (cmdOpts.phases !== undefined) {
          try {
            updateInput.phases = JSON.parse(cmdOpts.phases);
          } catch {
            console.error('Invalid JSON for --phases');
            process.exitCode = 1;
            return;
          }
        }

        const task = await api.tasks.update(id, updateInput);
        output(task, opts);
      } catch (err) {
        handleCliError(err, 'Failed to update task');
      }
    });

  tasks
    .command('delete <id>')
    .description('Delete a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        await api.tasks.delete(id);
        if (opts.json) {
          output({ deleted: true, id }, opts);
        } else if (!opts.quiet) {
          console.log(`Deleted task ${id}`);
        }
      } catch (err) {
        handleCliError(err, 'Failed to delete task');
      }
    });

  tasks
    .command('reset <id>')
    .description('Reset a task to its initial state')
    .option('--pipeline <id>', 'Switch to a different pipeline during reset')
    .action(async (id: string, cmdOpts: { pipeline?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.reset(id, cmdOpts.pipeline);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to reset task');
      }
    });

  // Transition commands
  tasks
    .command('transition <id> <status>')
    .alias('move')
    .description('Transition a task to a new status')
    .option('--actor <name>', 'Actor performing the transition')
    .action(async (id: string, status: string, cmdOpts: { actor?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.transition(id, status, cmdOpts.actor) as {
          success: boolean;
          error?: string;
          guardFailures?: { guard: string; reason: string }[];
          task?: unknown;
        };
        if (!result.success) {
          console.error(`Transition failed: ${result.error}`);
          if (result.guardFailures) {
            for (const f of result.guardFailures) {
              console.error(`  Guard "${f.guard}": ${f.reason}`);
            }
          }
          process.exitCode = 1;
          return;
        }
        if (result.task) {
          output(result.task, opts);
        } else if (!opts.quiet) {
          console.log('Transition succeeded.');
        }
      } catch (err) {
        handleCliError(err, 'Transition failed');
      }
    });

  tasks
    .command('force-transition <id> <status>')
    .description('Force a task transition (bypass guards)')
    .option('--actor <name>', 'Actor performing the transition')
    .action(async (id: string, status: string, cmdOpts: { actor?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.forceTransition(id, status, cmdOpts.actor);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Force transition failed');
      }
    });

  tasks
    .command('transitions <id>')
    .description('Show valid transitions for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const transitions = await api.tasks.getTransitions(id) as {
          from: string;
          to: string;
          trigger: string;
          label?: string;
        }[];
        const rows = transitions.map((t) => ({
          from: t.from,
          to: t.to,
          trigger: t.trigger,
          label: t.label ?? '',
        }));
        output(rows, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get transitions');
      }
    });

  tasks
    .command('all-transitions <id>')
    .description('Show all pipeline transitions for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.getAllTransitions(id);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get all transitions');
      }
    });

  tasks
    .command('diagnostics <id>')
    .description('Get pipeline diagnostics for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.getPipelineDiagnostics(id);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get diagnostics');
      }
    });

  tasks
    .command('advance-phase <id>')
    .description('Advance to the next implementation phase')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.advancePhase(id);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to advance phase');
      }
    });

  tasks
    .command('hook-retry <id>')
    .description('Retry a failed hook')
    .requiredOption('--hook <name>', 'Hook name')
    .option('--from <status>', 'Transition from status')
    .option('--to <status>', 'Transition to status')
    .action(async (id: string, cmdOpts: { hook: string; from?: string; to?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.retryHook(id, cmdOpts.hook, cmdOpts.from, cmdOpts.to);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Hook retry failed');
      }
    });

  tasks
    .command('guard-check <id>')
    .description('Check if a transition is allowed')
    .requiredOption('--to <status>', 'Target status')
    .requiredOption('--trigger <trigger>', 'Trigger type')
    .action(async (id: string, cmdOpts: { to: string; trigger: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const result = await api.tasks.guardCheck(id, cmdOpts.to, cmdOpts.trigger);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Guard check failed');
      }
    });

  tasks
    .command('start <id> [status]')
    .description('Start a task by transitioning to the given status')
    .option('--actor <name>', 'Actor performing the transition')
    .action(async (id: string, status: string | undefined, cmdOpts: { actor?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        if (!status) {
          const transitions = await api.tasks.getTransitions(id) as { to: string }[];
          const available = transitions.map((t: { to: string }) => t.to).join(', ');
          console.error(`Error: <status> is required. Available transitions: ${available || 'none'}`);
          process.exitCode = 1;
          return;
        }
        const result = await api.tasks.transition(id, status, cmdOpts.actor) as {
          success: boolean;
          error?: string;
          task?: unknown;
        };
        if (!result.success) {
          console.error(`Transition failed: ${result.error}`);
          process.exitCode = 1;
          return;
        }
        if (result.task) {
          output(result.task, opts);
        } else if (!opts.quiet) {
          console.log('Task started.');
        }
      } catch (err) {
        handleCliError(err, 'Failed to start task');
      }
    });

  // Context commands
  const context = tasks.command('context').description('Manage task context entries');

  context
    .command('list <id>')
    .alias('ls')
    .description('List context entries for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const entries = await api.tasks.getContext(id) as {
          id: string;
          source: string;
          entryType: string;
          summary: string;
          addressed: boolean;
          createdAt: number;
        }[];
        const rows = entries.map((e) => ({
          id: e.id,
          source: e.source,
          entryType: e.entryType,
          summary: e.summary,
          addressed: e.addressed,
          createdAt: new Date(e.createdAt).toISOString(),
        }));
        output(rows, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get context');
      }
    });

  context
    .command('add <id>')
    .description('Add a context entry to a task')
    .requiredOption('--source <src>', 'Context source')
    .requiredOption('--type <type>', 'Entry type')
    .requiredOption('--summary <text>', 'Summary (use - for stdin)')
    .option('--data <json>', 'Additional data (JSON object)')
    .action(async (id: string, cmdOpts: { source: string; type: string; summary: string; data?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const summary = await readStdinOrValue(cmdOpts.summary);
        if (!summary) {
          console.error('Summary is required');
          process.exitCode = 1;
          return;
        }
        let data: Record<string, unknown> | undefined;
        if (cmdOpts.data) {
          try {
            data = JSON.parse(cmdOpts.data);
          } catch {
            console.error('Invalid JSON for --data');
            process.exitCode = 1;
            return;
          }
        }
        const result = await api.tasks.addContext(id, {
          source: cmdOpts.source,
          entryType: cmdOpts.type,
          summary,
          data,
        });
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to add context');
      }
    });

  tasks
    .command('feedback <id>')
    .description('Add feedback to a task')
    .requiredOption('--type <type>', 'Feedback type (plan_feedback|design_feedback|implementation_feedback)')
    .requiredOption('--content <text>', 'Feedback content (use - for stdin)')
    .action(async (id: string, cmdOpts: { type: string; content: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const content = await readStdinOrValue(cmdOpts.content);
        if (!content) {
          console.error('Content is required');
          process.exitCode = 1;
          return;
        }
        const result = await api.tasks.addFeedback(id, {
          entryType: cmdOpts.type,
          content,
        });
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to add feedback');
      }
    });

  tasks
    .command('artifacts <id>')
    .description('List artifacts for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const artifacts = await api.tasks.getArtifacts(id);
        output(artifacts, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get artifacts');
      }
    });

  tasks
    .command('timeline <id>')
    .description('Get timeline for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const timeline = await api.tasks.getTimeline(id);
        output(timeline, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get timeline');
      }
    });

  tasks
    .command('worktree <id>')
    .description('Get worktree info for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        id = await resolveTaskId(api, id);
        const worktree = await api.tasks.getWorktree(id);
        output(worktree, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get worktree');
      }
    });

  // Subtask commands
  const subtask = tasks.command('subtask').description('Manage subtasks');

  subtask
    .command('list <taskId>')
    .alias('ls')
    .description('List subtasks for a task')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        const task = await api.tasks.get(taskId);
        output(task.subtasks, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get subtasks');
      }
    });

  subtask
    .command('add <taskId>')
    .description('Add a subtask')
    .requiredOption('--name <name>', 'Subtask name')
    .option('--status <status>', 'Subtask status (open|in_progress|done)', 'open')
    .action(async (taskId: string, cmdOpts: { name: string; status: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        const task = await api.tasks.get(taskId);
        const newSubtask: Subtask = { name: cmdOpts.name, status: cmdOpts.status as SubtaskStatus };
        const subtasks = [...task.subtasks, newSubtask];
        await api.tasks.update(taskId, { subtasks });
        output(subtasks, opts);
      } catch (err) {
        handleCliError(err, 'Failed to add subtask');
      }
    });

  subtask
    .command('update <taskId>')
    .description('Update a subtask status by name')
    .requiredOption('--name <name>', 'Subtask name')
    .requiredOption('--status <status>', 'New status (open|in_progress|done)')
    .action(async (taskId: string, cmdOpts: { name: string; status: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        const task = await api.tasks.get(taskId);
        const subtasks = task.subtasks.map((s) =>
          s.name === cmdOpts.name ? { ...s, status: cmdOpts.status as SubtaskStatus } : s
        );
        await api.tasks.update(taskId, { subtasks });
        output(subtasks, opts);
      } catch (err) {
        handleCliError(err, 'Failed to update subtask');
      }
    });

  subtask
    .command('remove <taskId>')
    .description('Remove a subtask by name')
    .requiredOption('--name <name>', 'Subtask name')
    .action(async (taskId: string, cmdOpts: { name: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        const task = await api.tasks.get(taskId);
        const subtasks = task.subtasks.filter((s) => s.name !== cmdOpts.name);
        await api.tasks.update(taskId, { subtasks });
        output(subtasks, opts);
      } catch (err) {
        handleCliError(err, 'Failed to remove subtask');
      }
    });

  subtask
    .command('set <taskId>')
    .description('Replace all subtasks with a JSON array')
    .requiredOption('--subtasks <json>', 'JSON array of subtasks')
    .action(async (taskId: string, cmdOpts: { subtasks: string }) => {
      const opts = program.opts() as OutputOptions;
      let subtasks: Subtask[];
      try {
        subtasks = JSON.parse(cmdOpts.subtasks);
      } catch {
        console.error('Invalid JSON for --subtasks');
        process.exitCode = 1;
        return;
      }
      try {
        taskId = await resolveTaskId(api, taskId);
        await api.tasks.get(taskId);
        await api.tasks.update(taskId, { subtasks });
        output(subtasks, opts);
      } catch (err) {
        handleCliError(err, 'Failed to set subtasks');
      }
    });
}
