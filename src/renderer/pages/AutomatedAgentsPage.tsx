import React, { useState } from 'react';
import { Plus } from 'lucide-react';
import { toast } from 'sonner';
import { reportError } from '../lib/error-handler';
import { InlineError } from '../components/InlineError';
import { useCurrentProject } from '../contexts/CurrentProjectContext';
import { useAutomatedAgents } from '../hooks/useAutomatedAgents';
import { AutomatedAgentCard } from '../components/automated-agents/AutomatedAgentCard';
import { AutomatedAgentDialog } from '../components/automated-agents/AutomatedAgentDialog';
import type { AutomatedAgent } from '../../shared/types';

export function AutomatedAgentsPage() {
  const { currentProjectId } = useCurrentProject();
  const { agents, loading, error, refetch } = useAutomatedAgents(currentProjectId ?? undefined);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAgent, setEditingAgent] = useState<AutomatedAgent | null>(null);

  const handleCreate = () => {
    setEditingAgent(null);
    setDialogOpen(true);
  };

  const handleEdit = (agent: AutomatedAgent) => {
    setEditingAgent(agent);
    setDialogOpen(true);
  };

  const handleDelete = async (agent: AutomatedAgent) => {
    if (!confirm(`Delete agent "${agent.name}"?`)) return;
    try {
      await window.api.automatedAgents.delete(agent.id);
      toast.success('Agent deleted');
      refetch();
    } catch (err) {
      reportError(err, 'Delete automated agent');
    }
  };

  if (!currentProjectId) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">Select a project to manage automated agents.</p>
      </div>
    );
  }

  if (error) {
    return <div className="p-8"><InlineError message={error} context="Automated Agents" /></div>;
  }

  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold">Automated Agents</h1>
          <p className="text-xs text-muted-foreground mt-1">
            Project-scoped agents that run on a schedule or manually
          </p>
        </div>
        <button
          onClick={handleCreate}
          className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:opacity-90 transition-opacity"
        >
          <Plus className="h-4 w-4" />
          New Agent
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Loading...</p>
      ) : agents.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-muted-foreground mb-3">No automated agents yet</p>
          <button
            onClick={handleCreate}
            className="text-sm text-primary hover:underline"
          >
            Create your first automated agent
          </button>
        </div>
      ) : (
        <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))' }}>
          {agents.map(agent => (
            <AutomatedAgentCard
              key={agent.id}
              agent={agent}
              onEdit={handleEdit}
              onDelete={handleDelete}
              onRefresh={refetch}
            />
          ))}
        </div>
      )}

      {dialogOpen && (
        <AutomatedAgentDialog
          projectId={currentProjectId}
          agent={editingAgent}
          onClose={() => setDialogOpen(false)}
          onSaved={refetch}
        />
      )}
    </div>
  );
}
