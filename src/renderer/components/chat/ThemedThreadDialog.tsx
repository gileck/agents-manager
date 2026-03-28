import React, { useState, useCallback, useEffect, useRef } from 'react';
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
  initialImages?: ChatImage[];
}

export function ThemedThreadDialog({ open, onOpenChange, intent }: ThemedThreadDialogProps) {
  const [userInput, setUserInput] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const { currentProjectId } = useCurrentProject();
  const { createSession, updateSession } = useProjectChatSessions();
  const navigate = useNavigate();

  const config: ThreadIntentConfig = THREAD_INTENTS[intent];

  // Counter used as a React key to force-remount ImagePasteArea on dialog open,
  // ensuring its internal state is reset regardless of Dialog mount/unmount behavior.
  const resetKeyRef = useRef(0);

  // Reset form when dialog opens
  useEffect(() => {
    if (open) {
      setUserInput('');
      setImages([]);
      resetKeyRef.current += 1;
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const message = userInput.trim();
    if (!message || !currentProjectId) return;
    setSubmitting(true);
    try {
      // 1. Create a new chat session tagged with the thread intent
      const session = await createSession(config.label, intent);
      if (!session) return;

      // 2. Update the session with the intent-specific system prompt
      await updateSession(session.id, {
        systemPromptAppend: config.systemPromptAppend,
      });

      // 3. Close the dialog
      onOpenChange(false);

      // 4. Navigate to the chat page with the initial message (and images) in
      //    navigation state. ChatPage detects this and auto-sends once the
      //    session is ready. Images are passed as ChatImage[] so the chat API
      //    handles screenshot saving and populates msg.images for proper
      //    embedding in the message bubble.
      const navState: ThemedThreadNavState = {
        initialMessage: message,
        initialImages: images.length > 0 ? images : undefined,
      };
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
          <ImagePasteArea key={resetKeyRef.current} images={images} onImagesChange={setImages} />
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
