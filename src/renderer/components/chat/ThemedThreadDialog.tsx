import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription,
} from '../ui/dialog';
import { ImagePasteArea } from '../ui/ImagePasteArea';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import { useProjectChatSessions } from '../../contexts/ProjectChatSessionsContext';
import { reportError } from '../../lib/error-handler';
import type { ThreadIntent, ThreadIntentConfig } from '../../lib/thread-intent-prompts';
import { THREAD_INTENTS } from '../../lib/thread-intent-prompts';
import type { ChatImage } from '../../../shared/types';

const isMac = typeof navigator !== 'undefined' && navigator.platform.startsWith('Mac');

interface ThemedThreadDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  intent: ThreadIntent;
}

/**
 * Navigation state passed when navigating to /chat/:sessionId after themed
 * thread creation. ChatPage detects this and auto-sends the initial message.
 */
export interface ThemedThreadNavState {
  initialMessage: string;
}

export function ThemedThreadDialog({ open, onOpenChange, intent }: ThemedThreadDialogProps) {
  const [userInput, setUserInput] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { currentProjectId } = useCurrentProject();
  const { createSession, updateSession } = useProjectChatSessions();
  const navigate = useNavigate();

  const config: ThreadIntentConfig = THREAD_INTENTS[intent];

  // Reset form when dialog opens/closes
  useEffect(() => {
    if (open) {
      setUserInput('');
      setImages([]);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const message = userInput.trim();
    if (!message || !currentProjectId) return;
    setSubmitting(true);
    try {
      // 1. Save screenshots and build markdown image references
      let screenshotMarkdown = '';
      if (images.length > 0) {
        try {
          const { paths } = await window.api.screenshots.save(images);
          if (paths.length > 0) {
            const refs = paths.map((p, i) => `![screenshot-${i + 1}](${p})`);
            screenshotMarkdown = '\n\n' + refs.join('\n');
          }
        } catch (err) {
          reportError(err, 'Save screenshots');
        }
      }

      // 2. Create a new chat session
      const session = await createSession(config.label);
      if (!session) return;

      // 3. Update the session with the intent-specific system prompt
      await updateSession(session.id, {
        systemPromptAppend: config.systemPromptAppend,
      });

      // 4. Close the dialog
      onOpenChange(false);

      // 5. Navigate to the chat page with the initial message in navigation state.
      //    ChatPage detects this and auto-sends once the session is ready.
      const navState: ThemedThreadNavState = { initialMessage: message + screenshotMarkdown };
      navigate(`/chat/${session.id}`, { state: navState });
    } catch (err) {
      reportError(err, `Create ${config.label} thread`);
    } finally {
      setSubmitting(false);
    }
  }, [userInput, images, currentProjectId, createSession, updateSession, config, onOpenChange, navigate]);

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
        <div className="py-4 space-y-3">
          <Textarea
            rows={5}
            value={userInput}
            onChange={(e) => setUserInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={config.placeholder}
            autoFocus
          />
          <ImagePasteArea images={images} onImagesChange={setImages} />
          <p className="text-xs text-muted-foreground">
            Press {isMac ? 'Cmd' : 'Ctrl'}+Enter to submit
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
