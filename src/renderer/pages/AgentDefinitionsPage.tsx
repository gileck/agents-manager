import React, { useState } from 'react';
import type { AgentDefinition, AgentDefinitionCreateInput, AgentDefinitionUpdateInput } from '../../shared/types';
import { useAgentDefinitions } from '../hooks/useAgentDefinitions';
import { AgentDefinitionCard } from '../components/agents/AgentDefinitionCard';
import { AgentDefinitionDialog } from '../components/agents/AgentDefinitionDialog';
import { Button } from '../components/ui/button';
import { Card, CardContent } from '../components/ui/card';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '../components/ui/dialog';

export function AgentDefinitionsPage() {
  const { definitions, loading, error, refetch } = useAgentDefinitions();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDef, setEditingDef] = useState<AgentDefinition | null>(null);
  const [deletingDef, setDeletingDef] = useState<AgentDefinition | null>(null);
  const [deleting, setDeleting] = useState(false);

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
    return <div className="p-8"><p className="text-destructive">Error: {error}</p></div>;
  }

  return (
    <div className="p-8">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-3xl font-bold">Agents</h1>
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
