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

Merge the current worktree branch into `main`. Use:

```bash
git checkout main && git merge - && git checkout -
```

### 7. Summarize and notify

After merging, provide the user with:
- A concise summary of all changes that were made
- The commit hash
- Remind the user they can now safely delete this worktree since changes have been merged to main
