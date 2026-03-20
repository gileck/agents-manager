import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Label } from '../components/ui/label';
import { Switch } from '../components/ui/switch';
import { Input } from '../components/ui/input';
import { reportError } from '../lib/error-handler';
import { useTabsContext } from '../contexts/TabsContext';
import type { AppSettings } from '../../shared/types';

export function SettingsTabsPage() {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const { setConfig } = useTabsContext();

  useEffect(() => {
    window.api.settings.get().then(setSettings).catch((err) => reportError(err, 'Load settings'));
  }, []);

  const handleToggle = async (enabled: boolean) => {
    try {
      const updated = await window.api.settings.update({ tabsEnabled: enabled });
      setSettings(updated);
      setConfig({ enabled });
    } catch (err) {
      reportError(err, 'Update tabs enabled');
    }
  };

  const handleMaxTabsChange = async (value: string) => {
    const num = parseInt(value, 10);
    if (isNaN(num) || num < 2 || num > 20) return;
    try {
      const updated = await window.api.settings.update({ tabsMaxOpen: num });
      setSettings(updated);
      setConfig({ maxOpenTabs: num });
    } catch (err) {
      reportError(err, 'Update max tabs');
    }
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
              <CardTitle>Page Tabs</CardTitle>
              <CardDescription>
                Navigate between open pages like browser tabs. Each page you visit creates a tab
                that you can quickly switch back to.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <Label htmlFor="tabs-enabled">Enable page tabs</Label>
                <Switch
                  id="tabs-enabled"
                  checked={settings.tabsEnabled}
                  onCheckedChange={handleToggle}
                />
              </div>

              <div className="flex items-center justify-between">
                <div>
                  <Label htmlFor="max-tabs">Maximum open tabs</Label>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    When exceeded, the least recently used tab is closed. (2–20)
                  </p>
                </div>
                <Input
                  id="max-tabs"
                  type="number"
                  min={2}
                  max={20}
                  value={settings.tabsMaxOpen}
                  onChange={(e) => handleMaxTabsChange(e.target.value)}
                  className="w-20"
                  disabled={!settings.tabsEnabled}
                />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
