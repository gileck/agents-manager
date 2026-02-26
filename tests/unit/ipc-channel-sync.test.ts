import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '../../src/shared/ipc-channels';

/**
 * Ensures every channel string defined in src/shared/ipc-channels.ts
 * also appears in the preload bridge (src/preload/index.ts).
 *
 * The preload script duplicates channel constants because Electron's
 * sandboxed preload cannot require() sibling modules. This test catches
 * drift between the two copies.
 */
describe('IPC channel sync: preload vs shared', () => {
  const preloadSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/preload/index.ts'),
    'utf-8',
  );

  const channelValues = Object.values(IPC_CHANNELS);

  it('shared IPC_CHANNELS is non-empty', () => {
    expect(channelValues.length).toBeGreaterThan(0);
  });

  it('every shared channel string appears in the preload source', () => {
    const missing: string[] = [];
    for (const channel of channelValues) {
      if (!preloadSource.includes(`'${channel}'`)) {
        missing.push(channel);
      }
    }
    expect(missing, `Missing channels in preload: ${missing.join(', ')}`).toEqual([]);
  });

  it('preload channel count matches shared channel count', () => {
    // Extract all channel values from the preload's inlined IPC_CHANNELS object
    const preloadChannelMatches = preloadSource.match(
      /const IPC_CHANNELS\s*=\s*\{[\s\S]*?\}\s*as\s*const/,
    );
    expect(preloadChannelMatches, 'Could not find IPC_CHANNELS in preload').not.toBeNull();

    const block = preloadChannelMatches![0];
    // Count the key-value lines (KEY: 'value' pattern)
    const keyLines = block.match(/\w+:\s*'/g);
    expect(keyLines).not.toBeNull();
    expect(keyLines!.length).toBe(channelValues.length);
  });
});
