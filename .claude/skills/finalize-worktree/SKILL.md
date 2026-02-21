---
name: finalize-worktree
description: Run after implementing code in a worktree to review, fix issues, commit, merge to main, and summarize changes. Use when done coding in a worktree.
user-invocable: true
---

# Finalize Worktree

Run this command after you finish implementing code in a worktree. It will review the code, fix any issues, commit, merge to main, and summarize.

## Steps

Follow these steps in order:

### 1. Review the code

Run the `/pr-review-toolkit:review-pr` skill to review all the changes in the current worktree.

### 2. Fix all issues

If the review found any issues, fix every single one of them. Do not skip any issue. Re-review after fixing to make sure everything is clean.

### 3. Commit all changes

Stage all modified and new files and create a git commit with a clear, descriptive commit message summarizing what was implemented.

### 4. Rebase onto main

Rebase the current branch onto `main` to incorporate any changes that were merged while this worktree was being worked on. This ensures conflicts are resolved here rather than during the merge.

```bash
git rebase main
```

If there are conflicts, resolve them and continue the rebase.

### 5. Quick review after rebase

If the rebase had conflicts that required resolution, do a quick review of the resolved files to make sure nothing broke. Fix any issues and amend the commit if needed.

### 6. Merge changes to main

Fast-forward main to the current branch. Since we already rebased onto main in step 4, this produces a clean linear history with no merge commit.

Because `main` is checked out in the main worktree, you cannot `git checkout main` from a worktree. Instead, run the merge from the main worktree directory:

```bash
git -C <main-worktree-path> merge --ff-only <current-branch-name>
```

For example, if the main worktree is at `/Users/gileck/Projects/agents-manager` and the current branch is `worktree-my-feature`:

```bash
git -C /Users/gileck/Projects/agents-manager merge --ff-only worktree-my-feature
```

If fast-forward fails, it means the rebase in step 4 didn't fully incorporate main. Re-run `git rebase main`, resolve any conflicts, run checks again, then retry the fast-forward merge.

### 7. Summarize and notify

After merging, provide the user with:
- A concise summary of all changes that were made
- The commit hash
- Remind the user they can now safely delete this worktree since changes have been merged to main
