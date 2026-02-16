import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import { output, type OutputOptions } from '../output';
import { requireProject } from '../context';

export function registerTaskCommands(program: Command, getServices: () => AppServices): void {
  const tasks = program.command('tasks').description('Manage tasks');

  tasks
    .command('list')
    .alias('ls')
    .description('List tasks')
    .option('--status <status>', 'Filter by status')
    .option('--priority <n>', 'Filter by priority', parseInt)
    .option('--assignee <name>', 'Filter by assignee')
    .action(async (cmdOpts: { status?: string; priority?: number; assignee?: string }) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      const services = getServices();
      const project = await requireProject(services, opts.project);
      const list = await services.taskStore.listTasks({
        projectId: project.id,
        status: cmdOpts.status,
        priority: cmdOpts.priority,
        assignee: cmdOpts.assignee,
      });
      const rows = list.map((t) => ({
        status: t.status,
        priority: t.priority,
        title: t.title,
        id: t.id,
      }));
      output(rows, opts);
    });

  tasks
    .command('get <id>')
    .alias('show')
    .description('Get task details')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const task = await services.taskStore.getTask(id);
      if (!task) {
        console.error(`Task not found: ${id}`);
        process.exitCode = 1;
        return;
      }

      const deps = await services.taskStore.getDependencies(id);
      const transitions = await services.pipelineEngine.getValidTransitions(task, 'manual');
      const detail = {
        ...task,
        dependencies: deps.map((d) => d.id),
        validTransitions: transitions.map((t) => t.to),
      };
      output(detail, opts);
    });

  tasks
    .command('create')
    .description('Create a new task')
    .requiredOption('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--pipeline <id>', 'Pipeline ID')
    .option('--priority <n>', 'Task priority', parseInt)
    .option('--assignee <name>', 'Assignee')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (cmdOpts: {
      title: string;
      description?: string;
      pipeline?: string;
      priority?: number;
      assignee?: string;
      tags?: string;
    }) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      const services = getServices();
      const project = await requireProject(services, opts.project);

      let pipelineId = cmdOpts.pipeline;
      if (!pipelineId) {
        const pipelines = await services.pipelineStore.listPipelines();
        if (pipelines.length === 0) {
          console.error('No pipelines available. Create one first.');
          process.exitCode = 1;
          return;
        }
        pipelineId = pipelines[0].id;
      }

      const task = await services.workflowService.createTask({
        projectId: project.id,
        pipelineId,
        title: cmdOpts.title,
        description: cmdOpts.description,
        priority: cmdOpts.priority,
        assignee: cmdOpts.assignee,
        tags: cmdOpts.tags?.split(',').map((t) => t.trim()),
      });
      output(task, opts);
    });

  tasks
    .command('update <id>')
    .description('Update a task')
    .option('--title <title>', 'Task title')
    .option('--description <desc>', 'Task description')
    .option('--priority <n>', 'Task priority', parseInt)
    .option('--assignee <name>', 'Assignee')
    .option('--tags <tags>', 'Comma-separated tags')
    .action(async (id: string, cmdOpts: {
      title?: string;
      description?: string;
      priority?: number;
      assignee?: string;
      tags?: string;
    }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const task = await services.workflowService.updateTask(id, {
        title: cmdOpts.title,
        description: cmdOpts.description,
        priority: cmdOpts.priority,
        assignee: cmdOpts.assignee,
        tags: cmdOpts.tags?.split(',').map((t) => t.trim()),
      });
      if (!task) {
        console.error(`Task not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      output(task, opts);
    });

  tasks
    .command('delete <id>')
    .description('Delete a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const deleted = await services.workflowService.deleteTask(id);
      if (!deleted) {
        console.error(`Task not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      if (opts.json) {
        output({ deleted: true, id }, opts);
      } else if (!opts.quiet) {
        console.log(`Deleted task ${id}`);
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
      const services = getServices();
      const result = await services.workflowService.transitionTask(id, status, cmdOpts.actor);
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
      output(result.task!, opts);
    });

  tasks
    .command('transitions <id>')
    .description('Show valid transitions for a task')
    .action(async (id: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const task = await services.taskStore.getTask(id);
      if (!task) {
        console.error(`Task not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const transitions = await services.pipelineEngine.getValidTransitions(task, 'manual');
      const rows = transitions.map((t) => ({
        from: t.from,
        to: t.to,
        trigger: t.trigger,
        label: t.label ?? '',
      }));
      output(rows, opts);
    });

  tasks
    .command('start <id>')
    .description('Start a task (transition to first non-initial status)')
    .option('--actor <name>', 'Actor performing the transition')
    .action(async (id: string, cmdOpts: { actor?: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const task = await services.taskStore.getTask(id);
      if (!task) {
        console.error(`Task not found: ${id}`);
        process.exitCode = 1;
        return;
      }
      const transitions = await services.pipelineEngine.getValidTransitions(task, 'manual');
      if (transitions.length === 0) {
        console.error('No available transitions for this task.');
        process.exitCode = 1;
        return;
      }
      const result = await services.workflowService.transitionTask(id, transitions[0].to, cmdOpts.actor);
      if (!result.success) {
        console.error(`Transition failed: ${result.error}`);
        process.exitCode = 1;
        return;
      }
      output(result.task!, opts);
    });
}
