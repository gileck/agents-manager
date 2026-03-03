import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import { WS_CHANNELS } from '../../src/daemon/ws/channels';

/**
 * Ensures every WS channel defined in src/daemon/ws/channels.ts
 * is subscribed to in the Electron main process (src/main/index.ts).
 *
 * This catches drift between the daemon's WS channels and the
 * Electron forwarding layer that pipes events to the renderer.
 */
describe('WS channel sync: main process vs daemon channels', () => {
  const mainSource = fs.readFileSync(
    path.resolve(__dirname, '../../src/main/index.ts'),
    'utf-8',
  );

  const channelKeys = Object.keys(WS_CHANNELS) as (keyof typeof WS_CHANNELS)[];
  const channelValues = Object.values(WS_CHANNELS);

  it('WS_CHANNELS is non-empty', () => {
    expect(channelValues.length).toBeGreaterThan(0);
  });

  it('every WS_CHANNELS constant is used in a subscribeGlobal() call', () => {
    const missing: string[] = [];
    for (const key of channelKeys) {
      if (!mainSource.includes(`WS_CHANNELS.${key}`)) {
        missing.push(key);
      }
    }
    expect(missing, `WS channels not forwarded in main: ${missing.join(', ')}`).toEqual([]);
  });

  it('subscribeGlobal call count matches WS_CHANNELS entry count', () => {
    const subscriptions = mainSource.match(/subscribeGlobal\(WS_CHANNELS\.\w+/g);
    expect(subscriptions).not.toBeNull();
    expect(subscriptions!.length).toBe(channelValues.length);
  });
});
