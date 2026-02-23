---
title: Patterns & Best Practices
description: Memory leak prevention, error handling, window behavior, and process management patterns
summary: Established patterns for Electron + Node.js code in this project covering memory safety, error handling, window lifecycle, and child process management.
priority: 2
guidelines:
  - "Always store interval/timeout references and clear them in app 'before-quit'"
  - "Always wrap JSON.parse in try-catch when reading from the database"
  - "Use isQuitting flag to distinguish window hide vs actual quit"
  - "Kill child processes with negative PID (-pid) to terminate the entire process group"
  - "Always validate IPC handler inputs with validateId() and validateInput()"
---

# Patterns & Best Practices

## Memory Leak Prevention

### Tray Update Intervals

Always store interval references and clear them on app quit:
```typescript
let updateInterval: NodeJS.Timeout | null = null;

// Set
updateInterval = setInterval(updateTray, 5000);

// Clear on quit
app.on('before-quit', () => {
  if (updateInterval) clearInterval(updateInterval);
});
```

### Event Listener Cleanup

Store webContents listeners as references and remove them in the 'closed' handler:
```typescript
const onNavigate = () => { /* ... */ };
window.webContents.on('did-navigate', onNavigate);

window.on('closed', () => {
  window.webContents.removeListener('did-navigate', onNavigate);
  window = null;
});
```

## Error Handling

### JSON Parse Protection

Always wrap JSON.parse in try-catch when reading from database:
```typescript
let args: string[] = [];
try {
  args = JSON.parse(row.script_args || '[]');
} catch {
  console.error('Corrupted JSON in database:', row.script_args);
  args = [];
}
```

### Database Migration Transactions

Wrap migrations in transactions (already done in `template/main/services/database.ts`):
```typescript
const transaction = db.transaction(() => {
  db.exec(migration.sql);
});
transaction();
```

### IPC Handler Validation

Always validate inputs (helpers in `template/main/ipc/ipc-registry.ts`):
```typescript
registerIpcHandler('my-channel', async (_, id: string, input: MyInput) => {
  validateId(id);
  validateInput(input, ['requiredField1', 'requiredField2']);
  return myService.doSomething(id, input);
});
```

## Window Close Behavior

Use an `isQuitting` flag to distinguish between hiding and actually quitting:
```typescript
let isQuitting = false;

app.on('before-quit', () => {
  isQuitting = true;
});

window.on('close', (e) => {
  if (!isQuitting) {
    e.preventDefault();
    window.hide();  // Hide instead of close
  }
});
```

## Process Tree Termination

When spawning child processes, always kill the entire process tree on stop/timeout:
```typescript
function killProcessTree(pid: number) {
  try {
    // Send SIGTERM to process group
    process.kill(-pid, 'SIGTERM');
    // Force kill after 2 seconds if still running
    setTimeout(() => {
      try { process.kill(-pid, 'SIGKILL'); } catch {}
    }, 2000);
  } catch {}
}
```

**Key:** Use negative PID (`-pid`) on Unix/macOS to send signals to the entire process group, not just the parent.
