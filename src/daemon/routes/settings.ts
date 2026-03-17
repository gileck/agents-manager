import { Router } from 'express';
import type { AppServices } from '../../core/providers/setup';
import type { AppSettings } from '../../shared/types';

/** Read all current settings from the store into an AppSettings object. */
export function readCurrentSettings(services: AppServices): AppSettings {
  const { settingsStore } = services;
  return {
    theme: settingsStore.get('theme', 'dark') as 'light' | 'dark' | 'system',
    notificationsEnabled: settingsStore.get('notifications_enabled', 'true') === 'true',
    currentProjectId: settingsStore.get('current_project_id', '') || null,
    defaultPipelineId: settingsStore.get('default_pipeline_id', '') || null,
    themeConfig: settingsStore.get('theme_config', '') || null,
    chatDefaultAgentLib: settingsStore.get('chat_default_agent_lib', '') || null,
    chatDefaultModel: settingsStore.get('chat_default_model', '') || null,
    chatDefaultPermissionMode: (settingsStore.get('chat_default_permission_mode', '') || null) as AppSettings['chatDefaultPermissionMode'],
    chatThreadTheme: settingsStore.get('chat_thread_theme', '') || null,
    chatPreset: settingsStore.get('chat_preset', '') || null,
  };
}

export function settingsRoutes(services: AppServices): Router {
  const router = Router();

  router.get('/api/settings', (_req, res, next) => {
    try {
      const settings = readCurrentSettings(services);
      res.json(settings);
    } catch (err) { next(err); }
  });

  router.patch('/api/settings', (req, res, next) => {
    try {
      const updates = req.body as Partial<AppSettings>;
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
      if (updates.themeConfig !== undefined) {
        settingsStore.set('theme_config', updates.themeConfig ?? '');
      }
      if (updates.chatDefaultAgentLib !== undefined) {
        settingsStore.set('chat_default_agent_lib', updates.chatDefaultAgentLib ?? '');
      }
      if (updates.chatDefaultModel !== undefined) {
        settingsStore.set('chat_default_model', updates.chatDefaultModel ?? '');
      }
      if (updates.chatDefaultPermissionMode !== undefined) {
        settingsStore.set('chat_default_permission_mode', updates.chatDefaultPermissionMode ?? '');
      }
      if (updates.chatThreadTheme !== undefined) {
        settingsStore.set('chat_thread_theme', updates.chatThreadTheme ?? '');
      }
      if (updates.chatPreset !== undefined) {
        settingsStore.set('chat_preset', updates.chatPreset ?? '');
      }

      const settings = readCurrentSettings(services);
      res.json(settings);
    } catch (err) { next(err); }
  });

  return router;
}
