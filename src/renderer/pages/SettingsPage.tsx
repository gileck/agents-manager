import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@template/renderer/components/ui/card';
import { Label } from '@template/renderer/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@template/renderer/components/ui/select';
import { Switch } from '@template/renderer/components/ui/switch';
import { useTheme } from '@template/renderer/hooks/useTheme';
import type { AppSettings } from '../../shared/types';

export function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [version, setVersion] = useState('');

  useEffect(() => {
    window.api.settings.get().then(setSettings);
    window.api.app.getVersion().then(setVersion);
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
        <h1 className="text-3xl font-bold mb-6">Settings</h1>

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
                  <Select value={theme} onValueChange={(value: any) => handleThemeChange(value)}>
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
