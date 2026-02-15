#!/usr/bin/env node

/**
 * Test task that runs for 20 seconds
 * Outputs progress every 2 seconds
 */

const DURATION = 20; // seconds
const INTERVAL = 2;  // seconds between updates

console.log(`[Test Task] Starting - will run for ${DURATION} seconds`);
console.log(`[Test Task] PID: ${process.pid}`);
console.log('');

let elapsed = 0;

const timer = setInterval(() => {
  elapsed += INTERVAL;
  const progress = Math.round((elapsed / DURATION) * 100);
  const bar = '█'.repeat(Math.floor(progress / 5)) + '░'.repeat(20 - Math.floor(progress / 5));

  console.log(`[Test Task] Progress: ${bar} ${progress}% (${elapsed}s / ${DURATION}s)`);

  if (elapsed >= DURATION) {
    clearInterval(timer);
    console.log('');
    console.log('[Test Task] Completed successfully!');
    process.exit(0);
  }
}, INTERVAL * 1000);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Test Task] Received SIGTERM, shutting down...');
  clearInterval(timer);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Test Task] Received SIGINT, shutting down...');
  clearInterval(timer);
  process.exit(0);
});
