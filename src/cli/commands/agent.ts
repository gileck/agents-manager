import { Command } from 'commander';
import type { AppServices } from '../../main/providers/setup';
import type { AgentMode } from '../../shared/types';
import { output, type OutputOptions } from '../output';

export function registerAgentCommands(program: Command, getServices: () => AppServices): void {
  const agent = program.command('agent').description('Manage agent runs');

  agent
    .command('start <taskId>')
    .description('Start an agent on a task')
    .option('--mode <mode>', 'Agent mode: plan, implement, review', 'plan')
    .option('--type <agentType>', 'Agent type', 'scripted')
    .action(async (taskId: string, cmdOpts: { mode: string; type: string }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      const run = await services.workflowService.startAgent(
        taskId,
        cmdOpts.mode as AgentMode,
        cmdOpts.type,
      );
      output(run, opts);
    });

  agent
    .command('stop <runId>')
    .description('Stop a running agent')
    .action(async (runId: string) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      await services.workflowService.stopAgent(runId);
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
    .action(async (cmdOpts: { task?: string; active?: boolean }) => {
      const opts = program.opts() as OutputOptions;
      const services = getServices();
      let runs;
      if (cmdOpts.active) {
        runs = await services.agentRunStore.getActiveRuns();
      } else if (cmdOpts.task) {
        runs = await services.agentRunStore.getRunsForTask(cmdOpts.task);
      } else {
        runs = await services.agentRunStore.getActiveRuns();
      }
      const rows = runs.map((r) => ({
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
      const services = getServices();
      const run = await services.agentRunStore.getRun(runId);
      if (!run) {
        console.error(`Agent run not found: ${runId}`);
        process.exitCode = 1;
        return;
      }
      output(run, opts);
    });
}
