import React from 'react';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { RotateCcw, AlertTriangle } from 'lucide-react';
import { SHORTCUT_REGISTRY, ShortcutContext, normalizeCombo } from '../lib/keyboardShortcuts';
import { useKeyboardShortcutsConfig } from '../hooks/useKeyboardShortcutsConfig';
import { KeyRecorder } from '../components/KeyRecorder';

const CONTEXT_LABELS: Record<ShortcutContext, string> = {
  chat: 'Chat',
  kanban: 'Kanban',
};

const CONTEXTS: ShortcutContext[] = ['chat', 'kanban'];

export function KeyboardShortcutsPage() {
  const { getCombo, setCombo, resetCombo, resetAll, hasConflict } = useKeyboardShortcutsConfig();

  return (
    <div className="h-full overflow-auto">
      <div className="max-w-2xl mx-auto p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Keyboard Shortcuts</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              Click a shortcut to rebind it. Press Escape to cancel recording.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={resetAll}>
            <RotateCcw className="h-4 w-4 mr-1" />
            Reset All
          </Button>
        </div>

        {CONTEXTS.map(context => {
          const shortcuts = SHORTCUT_REGISTRY.filter(s => s.context === context);
          return (
            <Card key={context}>
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{CONTEXT_LABELS[context]}</CardTitle>
                <CardDescription>
                  Shortcuts available in the {CONTEXT_LABELS[context].toLowerCase()} view.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1">
                {shortcuts.map(shortcut => {
                  const currentCombo = getCombo(shortcut.id);
                  const conflictId = shortcut.notCustomizable
                    ? null
                    : hasConflict(currentCombo, shortcut.id);
                  const conflictDef = conflictId
                    ? SHORTCUT_REGISTRY.find(s => s.id === conflictId)
                    : null;
                  const isModified = !shortcut.notCustomizable &&
                    normalizeCombo(currentCombo) !== normalizeCombo(shortcut.defaultCombo);

                  return (
                    <div
                      key={shortcut.id}
                      className="flex items-center justify-between py-2 px-3 rounded-md hover:bg-muted/50 gap-4"
                    >
                      {/* Description */}
                      <div className="flex-1 min-w-0">
                        <span className="text-sm">{shortcut.description}</span>
                        {conflictDef && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <AlertTriangle className="h-3 w-3 text-yellow-500 shrink-0" />
                            <span className="text-xs text-yellow-600 dark:text-yellow-400">
                              Conflicts with &ldquo;{conflictDef.description}&rdquo;
                            </span>
                          </div>
                        )}
                      </div>

                      {/* Key binding */}
                      <div className="flex items-center gap-2 shrink-0">
                        {shortcut.notCustomizable ? (
                          <span className="inline-flex items-center justify-center min-w-[80px] px-2.5 py-1 rounded border border-border bg-muted text-sm font-mono text-muted-foreground">
                            {currentCombo === 'CmdOrCtrl+1–9'
                              ? (typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac') ? '⌘1–9' : 'Ctrl+1–9')
                              : currentCombo}
                          </span>
                        ) : (
                          <KeyRecorder
                            value={currentCombo}
                            hasConflict={!!conflictDef}
                            onCapture={(combo) => setCombo(shortcut.id, combo)}
                            onCancel={() => {/* no-op, state stays */}}
                          />
                        )}

                        {/* Per-shortcut reset button */}
                        {isModified && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 w-7 p-0"
                            title="Reset to default"
                            onClick={() => resetCombo(shortcut.id)}
                          >
                            <RotateCcw className="h-3.5 w-3.5" />
                          </Button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
