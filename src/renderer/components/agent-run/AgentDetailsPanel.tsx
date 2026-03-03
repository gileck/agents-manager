import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useIpc } from '@template/renderer/hooks/useIpc';
import type { AgentRun, AgentDefinition } from '../../../shared/types';

interface AgentDetailsPanelProps {
  run: AgentRun;
}

export function AgentDetailsPanel({ run }: AgentDetailsPanelProps) {
  const { data: agentDefinitions, loading: loadingDefinitions, error: definitionsError } = useIpc<AgentDefinition[]>(
    () => window.api.agentDefinitions.list(),
    []
  );

  const agentDefinition = agentDefinitions?.find(def => def.name === run.agentType);

  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);

  return (
    <div className="p-4 space-y-4">
      {/* Run Configuration */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Run Configuration</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm font-medium text-muted-foreground">Agent Type</p>
              <p className="text-sm">{run.agentType}</p>
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Mode</p>
              <p className="text-sm">{run.mode}</p>
            </div>
            {run.engine && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Engine</p>
                <p className="text-sm">{run.engine}</p>
              </div>
            )}
            {run.timeoutMs != null && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Timeout</p>
                <p className="text-sm">{Math.round(run.timeoutMs / 60000)} minutes</p>
              </div>
            )}
            {run.maxTurns != null && (
              <div>
                <p className="text-sm font-medium text-muted-foreground">Max Turns</p>
                <p className="text-sm">{run.maxTurns}</p>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Agent Definition */}
      <Card>
        <CardHeader className="py-3">
          <CardTitle className="text-base">Agent Definition</CardTitle>
        </CardHeader>
        <CardContent className="py-2">
          {loadingDefinitions ? (
            <p className="text-sm text-muted-foreground">Loading agent details...</p>
          ) : definitionsError ? (
            <p className="text-sm text-muted-foreground">Error loading agent details</p>
          ) : !agentDefinition ? (
            <div className="text-sm text-muted-foreground">
              <p>Agent type: {run.agentType}</p>
              <p className="mt-1">Agent definition not found</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Name</p>
                  <p className="text-sm">{agentDefinition.name}</p>
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Engine</p>
                  <p className="text-sm">{agentDefinition.engine}</p>
                </div>
                {agentDefinition.model && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Model</p>
                    <p className="text-sm">{agentDefinition.model}</p>
                  </div>
                )}
                {agentDefinition.timeout && (
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Default Timeout</p>
                    <p className="text-sm">{Math.round(agentDefinition.timeout / 60000)} minutes</p>
                  </div>
                )}
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Built-in</p>
                  <p className="text-sm">{agentDefinition.isBuiltIn ? 'Yes' : 'No'}</p>
                </div>
              </div>

              {agentDefinition.description && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground">Description</p>
                  <p className="text-sm">{agentDefinition.description}</p>
                </div>
              )}

              {agentDefinition.systemPrompt && (
                <div>
                  <button
                    className="flex items-center gap-1 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
                    onClick={() => setSystemPromptExpanded(!systemPromptExpanded)}
                  >
                    {systemPromptExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    System Prompt
                  </button>
                  {systemPromptExpanded && (
                    <pre className="mt-2 p-3 bg-muted rounded-md text-xs font-mono whitespace-pre-wrap overflow-x-auto">
                      {agentDefinition.systemPrompt}
                    </pre>
                  )}
                </div>
              )}

              {agentDefinition.modes.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Available Modes</p>
                  <div className="flex flex-wrap gap-1">
                    {agentDefinition.modes.map((mode) => (
                      <span
                        key={mode.mode}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground"
                      >
                        {mode.mode}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {agentDefinition.skills.length > 0 && (
                <div>
                  <p className="text-sm font-medium text-muted-foreground mb-1">Skills</p>
                  <div className="flex flex-wrap gap-1">
                    {agentDefinition.skills.map((skill) => (
                      <span
                        key={skill}
                        className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-secondary text-secondary-foreground"
                      >
                        {skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
