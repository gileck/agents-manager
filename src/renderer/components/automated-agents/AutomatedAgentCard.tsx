import React, { useState } from 'react';
import { Play, Pencil, Trash2, ChevronDown, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { reportError } from '../../lib/error-handler';
import type { AutomatedAgent } from '../../../shared/types';
import { ScheduleDisplay } from './ScheduleDisplay';
import { AutomatedAgentRunHistory } from './AutomatedAgentRunHistory';

interface AutomatedAgentCardProps {
  agent: AutomatedAgent;
  onEdit: (agent: AutomatedAgent) => void;
  onDelete: (agent: AutomatedAgent) => void;
  onRefresh: () => void;
}

export function AutomatedAgentCard({ agent, onEdit, onDelete, onRefresh }: AutomatedAgentCardProps) {
  const [triggering, setTriggering] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [toggling, setToggling] = useState(false);

  const handleTrigger = async () => {
    setTriggering(true);
    try {
      await window.api.automatedAgents.trigger(agent.id);
      toast.success(`Agent "${agent.name}" triggered`);
      onRefresh();
    } catch (err) {
      reportError(err, 'Trigger automated agent');
    } finally {
      setTriggering(false);
    }
  };

  const handleToggleEnabled = async () => {
    setToggling(true);
    try {
      await window.api.automatedAgents.update(agent.id, { enabled: !agent.enabled });
      onRefresh();
    } catch (err) {
      reportError(err, 'Toggle automated agent');
    } finally {
      setToggling(false);
    }
  };

  return (
    <div className="border border-border rounded-lg p-4 bg-card">
      {/* Header */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="font-medium text-sm truncate">{agent.name}</h3>
            {agent.templateId && (
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{agent.templateId}</span>
            )}
          </div>
          {agent.description && (
            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{agent.description}</p>
          )}
        </div>
        <button
          onClick={handleToggleEnabled}
          disabled={toggling}
          className={`ml-2 relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${
            agent.enabled ? 'bg-primary' : 'bg-muted'
          }`}
          title={agent.enabled ? 'Disable' : 'Enable'}
        >
          <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white transition-transform ${
            agent.enabled ? 'translate-x-4' : 'translate-x-1'
          }`} />
        </button>
      </div>

      {/* Schedule & status */}
      <div className="flex items-center gap-3 mb-3 text-xs">
        <ScheduleDisplay schedule={agent.schedule} />
        {agent.lastRunAt && (
          <span className={`flex items-center gap-1 ${
            agent.lastRunStatus === 'completed' ? 'text-green-600' :
            agent.lastRunStatus === 'failed' ? 'text-red-600' :
            'text-muted-foreground'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              agent.lastRunStatus === 'completed' ? 'bg-green-500' :
              agent.lastRunStatus === 'failed' ? 'bg-red-500' :
              'bg-gray-400'
            }`} />
            Last: {new Date(agent.lastRunAt).toLocaleString()}
          </span>
        )}
        {agent.nextRunAt && agent.enabled && (
          <span className="text-muted-foreground">
            Next: {new Date(agent.nextRunAt).toLocaleString()}
          </span>
        )}
      </div>

      {/* Capabilities badges */}
      <div className="flex flex-wrap gap-1 mb-3">
        {agent.capabilities.readOnly && <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 dark:bg-blue-900 dark:text-blue-300">Read-only</span>}
        {agent.capabilities.canCreateTasks && <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-100 text-green-700 dark:bg-green-900 dark:text-green-300">Create tasks</span>}
        {agent.capabilities.canModifyTasks && <span className="text-[10px] px-1.5 py-0.5 rounded bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300">Modify tasks</span>}
        {agent.capabilities.dryRun && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300">Dry run</span>}
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            onClick={handleTrigger}
            disabled={triggering}
            className="flex items-center gap-1 px-2 py-1 text-xs rounded bg-primary text-primary-foreground hover:opacity-90 disabled:opacity-50 transition-opacity"
          >
            <Play className="h-3 w-3" />
            {triggering ? 'Running...' : 'Run Now'}
          </button>
          <button
            onClick={() => onEdit(agent)}
            className="p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground transition-colors"
            title="Edit"
          >
            <Pencil className="h-3.5 w-3.5" />
          </button>
          <button
            onClick={() => onDelete(agent)}
            className="p-1 rounded hover:bg-muted text-red-500 hover:text-red-600 transition-colors"
            title="Delete"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          onClick={() => setShowHistory(!showHistory)}
          className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
          History
        </button>
      </div>

      {/* Expandable run history */}
      {showHistory && (
        <div className="mt-3 border-t border-border pt-2">
          <AutomatedAgentRunHistory agentId={agent.id} />
        </div>
      )}
    </div>
  );
}
