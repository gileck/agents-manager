import type { GitLogEntry, GitCommitDetail } from '../../shared/types';

export interface IGitOps {
  createBranch(name: string, baseBranch?: string): Promise<void>;
  /** Create a branch ref without checking it out: `git branch <name> <base>`. */
  createBranchRef(name: string, base: string): Promise<void>;
  checkout(branch: string): Promise<void>;
  fetch(remote?: string, refspec?: string): Promise<void>;
  push(branch: string, force?: boolean): Promise<void>;
  pull(branch: string, options?: { ffOnly?: boolean }): Promise<void>;
  diff(fromRef: string, toRef?: string): Promise<string>;
  diffStat(fromRef: string, toRef?: string): Promise<string>;
  commit(message: string): Promise<string>;
  log(count?: number): Promise<GitLogEntry[]>;
  rebase(onto: string): Promise<void>;
  /** Abort an in-progress rebase. */
  rebaseAbort(): Promise<void>;
  getCurrentBranch(): Promise<string>;
  /** Discard all uncommitted changes and untracked files in the working tree. */
  clean(): Promise<void>;
  /** Return `git status --porcelain` output. */
  status(): Promise<string>;
  /** Reset a single file: `git checkout -- <filepath>`. */
  resetFile(filepath: string): Promise<void>;
  /** Return `git show <hash>` diff output. */
  showCommit(hash: string): Promise<string>;
  /** Delete a remote branch: `git push origin --delete <branch>`. */
  deleteRemoteBranch(branch: string): Promise<void>;
  getCommitDetail(hash: string): Promise<GitCommitDetail>;
  /** Return the merge-base commit hash of two refs: `git merge-base <ref1> <ref2>`. */
  mergeBase(ref1: string, ref2: string): Promise<string>;
  /** Return the resolved commit hash: `git rev-parse <ref>`. */
  revParse(ref: string): Promise<string>;
}
