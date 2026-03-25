<!-- 
  Agent prompt template. This file is loaded at execution time and processed
  through PromptRenderer for variable substitution.

  Available variables:
    {taskTitle}                    - Task title
    {taskDescription}             - Task description
    {taskId}                      - Task ID
    {subtasksSection}             - Subtask list / tracking instructions
    {planSection}                 - Plan document (if available)
    {planCommentsSection}         - Plan feedback comments
    {priorReviewSection}          - Prior review feedback (for re-reviews)
    {relatedTaskSection}          - Related task references
    {technicalDesignSection}      - Technical design document (if available)
    {technicalDesignCommentsSection} - Design feedback comments
    {defaultBranch}               - Default git branch name
    {skillsSection}               - Available skills list
    {skipSummary}                 - Include to suppress auto-appended summary instruction

  The system automatically injects: feedback, task context, worktree guards,
  skills, and validation errors around this prompt. You only need to provide
  the agent role instructions and output format.
-->
Implement the changes for this task. Task: {taskTitle}. {taskDescription}

## Instructions
1. Read CLAUDE.md (or project conventions file) to understand project rules — package manager, restricted directories, code patterns, error handling rules. Follow these rules throughout your implementation.
2. Read the architecture documentation in docs/ (especially docs/architecture-overview.md and docs/abstractions.md) to understand layer boundaries, abstraction contracts, and separation of concerns. Your implementation must respect these boundaries.
3. **Read the files you will modify first.** If the task description names a specific file path and function/method, open those files directly — do not spawn an Explore subagent. If you do delegate to an Explore subagent, wait for its result before issuing any further search or read calls — do not search in parallel. Understand existing patterns, naming conventions, and code style before writing anything.
4. **If the plan includes an Assumptions section**, verify each UNVERIFIED assumption by reading the relevant code before making any edits. If an assumption is wrong, report it via `needs_info` with details — do not try to work around a broken assumption.
5. Follow existing patterns — match the style of surrounding code.
6. Respect architecture boundaries: business logic goes in services (src/core/services/), use interfaces (src/core/interfaces/) not implementation details, do not leak abstractions across documented boundaries.
7. Make focused changes — only modify what is necessary for this task.
8. Ensure no security vulnerabilities: no hardcoded secrets, no SQL injection, no path traversal, no XSS. Follow OWASP top 10 guidelines.
9. Add or update tests for new code paths. If the project has existing test patterns, follow them.
10. Surface errors properly — do not swallow failures with empty catch blocks. Follow the project's error handling patterns documented in CLAUDE.md.
11. After making all changes, run `yarn checks` (or the project's equivalent) to ensure TypeScript and lint pass. Fix any errors before committing.
12. Stage and commit with a descriptive message (git add the relevant files, then git commit).
13. **Rebase onto origin/main before finishing:** run `git fetch origin && git rebase origin/main`. If there are merge conflicts, resolve them (preserve the intent of both sides), `git add` the resolved files, and `git rebase --continue`. After the rebase, re-run `yarn checks`. If checks fail, compare against `origin/main` — if the same failures exist on main, they are pre-existing and should be ignored. Do not spend time debugging pre-existing issues. If tests fail due to **timeouts**, retry with an extended timeout: `TEST_TIMEOUT=60000 yarn checks`.
## Interactive Questions
If you encounter ambiguity or need user input before proceeding, you can ask questions:
- Set `outcome` to `"needs_info"` in your output
- Provide a `questions` array with your questions (max 5)
- Each question has: `id`, `question`, optional `context`, optional `options[]`
- For multiple-choice: include `options` with `id`, `label`, `description`, and optionally `recommended: true`
- The user can also add custom text to any answer
- Only ask when genuinely needed — do not ask if you can make a reasonable decision yourself