import { IPC_CHANNELS } from '../../shared/ipc-channels';
import { registerIpcHandler } from '@template/main/ipc/ipc-registry';
import type { AppSettings } from '../../shared/types';
import type { AppServices } from '../../core/providers/setup';

/** Read all current settings from the store into an AppSettings object. */
function readCurrentSettings(services: AppServices): AppSettings {
  const { settingsStore } = services;
  return {
    theme: settingsStore.get('theme', 'system') as 'light' | 'dark' | 'system',
    notificationsEnabled: settingsStore.get('notifications_enabled', 'true') === 'true',
    currentProjectId: settingsStore.get('current_project_id', '') || null,
    defaultPipelineId: settingsStore.get('default_pipeline_id', '') || null,
    bugPipelineId: settingsStore.get('bug_pipeline_id', '') || null,
    themeConfig: settingsStore.get('theme_config', '') || null,
    chatDefaultAgentLib: settingsStore.get('chat_default_agent_lib', '') || null,
  };
}

export function registerSettingsHandlers(services: AppServices): void {
  registerIpcHandler(IPC_CHANNELS.SETTINGS_GET, async (): Promise<AppSettings> => {
    return readCurrentSettings(services);
  });

  registerIpcHandler(IPC_CHANNELS.SETTINGS_UPDATE, async (_, updates: Partial<AppSettings>): Promise<AppSettings> => {
    const { settingsStore } = services;
    if (updates.theme !== undefined) {
      settingsStore.set('theme', updates.theme);
    }
    if (updates.notificationsEnabled !== undefined) {
      settingsStore.set('notifications_enabled', updates.notificationsEnabled.toString());
    }
    if (updates.currentProjectId !== undefined) {
      settingsStore.set('current_project_id', updates.currentProjectId ?? '');
    }
    if (updates.defaultPipelineId !== undefined) {
      settingsStore.set('default_pipeline_id', updates.defaultPipelineId ?? '');
    }
    if (updates.bugPipelineId !== undefined) {
      settingsStore.set('bug_pipeline_id', updates.bugPipelineId ?? '');
    }
    if (updates.themeConfig !== undefined) {
      settingsStore.set('theme_config', updates.themeConfig ?? '');
    }
    if (updates.chatDefaultAgentLib !== undefined) {
      settingsStore.set('chat_default_agent_lib', updates.chatDefaultAgentLib ?? '');
    }

    return readCurrentSettings(services);
  });
}
