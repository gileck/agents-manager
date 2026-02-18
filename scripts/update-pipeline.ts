import { openDatabase } from '../src/cli/db';

const { services, db } = openDatabase();

async function main() {
  const task = await services.taskStore.getTask('5340f6e1-6aa9-45eb-aa89-aa89b0a5c4e1');
  if (!task) { console.error('Task not found'); return; }

  const pipeline = await services.pipelineStore.getPipeline(task.pipelineId);
  if (!pipeline) { console.error('Pipeline not found'); return; }
  const transitions = pipeline.transitions as any[];

  // Update pr_review → implementing (changes_requested) to use request_changes mode
  const changesRequested = transitions.find(
    (t) => t.from === 'pr_review' && t.to === 'implementing' && t.trigger === 'agent' && t.agentOutcome === 'changes_requested'
  );
  if (changesRequested) {
    const hook = changesRequested.hooks?.find((h: any) => h.name === 'start_agent');
    if (hook && hook.params?.mode === 'implement') {
      hook.params.mode = 'request_changes';
      console.log('Updated changes_requested transition mode: implement → request_changes');
    } else {
      console.log('Hook already has correct mode or not found');
    }
  } else {
    console.log('changes_requested transition not found');
  }

  // Save
  await services.pipelineStore.updatePipeline(pipeline.id, { transitions });

  // Verify
  const updated = await services.pipelineStore.getPipeline(pipeline.id);
  if (!updated) { console.error('Failed to read back pipeline'); db.close(); return; }
  const prTransitions = (updated.transitions as any[]).filter((t) => t.from === 'pr_review');
  console.log('\nPR review transitions now:');
  for (const t of prTransitions) {
    const hooks = t.hooks?.map((h: any) => `${h.name}(${JSON.stringify(h.params || {})})`).join(', ') || 'none';
    console.log(`  ${t.from} -> ${t.to} [${t.trigger}:${t.agentOutcome || t.label}] hooks: ${hooks}`);
  }

  db.close();
}

main().catch(console.error);
