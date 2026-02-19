import React, { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { ColorPicker } from '../components/ColorPicker';
import { useThemeConfig } from '../hooks/useThemeConfig';
import { THEME_PRESETS, COLOR_GROUPS, COLOR_LABELS } from '../theme-presets';
import { hslStringToHex } from '../utils/color-utils';
import type { ThemeColors } from '../../shared/types';
import { Check, RotateCcw, Palette } from 'lucide-react';

const RADIUS_OPTIONS = ['0rem', '0.25rem', '0.5rem', '0.75rem', '1rem'];

export function ThemePage() {
  const {
    themeConfig,
    applyPreset,
    resetTheme,
    updateColor,
    updateRadius,
  } = useThemeConfig();

  const [colorMode, setColorMode] = useState<'light' | 'dark'>('light');

  const currentColors = colorMode === 'light' ? themeConfig.colors : themeConfig.darkColors;

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-6xl mx-auto p-6 space-y-8">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold flex items-center gap-2">
              <Palette className="h-6 w-6" />
              Theme
            </h1>
            <p className="text-muted-foreground mt-1">
              Customize the appearance of the application. Changes apply immediately.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant="outline">{themeConfig.name}</Badge>
            <Button variant="outline" size="sm" onClick={resetTheme}>
              <RotateCcw className="h-4 w-4 mr-1" />
              Reset to Default
            </Button>
          </div>
        </div>

        {/* Preset Themes */}
        <Card>
          <CardHeader>
            <CardTitle>Preset Themes</CardTitle>
            <CardDescription>
              Choose a preset theme as a starting point. You can further customize colors below.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {THEME_PRESETS.map((preset) => {
                const isActive = themeConfig.name === preset.name;
                return (
                  <button
                    key={preset.name}
                    onClick={() => applyPreset(preset.name)}
                    className={`relative rounded-lg border-2 p-3 transition-all hover:shadow-md ${
                      isActive
                        ? 'border-primary shadow-md'
                        : 'border-border hover:border-primary/50'
                    }`}
                  >
                    {isActive && (
                      <div className="absolute top-1.5 right-1.5">
                        <Check className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    {/* Color swatches */}
                    <div className="flex gap-1 mb-2">
                      <div
                        className="w-6 h-6 rounded-full border border-border/50"
                        style={{ backgroundColor: `hsl(${preset.colors.primary})` }}
                        title="Primary"
                      />
                      <div
                        className="w-6 h-6 rounded-full border border-border/50"
                        style={{ backgroundColor: `hsl(${preset.colors.secondary})` }}
                        title="Secondary"
                      />
                      <div
                        className="w-6 h-6 rounded-full border border-border/50"
                        style={{ backgroundColor: `hsl(${preset.colors.accent})` }}
                        title="Accent"
                      />
                      <div
                        className="w-6 h-6 rounded-full border border-border/50"
                        style={{ backgroundColor: `hsl(${preset.colors.background})` }}
                        title="Background"
                      />
                    </div>
                    <span className="text-xs font-medium">{preset.name}</span>
                  </button>
                );
              })}
            </div>
          </CardContent>
        </Card>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Color Customization */}
          <div className="lg:col-span-2 space-y-4">
            <Card>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle>Colors</CardTitle>
                    <CardDescription>
                      Fine-tune individual colors. Use the color picker or enter HSL values directly.
                    </CardDescription>
                  </div>
                  <Tabs value={colorMode} onValueChange={(v) => setColorMode(v as 'light' | 'dark')}>
                    <TabsList>
                      <TabsTrigger value="light">Light</TabsTrigger>
                      <TabsTrigger value="dark">Dark</TabsTrigger>
                    </TabsList>
                  </Tabs>
                </div>
              </CardHeader>
              <CardContent className="space-y-6">
                {COLOR_GROUPS.map((group) => (
                  <div key={group.label}>
                    <h4 className="text-sm font-semibold text-foreground mb-2 border-b border-border pb-1">
                      {group.label}
                    </h4>
                    <div className="space-y-0.5">
                      {group.keys.map((key) => (
                        <ColorPicker
                          key={key}
                          label={COLOR_LABELS[key]}
                          value={currentColors[key]}
                          onChange={(value) => updateColor(key, value, colorMode)}
                        />
                      ))}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            {/* Border Radius */}
            <Card>
              <CardHeader>
                <CardTitle>Border Radius</CardTitle>
                <CardDescription>
                  Adjust the roundness of UI elements.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center gap-2">
                  {RADIUS_OPTIONS.map((r) => (
                    <button
                      key={r}
                      onClick={() => updateRadius(r)}
                      className={`flex items-center justify-center px-3 py-2 rounded-md border text-sm transition-colors ${
                        themeConfig.radius === r
                          ? 'border-primary bg-primary text-primary-foreground'
                          : 'border-border hover:border-primary/50 hover:bg-muted'
                      }`}
                    >
                      {r}
                    </button>
                  ))}
                </div>
                {/* Radius preview */}
                <div className="mt-4 flex items-center gap-4">
                  <div
                    className="w-20 h-12 bg-primary"
                    style={{ borderRadius: themeConfig.radius }}
                  />
                  <div
                    className="border-2 border-primary w-20 h-12"
                    style={{ borderRadius: themeConfig.radius }}
                  />
                  <span className="text-sm text-muted-foreground">
                    Current: {themeConfig.radius}
                  </span>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Live Preview Panel */}
          <div className="space-y-4">
            <Card>
              <CardHeader>
                <CardTitle>Live Preview</CardTitle>
                <CardDescription>
                  See how your theme looks on common UI elements.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Buttons */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Buttons</h4>
                  <div className="flex flex-wrap gap-2">
                    <Button size="sm">Primary</Button>
                    <Button size="sm" variant="secondary">Secondary</Button>
                    <Button size="sm" variant="destructive">Destructive</Button>
                    <Button size="sm" variant="outline">Outline</Button>
                    <Button size="sm" variant="ghost">Ghost</Button>
                    <Button size="sm" variant="success">Success</Button>
                  </div>
                </div>

                {/* Badges */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Badges</h4>
                  <div className="flex flex-wrap gap-2">
                    <Badge>Default</Badge>
                    <Badge variant="secondary">Secondary</Badge>
                    <Badge variant="destructive">Destructive</Badge>
                    <Badge variant="outline">Outline</Badge>
                    <Badge variant="success">Success</Badge>
                    <Badge variant="warning">Warning</Badge>
                  </div>
                </div>

                {/* Card preview */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Card</h4>
                  <Card>
                    <CardHeader className="p-4 pb-2">
                      <CardTitle className="text-sm">Sample Card</CardTitle>
                      <CardDescription className="text-xs">
                        A preview of card styling.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-0">
                      <p className="text-xs text-foreground">
                        This is content inside a card component with your current theme applied.
                      </p>
                    </CardContent>
                  </Card>
                </div>

                {/* Input */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">Input</h4>
                  <Input placeholder="Type something..." className="text-sm" />
                </div>

                {/* Color Swatches */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Color Palette
                  </h4>
                  <div className="grid grid-cols-4 gap-1.5">
                    {(['primary', 'secondary', 'accent', 'muted', 'destructive', 'success', 'warning', 'background'] as (keyof ThemeColors)[]).map((key) => (
                      <div key={key} className="text-center">
                        <div
                          className="w-full h-8 rounded border border-border/50"
                          style={{ backgroundColor: `hsl(${currentColors[key]})` }}
                        />
                        <span className="text-[9px] text-muted-foreground capitalize mt-0.5 block">
                          {key}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Text samples */}
                <div>
                  <h4 className="text-xs font-semibold text-muted-foreground uppercase mb-2">
                    Typography
                  </h4>
                  <div className="space-y-1">
                    <p className="text-sm text-foreground font-semibold">Foreground text</p>
                    <p className="text-sm text-muted-foreground">Muted foreground text</p>
                    <p className="text-sm text-primary">Primary text</p>
                    <p className="text-sm text-destructive">Destructive text</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
