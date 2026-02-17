import React, { useState, useEffect } from 'react';
import { Card, CardContent } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Badge } from '../components/ui/badge';
import { usePipelines } from '../hooks/usePipelines';
import type { Pipeline, AppSettings } from '../../shared/types';

export function PipelinesPage() {
  const { pipelines, loading, error } = usePipelines();
  const [defaultPipelineId, setDefaultPipelineId] = useState<string | null>(null);
  const [settingDefault, setSettingDefault] = useState(false);

  useEffect(() => {
    window.api.settings.get().then((s: AppSettings) => {
      setDefaultPipelineId(s.defaultPipelineId);
    });
  }, []);

  const handleSetDefault = async (pipelineId: string) => {
    setSettingDefault(true);
    try {
      const updated = await window.api.settings.update({ defaultPipelineId: pipelineId });
      setDefaultPipelineId(updated.defaultPipelineId);
    } finally {
      setSettingDefault(false);
    }
  };

  if (loading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Loading pipelines...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-8">
        <p className="text-destructive">Error: {error}</p>
      </div>
    );
  }

  return (
    <div className="p-8">
      <h1 className="text-3xl font-bold mb-6">Pipelines</h1>

      {pipelines.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No pipelines found.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {pipelines.map((pipeline) => (
            <PipelineCard
              key={pipeline.id}
              pipeline={pipeline}
              isDefault={pipeline.id === defaultPipelineId}
              onSetDefault={() => handleSetDefault(pipeline.id)}
              settingDefault={settingDefault}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function PipelineCard({ pipeline, isDefault, onSetDefault, settingDefault }: {
  pipeline: Pipeline;
  isDefault: boolean;
  onSetDefault: () => void;
  settingDefault: boolean;
}) {
  // Build ordered status list from transitions
  const statusOrder = buildStatusOrder(pipeline);

  // Find transitions that skip statuses or go backwards
  const forwardTransitions: Array<{ from: string; to: string; label: string }> = [];
  const specialTransitions: Array<{ from: string; to: string; label: string }> = [];

  for (const t of pipeline.transitions) {
    const fromIdx = statusOrder.indexOf(t.from);
    const toIdx = statusOrder.indexOf(t.to);
    if (fromIdx === -1 || toIdx === -1) continue;

    if (toIdx === fromIdx + 1) {
      // Direct forward transition — shown as arrow
      forwardTransitions.push({ from: t.from, to: t.to, label: t.label || '' });
    } else {
      // Skip or backwards
      specialTransitions.push({
        from: t.from,
        to: t.to,
        label: t.label || `${t.from} -> ${t.to}`,
      });
    }
  }

  return (
    <Card>
      <CardContent className="py-5">
        <div className="flex items-start justify-between mb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="text-lg font-semibold">{pipeline.name}</span>
              <Badge variant="outline" className="text-xs">{pipeline.taskType}</Badge>
              {isDefault && (
                <Badge variant="default" className="text-xs">Default</Badge>
              )}
            </div>
            {pipeline.description && (
              <p className="text-sm text-muted-foreground mt-1">{pipeline.description}</p>
            )}
          </div>
          {!isDefault && (
            <Button
              variant="outline"
              size="sm"
              onClick={onSetDefault}
              disabled={settingDefault}
            >
              Set as Default
            </Button>
          )}
        </div>

        {/* Pipeline flow visualization */}
        <div className="mt-3">
          <div className="flex items-center gap-1 flex-wrap">
            {statusOrder.map((statusName, i) => {
              const statusDef = pipeline.statuses.find((s) => s.name === statusName);
              const color = statusDef?.color || '#6b7280';
              const label = statusDef?.label || statusName;
              return (
                <React.Fragment key={statusName}>
                  <div
                    className="inline-flex items-center px-3 py-1.5 rounded-full text-xs font-medium text-white shrink-0"
                    style={{ backgroundColor: color }}
                  >
                    {label}
                  </div>
                  {i < statusOrder.length - 1 && (
                    <span className="text-muted-foreground text-lg shrink-0 mx-0.5">&rarr;</span>
                  )}
                </React.Fragment>
              );
            })}
          </div>

          {/* Special transitions (backwards / skip) */}
          {specialTransitions.length > 0 && (
            <div className="flex flex-wrap gap-2 mt-2 ml-1">
              {specialTransitions.map((t, i) => {
                const fromDef = pipeline.statuses.find((s) => s.name === t.from);
                const toDef = pipeline.statuses.find((s) => s.name === t.to);
                return (
                  <span key={i} className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded">
                    {fromDef?.label || t.from} &rarr; {toDef?.label || t.to}
                    {t.label && ` (${t.label})`}
                  </span>
                );
              })}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

/** Build a linear status order by following transitions from the initial status. */
function buildStatusOrder(pipeline: Pipeline): string[] {
  if (pipeline.statuses.length === 0) return [];

  // Find all "to" targets so we can identify the starting status (not a target of any transition)
  const toSet = new Set(pipeline.transitions.map((t) => t.to));
  let start = pipeline.statuses.find((s) => !toSet.has(s.name));
  if (!start) start = pipeline.statuses[0];

  const ordered: string[] = [start.name];
  const visited = new Set([start.name]);

  // Greedily follow forward transitions
  let current = start.name;
  while (true) {
    const next = pipeline.transitions.find(
      (t) => t.from === current && !visited.has(t.to)
    );
    if (!next) break;
    ordered.push(next.to);
    visited.add(next.to);
    current = next.to;
  }

  // Append any statuses not yet included
  for (const s of pipeline.statuses) {
    if (!visited.has(s.name)) {
      ordered.push(s.name);
    }
  }

  return ordered;
}
