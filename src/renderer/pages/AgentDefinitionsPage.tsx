import React, { useState, useEffect } from 'react';
import type { AgentDefinition, AgentDefinitionCreateInput, AgentDefinitionUpdateInput, Project, EffectiveAgentConfig } from '../../shared/types';
import { useAgentDefinitions } from '../hooks/useAgentDefinitions';
import { useProjects } from '../hooks/useProjects';
import { AgentDefinitionCard } from '../components/agents/AgentDefinitionCard';
import { AgentDefinitionDialog } from '../components/agents/AgentDefinitionDialog';
import { AgentEffectiveConfigPanel } from '../components/agents/AgentEffectiveConfigPanel';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { InlineError } from '../components/InlineError';
import { Badge } from '../components/ui/badge';
import { Select, SelectTrigger, SelectContent, SelectItem, SelectValue } from '../components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';
import { reportError } from '../lib/error-handler';

export function AgentDefinitionsPage() {
  const { definitions, loading, error, refetch } = useAgentDefinitions();
  const { projects } = useProjects();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<AgentDefinition | null>(null);
  const [deletingDef, setDeletingDef] = useState<AgentDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Project selector state
  const [selectedProjectId, setSelectedProjectId] = useState<string>('');

  // Agent types from file-based config system
  const [agentTypes, setAgentTypes] = useState<string[]>([]);
  const [expandedType, setExpandedType] = useState<string | null>(null);
  const [effectiveConfigs, setEffectiveConfigs] = useState<Record<string, EffectiveAgentConfig>>({});
  const [loadingConfig, setLoadingConfig] = useState<string | null>(null);
  const [actionInProgress, setActionInProgress] = useState<string | null>(null);

  // Auto-select first project
  useEffect(() => {
    if (projects.length > 0 && !selectedProjectId) {
      setSelectedProjectId(projects[0].id);
    }
  }, [projects, selectedProjectId]);

  // Load agent types
  useEffect(() => {
    window.api.agentDefinitions.listTypes()
      .then(setAgentTypes)
      .catch((err) => reportError(err, 'Load agent types'));
  }, []);

  const selectedProject = projects.find((p: Project) => p.id === selectedProjectId);

  // Load effective config when expanding an agent type
  const handleToggleExpand = async (agentType: string) => {
    if (expandedType === agentType) {
      setExpandedType(null);
      return;
    }
    setExpandedType(agentType);
    if (!selectedProjectId) return;

    // Load effective config if not cached
    if (!effectiveConfigs[agentType]) {
      setLoadingConfig(agentType);
      try {
        const config = await window.api.agentDefinitions.getEffective(agentType, selectedProjectId);
        setEffectiveConfigs((prev) => ({ ...prev, [agentType]: config }));
      } catch (err) {
        reportError(err, `Load effective config for ${agentType}`);
      } finally {
        setLoadingConfig(null);
      }
    }
  };

  // Reload configs when project changes
  useEffect(() => {
    setEffectiveConfigs({});
    setExpandedType(null);
  }, [selectedProjectId]);

  const handleInitFiles = async (agentType: string) => {
    if (!selectedProjectId) return;
    setActionInProgress(agentType);
    try {
      await window.api.agentDefinitions.initFiles(agentType, selectedProjectId);
      // Reload effective config for this type
      const config = await window.api.agentDefinitions.getEffective(agentType, selectedProjectId);
      setEffectiveConfigs((prev) => ({ ...prev, [agentType]: config }));
    } catch (err) {
      reportError(err, `Initialize files for ${agentType}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleDeleteFiles = async (agentType: string) => {
    if (!selectedProjectId) return;
    setActionInProgress(agentType);
    try {
      await window.api.agentDefinitions.deleteFiles(agentType, selectedProjectId);
      // Reload effective config for this type
      const config = await window.api.agentDefinitions.getEffective(agentType, selectedProjectId);
      setEffectiveConfigs((prev) => ({ ...prev, [agentType]: config }));
    } catch (err) {
      reportError(err, `Reset files for ${agentType}`);
    } finally {
      setActionInProgress(null);
    }
  };

  const handleCopyPath = (agentType: string) => {
    if (!selectedProject?.path) return;
    const path = `${selectedProject.path}/.agents/${agentType}/prompt.md`;
    navigator.clipboard.writeText(path).catch((err) => reportError(err, 'Copy path'));
  };

  const handleEdit = (def: AgentDefinition) => {
    setEditingDef(def);
    setDialogOpen(true);
  };

  const handleNew = () => {
    setEditingDef(null);
    setDialogOpen(true);
  };

  const handleSave = async (input: AgentDefinitionCreateInput | AgentDefinitionUpdateInput, id?: string) => {
    if (id) {
      await window.api.agentDefinitions.update(id, input as AgentDefinitionUpdateInput);
    } else {
      await window.api.agentDefinitions.create(input as AgentDefinitionCreateInput);
    }
    await refetch();
  };

  const handleDelete = async () => {
    if (!deletingDef) return;
    setDeleting(true);
    try {
      await window.api.agentDefinitions.delete(deletingDef.id);
      setDeletingDef(null);
      await refetch();
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return <div className="p-8"><p className="text-muted-foreground">Loading...</p></div>;
  }

  if (error) {
    return <div className="p-8"><InlineError message={error} context="Agent definitions" /></div>;
  }

  return (
    <div className="p-8">
      {/* Project selector */}
      {projects.length > 0 && (
        <div className="flex items-center gap-3 mb-6">
          <span className="text-sm font-medium text-muted-foreground">Project:</span>
          <Select value={selectedProjectId} onValueChange={setSelectedProjectId}>
            <SelectTrigger className="w-64">
              <SelectValue placeholder="Select a project" />
            </SelectTrigger>
            <SelectContent>
              {projects.map((p: Project) => (
                <SelectItem key={p.id} value={p.id}>{p.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* File-based Agent Config Section */}
      {selectedProjectId && agentTypes.length > 0 && (
        <div className="mb-8">
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            File-based Agent Config (.agents/)
          </h3>
          <div className="space-y-2">
            {agentTypes.map((agentType) => {
              const effectiveConfig = effectiveConfigs[agentType];
              const isExpanded = expandedType === agentType;
              const isLoading = loadingConfig === agentType;
              const isActioning = actionInProgress === agentType;
              const hasFileConfig = effectiveConfig?.hasFileConfig ?? false;

              return (
                <Card key={agentType} className="transition-colors">
                  <CardContent className="py-3">
                    <div className="flex items-center justify-between">
                      <button
                        type="button"
                        className="flex items-center gap-2 text-left flex-1 min-w-0"
                        onClick={() => handleToggleExpand(agentType)}
                      >
                        <span className="text-xs text-muted-foreground">{isExpanded ? '▼' : '▶'}</span>
                        <span className="font-medium">{agentType}</span>
                        {hasFileConfig && (
                          <Badge variant="default" className="text-xs">File</Badge>
                        )}
                      </button>
                      <div className="flex items-center gap-1 ml-4 flex-shrink-0">
                        {hasFileConfig ? (
                          <>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleCopyPath(agentType)}
                              disabled={!selectedProject?.path}
                            >
                              Copy Path
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleDeleteFiles(agentType)}
                              disabled={isActioning}
                            >
                              {isActioning ? 'Resetting...' : 'Reset to Default'}
                            </Button>
                          </>
                        ) : (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleInitFiles(agentType)}
                            disabled={isActioning}
                          >
                            {isActioning ? 'Initializing...' : 'Initialize from Default'}
                          </Button>
                        )}
                      </div>
                    </div>

                    {isExpanded && (
                      <div className="mt-4 pt-3 border-t">
                        {isLoading ? (
                          <p className="text-sm text-muted-foreground">Loading config...</p>
                        ) : effectiveConfig ? (
                          <AgentEffectiveConfigPanel config={effectiveConfig} />
                        ) : (
                          <p className="text-sm text-muted-foreground">
                            Select a project to view effective configuration.
                          </p>
                        )}
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      )}

      {/* DB Agent Definitions Section */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
          DB Agent Definitions
        </h3>
        <Button onClick={handleNew}>New Agent</Button>
      </div>

      {definitions.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center">
            <p className="text-muted-foreground">No agent definitions yet.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {definitions.map((def) => (
            <AgentDefinitionCard
              key={def.id}
              definition={def}
              onEdit={handleEdit}
              onDelete={setDeletingDef}
            />
          ))}
        </div>
      )}

      <AgentDefinitionDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        definition={editingDef}
        onSave={handleSave}
      />

      <Dialog open={!!deletingDef} onOpenChange={() => setDeletingDef(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Agent</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground py-4">
            Are you sure you want to delete <strong>{deletingDef?.name}</strong>? This action cannot be undone.
          </p>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletingDef(null)}>Cancel</Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? 'Deleting...' : 'Delete'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
