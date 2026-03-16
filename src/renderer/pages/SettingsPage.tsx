import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import { Switch } from '../components/ui/switch';
import { useTheme } from '../hooks/useTheme';
import { reportError } from '../lib/error-handler';
import type { AppSettings } from '../../shared/types';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.api.settings.get().then(setSettings).catch((err) => reportError(err, 'Load settings'));
    window.api.app.getVersion().then(setVersion).catch((err) => reportError(err, 'App version'));
  }, []);

  const handleThemeChange = async (newTheme: 'light' | 'dark' | 'system') => {
    setTheme(newTheme);
    const updated = await window.api.settings.update({ theme: newTheme });
    setSettings(updated);
  };

  const handleNotificationsToggle = async (enabled: boolean) => {
    const updated = await window.api.settings.update({ notificationsEnabled: enabled });
    setSettings(updated);
  };

  if (!settings) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading settings...</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <div className="max-w-2xl">
        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Appearance</CardTitle>
              <CardDescription>Customize how the app looks</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="theme">Theme</Label>
                  <Select value={theme} onValueChange={(value: string) => handleThemeChange(value as 'light' | 'dark' | 'system')}>
                    <SelectTrigger id="theme" className="w-32">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="light">Light</SelectItem>
                      <SelectItem value="dark">Dark</SelectItem>
                      <SelectItem value="system">System</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Notifications</CardTitle>
              <CardDescription>Manage notification preferences</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <Label htmlFor="notifications">Enable Notifications</Label>
                <Switch
                  id="notifications"
                  checked={settings.notificationsEnabled}
                  onCheckedChange={handleNotificationsToggle}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>About</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-sm space-y-1">
                <p><span className="font-medium">Version:</span> {version}</p>
                <p><span className="font-medium">Platform:</span> macOS</p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
