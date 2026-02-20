---
description: Run multiple tasks in parallel using separate git worktrees and sub-agents
---

# Run Tasks in Parallel Command

Execute multiple tasks simultaneously, each in its own isolated git worktree with a dedicated sub-agent. All tasks run in parallel, get reviewed, and merge sequentially to main.

## Usage

Invoke this command with task descriptions (pipe-separated):

- `/run-tasks-parallel task 1 description | task 2 description | task 3 description`
- `/run-tasks-parallel Fix the login bug | Add dark mode toggle | Refactor API client`

Or with task numbers from task-manager:
- `/run-tasks-parallel #3 | #5 | #7`
- `/run-tasks-parallel #3 | Add new settings page | #7`

**Argument: $ARGUMENTS**

---

## Architecture Overview

```
Main Agent (Orchestrator)
├── Sub-Agent 1 (worktree-1) ──→ implement → review → commit → report
├── Sub-Agent 2 (worktree-2) ──→ implement → review → commit → report
└── Sub-Agent 3 (worktree-3) ──→ implement → review → commit → report
         │                              │
         ▼                              ▼
    Sequential Merge              Clarifications
    (one at a time)              (relay via main agent)
```

**Key principles:**
- Each task gets its own worktree and sub-agent
- Sub-agents work in parallel, completely isolated
- Merge happens sequentially to avoid conflicts
- All clarifications flow through the main agent
- User approves each task before merge

---

## Phase 1: Parse and Validate Tasks

### Step 1: Parse Task List

- **Objective**: Extract individual tasks from arguments
- **Actions**:
  - Split `$ARGUMENTS` by `|` delimiter
  - Trim whitespace from each task
  - For each task:
    - If starts with `#` followed by a number (e.g., `#3`): load from task-manager with `yarn task view --task N`
    - Otherwise: treat as inline task description
  - Assign each task an index (1, 2, 3...)
  - Generate a short slug for each task (e.g., "fix-login-bug", "add-dark-mode")

**Example parsing:**
```
Input: "Fix the login bug | Add dark mode toggle | #7"
Output:
  Task 1: "Fix the login bug" (slug: fix-login-bug)
  Task 2: "Add dark mode toggle" (slug: add-dark-mode)
  Task 3: Task #7 from task-manager (slug: from task title)
```

### Step 2: Validate Prerequisites

- **Actions**:
  - Ensure main branch is clean: `git status --porcelain` should be empty
  - If not clean, ask user to commit or stash changes first
  - Check no existing worktrees conflict: `git worktree list`
  - Verify we're on main branch: `git branch --show-current`

### Step 3: Present Plan to User

- **Objective**: Get user confirmation before starting
- **Actions**:
  - Display all parsed tasks with their indices
  - Show how many worktrees will be created
  - List any task-manager tasks loaded
  - Ask user to confirm: "Ready to start N tasks in parallel?"
  - Wait for user approval before proceeding

---

## Phase 2: Create All Worktrees

### Step 4: Create Worktrees

- **Objective**: Set up isolated workspaces for all tasks
- **Actions**:
  - Save main project path: `MAIN_PROJECT_PATH=$(pwd)`
  - For each task (index I, slug SLUG):
    - Create branch: `git worktree add -b parallel/I-SLUG ../worktree-parallel-I-SLUG HEAD`
    - Symlink dependencies: `ln -s "${MAIN_PROJECT_PATH}/node_modules" ../worktree-parallel-I-SLUG/node_modules`
  - Verify all worktrees created: `git worktree list`

**Naming convention:**
- Branch: `parallel/{index}-{slug}` (e.g., `parallel/1-fix-login-bug`)
- Worktree folder: `../worktree-parallel-{index}-{slug}` (e.g., `../worktree-parallel-1-fix-login-bug`)

**CRITICAL - Always symlink, never install:**
- `ln -s "${MAIN_PROJECT_PATH}/node_modules" node_modules`
- Never run `yarn install` in worktrees

---

## Phase 3: Launch Parallel Sub-Agents

### Step 5: Launch Sub-Agents

- **Objective**: Start a sub-agent for each task, all running in parallel
- **Actions**:
  - Launch ALL sub-agents simultaneously using the Task tool with `run_in_background: true`
  - Each sub-agent gets `subagent_type: "general-purpose"`
  - All Task tool calls should be in a SINGLE message to maximize parallelism
  - Record the output_file for each sub-agent to monitor progress

**Sub-Agent Prompt Template:**

For each task, use the following prompt (filling in task-specific values):

```
You are a sub-agent working on a specific task in an isolated git worktree.
Your worktree is at: {WORKTREE_PATH}
The main project is at: {MAIN_PROJECT_PATH}

## YOUR TASK

{TASK_DESCRIPTION}

{If task-manager task: include full task details from yarn task view}

## PARALLEL CONTEXT

You are one of {N} sub-agents working in parallel. Other tasks being worked on:
{List of other task descriptions - so agent knows what others are doing}

IMPORTANT: Only modify files relevant to YOUR task. Do not touch files that another sub-agent might be modifying unless absolutely necessary. If you discover a conflict or overlap with another task, STOP and report it.

## WORKFLOW - Follow these agent steps in order:

### Agent Step A: Read Project Guidelines
- Read CLAUDE.md in the worktree for project guidelines
- Read any relevant docs from docs/ folder that relate to your task
- Read any relevant commands from .ai/commands/ folder
- Understand the project architecture and coding standards

### Agent Step B: Explore and Understand
- Explore the codebase to understand what needs to change
- Identify all files that need modification
- Look at existing patterns and follow them
- If anything is unclear or you need clarification, STOP and output:
  CLARIFICATION_NEEDED: [Your question here]
  Then STOP completely. The main agent will resume you with the user's answer.

### Agent Step C: Implement
- Make all necessary changes in the worktree
- Follow project coding standards (from CLAUDE.md)
- Keep changes focused on your task only
- Don't over-engineer or add unnecessary features

### Agent Step D: Validate
- Run: yarn checks (from the worktree directory)
- Fix any TypeScript or ESLint errors
- Re-run until all checks pass with 0 errors
- If checks keep failing and you can't fix them, report the issue

### Agent Step E: Code Review
- Use the Task tool to launch a code review:
  Task tool with subagent_type: "pr-review-toolkit:code-reviewer"
  Prompt: "Review the unstaged changes in the current git repository at {WORKTREE_PATH}. Run git diff to see all changes. Check for bugs, logic errors, security issues, code quality, and adherence to project conventions in CLAUDE.md."
- Address ALL issues raised by the reviewer
- If the reviewer found issues:
  - Fix each issue
  - Run yarn checks again
  - Re-run the code review to verify fixes

### Agent Step F: Commit
- First verify no sensitive files are staged: check for .env, credentials, secrets, large binaries
- Stage changes by specifying files explicitly: git add {list of modified files}
- If too many files, use: git add -u (only tracked files, avoids accidentally adding new sensitive files)
- Commit with a descriptive message:
  git commit -m "feat/fix: description of changes"
- Verify commit: git status (should be clean)

### Agent Step G: Report Back
- Output a summary in this EXACT format:

TASK_COMPLETE:
## Task: {task description}
## Changes Summary:
- [List each file modified and what changed]
## Key Decisions:
- [Any important implementation decisions made]
## Files Modified:
- [List of all files changed]
## Review Status: Passed / Issues Found
## Validation: yarn checks passed

AWAITING_APPROVAL

Do NOT proceed past this point. Wait for approval from the main agent.

### Agent Step H: After Approval
When you receive "APPROVED" from the main agent, your work is done.
The main agent will handle merging your worktree to main.

## IMPORTANT RULES:
- Work ONLY in your worktree: {WORKTREE_PATH}
- NEVER change directory to the main project
- NEVER push to any remote
- NEVER merge anything yourself
- If you need clarification, STOP and ask (use CLARIFICATION_NEEDED: prefix)
- If you find a potential conflict with another task, STOP and report it
- Always run yarn checks before committing
- Always run code review before committing
```

---

## Phase 4: Monitor and Relay

### Step 6: Monitor Sub-Agents

- **Objective**: Track progress and handle clarification requests
- **Actions**:
  - Periodically check each sub-agent's output file using the Read tool
  - Look for these signals in the output:
    - `CLARIFICATION_NEEDED:` → Sub-agent needs user input
    - `TASK_COMPLETE:` → Sub-agent finished, ready for approval
    - Error messages → Sub-agent hit a problem
  - Check every 30-60 seconds using Read tool on output files

### Step 7: Handle Clarifications

- **Objective**: Relay questions between sub-agents and user
- **Actions**:
  - When a sub-agent outputs `CLARIFICATION_NEEDED: [question]`:
    1. Present the question to the user: "Sub-agent working on '{task description}' needs clarification: {question}"
    2. Wait for user response
    3. Resume the sub-agent using the Task tool with `resume` parameter and the agent's ID
    4. Pass the user's answer as the prompt: "The user provided this clarification: {user's answer}. Please continue with your task."
  - Continue monitoring other sub-agents while waiting
  - **Note**: The Task tool `resume` parameter takes the agent ID from the original launch. The resumed agent continues with its full previous context preserved.

### Step 8: Handle Errors

- **Objective**: Deal with sub-agent failures gracefully
- **Actions**:
  - If a sub-agent reports persistent errors:
    1. Notify user: "Sub-agent for '{task}' encountered an error: {error details}"
    2. Ask user: "Skip this task, retry, or abort all?"
    3. If skip: mark task as failed, continue with others
    4. If retry: resume the sub-agent using Task tool with `resume` parameter and provide guidance
    5. If abort: stop all sub-agents, clean up all worktrees

---

## Phase 5: User Approval Loop

### Step 9: Collect and Present Results

- **Objective**: Get user approval for each completed task
- **Actions**:
  - As each sub-agent reports `TASK_COMPLETE:`, collect its summary
  - Present the summary to the user:
    ```
    ## Task {I}/{N} Ready for Review: {task description}

    {Sub-agent's summary from TASK_COMPLETE output}

    Approve this task for merge? (yes/no/request changes)
    ```
  - **If user approves**: Mark task as approved, proceed with merge in Phase 6
  - **If user requests changes**: Resume sub-agent with change requests, sub-agent re-implements and re-reviews
  - **If user rejects**: Mark task as rejected, clean up its worktree

**IMPORTANT**: Present tasks for approval as they complete. Don't wait for all tasks to finish before starting approval.

---

## Phase 6: Sequential Merge

### Step 10: Merge Approved Tasks (One at a Time)

- **Objective**: Safely merge all approved worktrees to main
- **CRITICAL**: Merge one task at a time to handle conflicts

**For each approved task (in order of task index):**

1. **Ensure main is up to date:**
   ```bash
   git checkout main
   git pull origin main  # if remote tracking
   ```

2. **Squash merge the worktree branch:**
   ```bash
   git merge --squash parallel/{index}-{slug}
   ```

3. **If merge conflicts:**
   - Report to user: "Merge conflict detected for task '{description}'"
   - Show conflicting files
   - Ask user how to proceed:
     - Resolve conflicts manually (show the conflicts)
     - Skip this task
     - Abort remaining merges
   - If resolving: fix conflicts, stage resolved files

4. **Create clean commit:**
   ```bash
   git commit -m "$(cat <<'EOF'
   feat/fix: descriptive title (parallel task {I}/{N})

   {Brief description of what was changed and why}

   Key changes:
   - {file1}: {what changed}
   - {file2}: {what changed}

   Co-Authored-By: Claude Opus 4.6 <noreply@anthropic.com>
   EOF
   )"
   ```

5. **Run yarn checks on main after merge:**
   ```bash
   yarn checks
   ```
   - If checks fail after merge: the combined changes broke something
   - Report to user with details
   - Options: fix the issue, revert this merge, or abort

6. **Move to next task** - repeat from step 1 for the next approved task

---

## Phase 7: Cleanup

### Step 11: Remove All Worktrees

- **Objective**: Clean up all worktrees and branches
- **Actions**:
  - For each worktree (approved, rejected, or failed):
    ```bash
    git worktree remove ../worktree-parallel-{I}-{slug} --force
    git branch -D parallel/{I}-{slug}
    ```
  - Verify all cleaned up: `git worktree list` (should only show main)
  - Verify branches deleted: `git branch` (no parallel/* branches)

---

## Phase 8: Final Verification

### Step 12: Final Checks on Main

- **Objective**: Ensure everything is clean and working
- **Actions**:
  - Run `yarn checks` one final time on main
  - If any issues found, fix them immediately
  - Verify git status is clean
  - Verify git log shows all expected commits

### Step 13: Final Summary to User

- **Objective**: Report overall completion
- **Actions**:
  - Present comprehensive summary:

```
## Parallel Tasks Complete

### Results Summary
| # | Task | Status | Commit |
|---|------|--------|--------|
| 1 | {description} | Merged | {short hash} |
| 2 | {description} | Merged | {short hash} |
| 3 | {description} | Skipped/Failed | - |

### Commits on Main
{List of all new commits with hashes and messages}

### Validation
- yarn checks: PASSED
- All worktrees: CLEANED UP
- All branches: DELETED

### Files Modified (across all tasks)
- {List all files modified across all tasks}
```

---

## Error Recovery

### Abort All Tasks
If the user wants to abort everything at any point:
```bash
# Stop all sub-agents (they will terminate)
# Clean up each worktree individually (git does not support glob patterns):
git worktree remove ../worktree-parallel-1-slug --force
git worktree remove ../worktree-parallel-2-slug --force
# ... repeat for each worktree

# Delete each parallel branch:
git branch -D parallel/1-slug parallel/2-slug  # list all branch names explicitly

# Verify cleanup:
git worktree list  # should only show main
git branch  # should have no parallel/* branches
```

### Single Task Failure
If one sub-agent fails but others succeed:
- Continue with successful tasks
- Report failure to user
- Clean up the failed task's worktree
- Merge successful tasks normally

### Merge Conflict Recovery
If a merge conflict cannot be resolved:
- Abort the merge: `git merge --abort`
- Run `yarn checks` to verify main is still clean after abort
- Skip this task
- Continue merging remaining tasks
- Report skipped task to user

---

## Quick Reference

```bash
# === SETUP ===
MAIN_PROJECT_PATH=$(pwd)
# For each task I with slug SLUG:
git worktree add -b parallel/I-SLUG ../worktree-parallel-I-SLUG HEAD
ln -s "${MAIN_PROJECT_PATH}/node_modules" ../worktree-parallel-I-SLUG/node_modules

# === SUB-AGENT WORK (parallel) ===
# Each sub-agent in its worktree:
#   1. Read docs/skills
#   2. Implement changes
#   3. yarn checks
#   4. Code review (pr-review-toolkit:code-reviewer)
#   5. git commit
#   6. Report back

# === MERGE (sequential, one at a time) ===
git checkout main
git merge --squash parallel/1-slug
git commit -m "feat: task 1 description"
yarn checks  # verify after each merge

git merge --squash parallel/2-slug
git commit -m "feat: task 2 description"
yarn checks  # verify after each merge

# === CLEANUP ===
git worktree remove ../worktree-parallel-1-slug --force
git worktree remove ../worktree-parallel-2-slug --force
git branch -D parallel/1-slug parallel/2-slug
git worktree list  # verify only main remains

# === FINAL ===
yarn checks  # one final validation
```

---

## Checklist

- [ ] Tasks parsed and validated
- [ ] User confirmed task list
- [ ] Main branch is clean
- [ ] All worktrees created with symlinked node_modules
- [ ] All sub-agents launched in parallel (background)
- [ ] Clarifications relayed between sub-agents and user
- [ ] Each sub-agent: implemented → validated → reviewed → committed
- [ ] User approved each task individually
- [ ] Worktrees merged sequentially (one at a time)
- [ ] `yarn checks` passed after EACH merge
- [ ] All worktrees removed
- [ ] All parallel branches deleted
- [ ] Final `yarn checks` on main passed
- [ ] Summary presented to user
