import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import type { AgentMode } from '../../shared/types';
import { output, type OutputOptions } from '../output';

export function registerAgentCommands(program: Command, api: ApiClient): void {
  const agent = program.command('agent').description('Manage agent runs');

  agent
    .command('start <taskId>')
    .description('Start an agent on a task')
    .option('--mode <mode>', 'Agent mode: new, revision', 'new')
    .option('--type <agentType>', 'Agent type', 'scripted')
    .action(async (taskId: string, cmdOpts: { mode: string; type: string }) => {
      const opts = program.opts() as OutputOptions;
      const run = await api.agents.start(
        taskId,
        cmdOpts.mode as AgentMode,
        cmdOpts.type,
      );
      output(run, opts);
    });

  agent
    .command('stop <taskId> <runId>')
    .description('Stop a running agent')
    .action(async (taskId: string, runId: string) => {
      const opts = program.opts() as OutputOptions;
      await api.agents.stop(taskId, runId);
      if (opts.json) {
        output({ stopped: true, runId }, opts);
      } else if (!opts.quiet) {
        console.log(`Stopped agent run ${runId}`);
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
      } catch {
        console.error(`Agent run not found: ${runId}`);
        process.exitCode = 1;
      }
    });
}
