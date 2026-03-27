import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '../ui/dialog';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { reportError } from '../../lib/error-handler';
import type { ThreadIntent, ThreadIntentConfig } from '../../lib/thread-intent-prompts';
import { THREAD_INTENTS } from '../../lib/thread-intent-prompts';

interface ThemedThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: ThreadIntent;
}

export function ThemedThreadDialog({ open, onOpenChange, intent }: ThemedThreadDialogProps) {
  const [userInput, setUserInput] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const { currentProjectId } = useCurrentProject();
  const { createSession, updateSession } = useProjectChatSessions();
  const navigate = useNavigate();

  const config: ThreadIntentConfig = THREAD_INTENTS[intent];

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setUserInput('');
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    if (!userInput.trim() || !currentProjectId) return;
    setSubmitting(true);
    try {
      // 1. Create a new chat session
      const session = await createSession(config.label);
      if (!session) return;

      // 2. Update the session with the intent-specific system prompt
      await updateSession(session.id, {
        systemPromptAppend: config.systemPromptAppend,
      });

      // 3. Close the dialog
      onOpenChange(false);

      // 4. Navigate to the chat page with this session
      navigate(`/chat/${session.id}`);

      // 5. Auto-send the user's message after a brief delay to let the page mount
      setTimeout(async () => {
        try {
          await window.api.chat.send(session.id, userInput.trim());
        } catch (err) {
          reportError(err, `Send ${config.label} message`);
        }
      }, 300);
    } catch (err) {
      reportError(err, `Create ${config.label} thread`);
    } finally {
      setSubmitting(false);
    }
  }, [userInput, currentProjectId, createSession, updateSession, config, onOpenChange, navigate]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      handleSubmit();
    }
  }, [handleSubmit]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{config.label}</DialogTitle>
          <DialogDescription>{config.description}</DialogDescription>
        </DialogHeader>
        <div className="py-4">
          <Textarea
            rows={5}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={config.placeholder}
            autoFocus
          />
          <p className="text-xs text-muted-foreground mt-2">
            Press {navigator.platform.includes('Mac') ? 'Cmd' : 'Ctrl'}+Enter to submit
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={submitting || !userInput.trim()}
          >
            {submitting ? 'Creating thread...' : 'Start Thread'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
