#!/usr/bin/env node

/**
 * Test task that runs for 3 seconds and then fails
 * Used to test the retry mechanism
 */

const DURATION = 3; // seconds before failing

console.log(`[Failing Task] Starting - will fail after ${DURATION} seconds`);
console.log(`[Failing Task] PID: ${process.pid}`);
console.log('');

let elapsed = 0;

const timer = setInterval(() => {
  elapsed += 1;
  console.log(`[Failing Task] Running... ${elapsed}s / ${DURATION}s`);

  if (elapsed >= DURATION) {
    clearInterval(timer);
    console.log('');
    console.error('[Failing Task] ERROR: Simulated failure!');
    process.exit(1); // Exit with error code
  }
}, 1000);

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('[Failing Task] Received SIGTERM, shutting down...');
  clearInterval(timer);
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('[Failing Task] Received SIGINT, shutting down...');
  clearInterval(timer);
  process.exit(0);
});
