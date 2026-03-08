import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { output, type OutputOptions } from '../output';
import { resolveTaskId } from '../context';
import { readStdinOrValue } from '../stdin';
import { handleCliError } from '../error';

export function registerAgentCommands(program: Command, api: ApiClient): void {
  const agent = program.command('agent').description('Manage agent runs');

  agent
    .command('stop <taskId> <runId>')
    .description('Stop a running agent')
    .action(async (taskId: string, runId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        await api.agents.stop(taskId, runId);
        if (opts.json) {
          output({ stopped: true, runId }, opts);
        } else if (!opts.quiet) {
          console.log(`Stopped agent run ${runId}`);
        }
      } catch (err) {
        handleCliError(err, 'Failed to stop agent');
      }
    });

  agent
    .command('message <taskId>')
    .description('Send a message to a running agent')
    .requiredOption('--message <text>', 'Message to send (use - for stdin)')
    .action(async (taskId: string, cmdOpts: { message: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        const message = await readStdinOrValue(cmdOpts.message);
        if (!message) {
          console.error('Message is required');
          process.exitCode = 1;
          return;
        }
        const result = await api.agents.message(taskId, message);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to send message');
      }
    });

  agent
    .command('review <taskId>')
    .description('Trigger workflow review for a task')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        taskId = await resolveTaskId(api, taskId);
        const result = await api.agents.workflowReview(taskId);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to trigger review');
      }
    });

  agent
    .command('active-tasks')
    .description('List task IDs with active agents')
    .action(async () => {
      const opts = program.opts() as OutputOptions;
      try {
        const taskIds = await api.agents.getActiveTaskIds();
        if (opts.json) {
          console.log(JSON.stringify(taskIds, null, 2));
        } else if (opts.quiet) {
          for (const id of taskIds) console.log(id);
        } else {
          if (taskIds.length === 0) {
            console.log('No active agent tasks.');
          } else {
            for (const id of taskIds) console.log(id);
          }
        }
      } catch (err) {
        handleCliError(err, 'Failed to get active tasks');
      }
    });

  agent
    .command('runs')
    .description('List agent runs')
    .option('--task <taskId>', 'Filter by task ID')
    .option('--active', 'Show only active runs')
    .option('--all', 'Show all runs (including completed)')
    .action(async (cmdOpts: { task?: string; active?: boolean; all?: boolean }) => {
      const opts = program.opts() as OutputOptions;
      try {
        if (cmdOpts.task) {
          cmdOpts.task = await resolveTaskId(api, cmdOpts.task);
        }
        let runs: unknown[];
        if (cmdOpts.all) {
          runs = await api.agents.getAllRuns();
        } else if (cmdOpts.active) {
          runs = await api.agents.getActiveRuns();
        } else if (cmdOpts.task) {
          runs = await api.agents.runs(cmdOpts.task);
        } else {
          runs = await api.agents.getActiveRuns();
        }
        const rows = (runs as { id: string; taskId: string; agentType: string; mode: string; status: string; startedAt: number }[]).map((r) => ({
          runId: r.id,
          task: r.taskId,
          agent: r.agentType,
          mode: r.mode,
          status: r.status,
          started: new Date(r.startedAt).toISOString(),
        }));
        output(rows, opts);
      } catch (err) {
        handleCliError(err, 'Failed to list agent runs');
      }
    });

  agent
    .command('get <runId>')
    .alias('show')
    .description('Get agent run details')
    .action(async (runId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        const run = await api.agents.getRun(runId);
        output(run, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get agent run');
      }
    });
}
