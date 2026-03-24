import React, { useState } from 'react';
import type { EffectiveAgentConfig } from '../../../shared/types';
import { Badge } from '../ui/badge';

interface AgentEffectiveConfigPanelProps {
  config: EffectiveAgentConfig;
}

/** Badge showing the source of a config field. */
function SourceBadge({ source }: { source: 'file' | 'default' }) {
  if (source === 'file') {
    return <Badge variant="default" className="text-xs ml-2">File</Badge>;
  }
  return <Badge variant="outline" className="text-xs ml-2">Default</Badge>;
}

/** Truncated prompt preview with expand button. */
function PromptPreview({ prompt }: { prompt: string }) {
  const [expanded, setExpanded] = useState(false);
  const lines = prompt.split('\n');
  const shouldTruncate = lines.length > 10;
  const displayText = expanded || !shouldTruncate
    ? prompt
    : lines.slice(0, 10).join('\n') + '\n...';

  return (
    <div>
      <pre className="text-xs bg-muted p-3 rounded-md overflow-auto max-h-96 whitespace-pre-wrap font-mono">
        {displayText}
      </pre>
      {shouldTruncate && (
        <button
          type="button"
          className="text-xs text-primary hover:underline mt-1"
          onClick={() => setExpanded(!expanded)}
        >
          {expanded ? 'Show less' : `Show full prompt (${lines.length} lines)`}
        </button>
      )}
    </div>
  );
}

export function AgentEffectiveConfigPanel({ config }: AgentEffectiveConfigPanelProps) {
  const { prompt, promptSource, config: cfg, configSources } = config;

  return (
    <div className="space-y-4 max-w-4xl">
      {/* Prompt Section */}
      <div>
        <div className="flex items-center mb-2">
          <span className="text-sm font-medium">Prompt</span>
          <SourceBadge source={promptSource} />
        </div>
        <PromptPreview prompt={prompt} />
      </div>

      {/* Config Fields */}
      <div>
        <span className="text-sm font-medium mb-2 block">Configuration</span>
        <div className="grid grid-cols-2 gap-2 text-sm">
          {cfg.maxTurns !== undefined && (
            <div className="flex items-center">
              <span className="text-muted-foreground">maxTurns:</span>
              <span className="ml-1 font-mono">{cfg.maxTurns}</span>
              <SourceBadge source={configSources.maxTurns || 'default'} />
            </div>
          )}
          {cfg.timeout !== undefined && (
            <div className="flex items-center">
              <span className="text-muted-foreground">timeout:</span>
              <span className="ml-1 font-mono">{cfg.timeout}ms</span>
              <SourceBadge source={configSources.timeout || 'default'} />
            </div>
          )}
          {cfg.readOnly !== undefined && (
            <div className="flex items-center">
              <span className="text-muted-foreground">readOnly:</span>
              <span className="ml-1 font-mono">{String(cfg.readOnly)}</span>
              <SourceBadge source={configSources.readOnly || 'default'} />
            </div>
          )}
          {cfg.engine && (
            <div className="flex items-center">
              <span className="text-muted-foreground">engine:</span>
              <span className="ml-1 font-mono">{cfg.engine}</span>
              <SourceBadge source={configSources.engine || 'default'} />
            </div>
          )}
          {cfg.model && (
            <div className="flex items-center">
              <span className="text-muted-foreground">model:</span>
              <span className="ml-1 font-mono">{cfg.model}</span>
              <SourceBadge source={configSources.model || 'default'} />
            </div>
          )}
          {cfg.disallowedTools && cfg.disallowedTools.length > 0 && (
            <div className="flex items-center col-span-2">
              <span className="text-muted-foreground">disallowedTools:</span>
              <span className="ml-1 font-mono">{cfg.disallowedTools.join(', ')}</span>
              <SourceBadge source={configSources.disallowedTools || 'default'} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
