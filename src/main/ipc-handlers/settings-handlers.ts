import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import { getSetting, setSetting } from '@template/main/services/settings-service';
import type { AppSettings } from '../../shared/types';

/** Read all current settings from the store into an AppSettings object. */
function readCurrentSettings(): AppSettings {
  return {
    theme: getSetting('theme', 'system') as 'light' | 'dark' | 'system',
    notificationsEnabled: getSetting('notifications_enabled', 'true') === 'true',
    currentProjectId: getSetting('current_project_id', '') || null,
    defaultPipelineId: getSetting('default_pipeline_id', '') || null,
    bugPipelineId: getSetting('bug_pipeline_id', '') || null,
    themeConfig: getSetting('theme_config', '') || null,
    chatDefaultAgentLib: getSetting('chat_default_agent_lib', '') || null,
  };
}

export function registerSettingsHandlers(): void {
  registerIpcHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
    return readCurrentSettings();
  });

  registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
    if (updates.theme !== undefined) {
      setSetting('theme', updates.theme);
    }
    if (updates.notificationsEnabled !== undefined) {
      setSetting('notifications_enabled', updates.notificationsEnabled.toString());
    }
    if (updates.currentProjectId !== undefined) {
      setSetting('current_project_id', updates.currentProjectId ?? '');
    }
    if (updates.defaultPipelineId !== undefined) {
      setSetting('default_pipeline_id', updates.defaultPipelineId ?? '');
    }
    if (updates.bugPipelineId !== undefined) {
      setSetting('bug_pipeline_id', updates.bugPipelineId ?? '');
    }
    if (updates.themeConfig !== undefined) {
      setSetting('theme_config', updates.themeConfig ?? '');
    }
    if (updates.chatDefaultAgentLib !== undefined) {
      setSetting('chat_default_agent_lib', updates.chatDefaultAgentLib ?? '');
    }

    return readCurrentSettings();
  });
}
