import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, MoreVertical, Loader2, Check } from 'lucide-react';
import { cn } from '@template/renderer/lib/utils';
import { ChatSession, RunningAgent } from '../../../shared/types';
import { Button } from '../ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { Input } from '../ui/input';
import { Label } from '../ui/label';

interface SessionTabsProps {
  sessions: ChatSession[];
  currentSessionId: string | null;
  activeAgents: RunningAgent[];
  onSessionChange: (sessionId: string) => void;
  onSessionCreate: (name: string) => void;
  onSessionRename: (sessionId: string, newName: string) => void;
  onSessionDelete: (sessionId: string) => void;
}

export function SessionTabs({
  sessions,
  currentSessionId,
  activeAgents,
  onSessionChange,
  onSessionCreate,
  onSessionRename,
  onSessionDelete,
}: SessionTabsProps) {
  const [newSessionDialogOpen, setNewSessionDialogOpen] = useState(false);
  const [newSessionName, setNewSessionName] = useState('');
  const [renameSessionId, setRenameSessionId] = useState<string | null>(null);
  const [renameSessionName, setRenameSessionName] = useState('');
  const [contextMenuSession, setContextMenuSession] = useState<string | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  // Close context menu when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenuSession(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleNewSession = () => {
    const defaultName = `Session ${sessions.length + 1}`;
    setNewSessionName(defaultName);
    setNewSessionDialogOpen(true);
  };

  const handleCreateSession = () => {
    if (newSessionName.trim()) {
      onSessionCreate(newSessionName.trim());
      setNewSessionDialogOpen(false);
      setNewSessionName('');
    }
  };

  const handleStartRename = (sessionId: string, currentName: string) => {
    setRenameSessionId(sessionId);
    setRenameSessionName(currentName);
    setContextMenuSession(null);
  };

  const handleRename = () => {
    if (renameSessionId && renameSessionName.trim()) {
      onSessionRename(renameSessionId, renameSessionName.trim());
      setRenameSessionId(null);
      setRenameSessionName('');
    }
  };

  const handleDelete = (sessionId: string) => {
    // Check if session has running agent
    const hasRunningAgent = activeAgents.some(
      agent => agent.sessionId === sessionId && agent.status === 'running'
    );

    if (hasRunningAgent) {
      if (!confirm('This session has a running agent. Are you sure you want to delete it?')) {
        return;
      }
    }

    onSessionDelete(sessionId);
    setContextMenuSession(null);
  };

  const getSessionAgentStatus = (sessionId: string) => {
    const sessionAgents = activeAgents.filter(agent => agent.sessionId === sessionId);
    const runningCount = sessionAgents.filter(agent => agent.status === 'running').length;
    const completedCount = sessionAgents.filter(agent => agent.status === 'completed').length;

    return { runningCount, completedCount, hasAgents: sessionAgents.length > 0 };
  };

  return (
    <div className="border-b border-border bg-card">
      <div className="flex items-center gap-1 px-4 py-1 overflow-x-auto scrollbar-thin">
        {sessions.map((session) => {
          const { runningCount, completedCount } = getSessionAgentStatus(session.id);
          const isActive = session.id === currentSessionId;

          return (
            <div
              key={session.id}
              className={cn(
                'relative group flex items-center gap-2 px-3 py-1.5 rounded-t-lg cursor-pointer transition-colors',
                isActive
                  ? 'bg-background border-t border-l border-r border-border'
                  : 'hover:bg-muted/50'
              )}
              onClick={() => onSessionChange(session.id)}
            >
              <div className="flex items-center gap-2">
                {/* Running agent indicator */}
                {runningCount > 0 && (
                  <Loader2 className="h-3 w-3 animate-spin text-primary" />
                )}

                {/* Completed agent badge */}
                {completedCount > 0 && runningCount === 0 && (
                  <div className="flex items-center justify-center w-4 h-4 rounded-full bg-green-500 text-white">
                    <Check className="h-2.5 w-2.5" />
                  </div>
                )}

                {/* Session name */}
                {renameSessionId === session.id ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      handleRename();
                    }}
                    className="flex items-center gap-1"
                  >
                    <Input
                      value={renameSessionName}
                      onChange={(e) => setRenameSessionName(e.target.value)}
                      onBlur={handleRename}
                      className="h-6 px-2 py-1 text-sm"
                      autoFocus
                      onClick={(e) => e.stopPropagation()}
                    />
                  </form>
                ) : (
                  <span className="text-sm font-medium">{session.name}</span>
                )}

                {/* Agent count badge */}
                {(runningCount > 0 || completedCount > 0) && (
                  <span className="text-xs text-muted-foreground">
                    ({runningCount > 0 ? runningCount : completedCount})
                  </span>
                )}
              </div>

              {/* Close button */}
              {sessions.length > 1 && (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDelete(session.id);
                  }}
                  className={cn(
                    'ml-2 p-0.5 rounded hover:bg-muted transition-opacity',
                    'opacity-0 group-hover:opacity-100'
                  )}
                  title="Close session"
                >
                  <X className="h-3 w-3" />
                </button>
              )}

              {/* Context menu button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setContextMenuSession(session.id);
                }}
                className={cn(
                  'ml-1 p-0.5 rounded hover:bg-muted transition-opacity',
                  'opacity-0 group-hover:opacity-100'
                )}
                title="More options"
              >
                <MoreVertical className="h-3 w-3" />
              </button>

              {/* Context menu */}
              {contextMenuSession === session.id && (
                <div
                  ref={contextMenuRef}
                  className="absolute top-full left-0 mt-1 bg-card border border-border rounded-md shadow-lg z-50"
                  onClick={(e) => e.stopPropagation()}
                >
                  <button
                    onClick={() => handleStartRename(session.id, session.name)}
                    className="block w-full text-left px-3 py-1.5 text-sm hover:bg-muted transition-colors"
                  >
                    Rename
                  </button>
                  {sessions.length > 1 && (
                    <button
                      onClick={() => handleDelete(session.id)}
                      className="block w-full text-left px-3 py-1.5 text-sm text-destructive hover:bg-muted transition-colors"
                    >
                      Delete
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}

        {/* New session button */}
        <button
          onClick={handleNewSession}
          className="flex items-center gap-1 px-3 py-1.5 text-sm text-muted-foreground hover:bg-muted/50 rounded-lg transition-colors"
          title="New session"
        >
          <Plus className="h-4 w-4" />
        </button>
      </div>

      {/* New session dialog */}
      <Dialog open={newSessionDialogOpen} onOpenChange={setNewSessionDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>New Session</DialogTitle>
            <DialogDescription>
              Create a new chat session for this project.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={(e) => { e.preventDefault(); handleCreateSession(); }}>
            <div className="grid gap-4 py-4">
              <div className="grid gap-2">
                <Label htmlFor="session-name">Session Name</Label>
                <Input
                  id="session-name"
                  value={newSessionName}
                  onChange={(e) => setNewSessionName(e.target.value)}
                  placeholder="Enter session name"
                  autoFocus
                />
              </div>
            </div>
            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setNewSessionDialogOpen(false);
                  setNewSessionName('');
                }}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={!newSessionName.trim()}>
                Create Session
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}