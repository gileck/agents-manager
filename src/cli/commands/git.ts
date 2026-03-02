import { Command } from 'commander';
import type { ApiClient } from '../../client/api-client';
import { output, type OutputOptions } from '../output';
import { requireProject } from '../context';
import { handleCliError } from '../error';

function printRaw(result: unknown, opts: OutputOptions): void {
  if (opts.json) {
    output(result, opts);
  } else {
    console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2));
  }
}

export function registerGitCommands(program: Command, api: ApiClient): void {
  const git = program.command('git').description('Git operations');

  // -- Task-scoped commands --------------------------------------------------

  git
    .command('diff <taskId>')
    .description('Show committed diff for a task branch')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        printRaw(await api.git.getDiff(taskId), opts);
      } catch (err) {
        handleCliError(err, 'Failed to get diff');
      }
    });

  git
    .command('log <taskId>')
    .description('Show git log for a task branch')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        printRaw(await api.git.getLog(taskId), opts);
      } catch (err) {
        handleCliError(err, 'Failed to get log');
      }
    });

  git
    .command('status <taskId>')
    .description('Show git status for a task worktree')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        printRaw(await api.git.getStatus(taskId), opts);
      } catch (err) {
        handleCliError(err, 'Failed to get status');
      }
    });

  git
    .command('stat <taskId>')
    .description('Show diffstat for a task branch')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        printRaw(await api.git.getStat(taskId), opts);
      } catch (err) {
        handleCliError(err, 'Failed to get stat');
      }
    });

  git
    .command('working-diff <taskId>')
    .description('Show uncommitted working diff for a task')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        printRaw(await api.git.getWorkingDiff(taskId), opts);
      } catch (err) {
        handleCliError(err, 'Failed to get working diff');
      }
    });

  git
    .command('reset-file <taskId>')
    .description('Reset a file in the task worktree')
    .requiredOption('--file <path>', 'File path to reset')
    .action(async (taskId: string, cmdOpts: { file: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        const result = await api.git.resetFile(taskId, cmdOpts.file);
        if (opts.json) {
          output(result, opts);
        } else if (!opts.quiet) {
          console.log(`Reset file: ${cmdOpts.file}`);
        }
      } catch (err) {
        handleCliError(err, 'Failed to reset file');
      }
    });

  git
    .command('clean <taskId>')
    .description('Clean untracked files in task worktree')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        const result = await api.git.clean(taskId);
        if (opts.json) {
          output(result, opts);
        } else if (!opts.quiet) {
          console.log('Cleaned untracked files');
        }
      } catch (err) {
        handleCliError(err, 'Failed to clean');
      }
    });

  git
    .command('pull <taskId>')
    .description('Pull latest changes for a task worktree')
    .option('--branch <name>', 'Branch to pull from')
    .action(async (taskId: string, cmdOpts: { branch?: string }) => {
      const opts = program.opts() as OutputOptions;
      try {
        const result = await api.git.pull(taskId, cmdOpts.branch);
        if (opts.json) {
          output(result, opts);
        } else if (!opts.quiet) {
          console.log('Pull complete');
        }
      } catch (err) {
        handleCliError(err, 'Failed to pull');
      }
    });

  git
    .command('show <taskId> <hash>')
    .description('Show a specific commit in task worktree')
    .action(async (taskId: string, hash: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        printRaw(await api.git.showCommit(taskId, hash), opts);
      } catch (err) {
        handleCliError(err, 'Failed to show commit');
      }
    });

  git
    .command('pr-checks <taskId>')
    .description('Get PR check results for a task')
    .action(async (taskId: string) => {
      const opts = program.opts() as OutputOptions;
      try {
        const result = await api.git.getPRChecks(taskId);
        if (result === null) {
          if (opts.json) {
            console.log('null');
          } else if (!opts.quiet) {
            console.log('No PR checks found');
          }
          return;
        }
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get PR checks');
      }
    });

  // -- Project-scoped commands -----------------------------------------------

  git
    .command('project-log')
    .description('Show git log for the project repository')
    .option('--count <n>', 'Number of commits to show', parseInt)
    .action(async (cmdOpts: { count?: number }) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);
        const result = await api.git.getProjectLog(project.id, cmdOpts.count);
        output(result, opts);
      } catch (err) {
        handleCliError(err, 'Failed to get project log');
      }
    });

  git
    .command('project-branch')
    .description('Show current branch for the project repository')
    .action(async () => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);
        const result = await api.git.getProjectBranch(project.id);
        if (opts.json) {
          output(result, opts);
        } else {
          console.log(result.branch);
        }
      } catch (err) {
        handleCliError(err, 'Failed to get project branch');
      }
    });

  git
    .command('project-commit <hash>')
    .description('Show a specific commit in the project repository')
    .action(async (hash: string) => {
      const opts = program.opts() as OutputOptions & { project?: string };
      try {
        const project = await requireProject(api, opts.project);
        printRaw(await api.git.getProjectCommit(project.id, hash), opts);
      } catch (err) {
        handleCliError(err, 'Failed to get project commit');
      }
    });
}
