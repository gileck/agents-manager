import React, { useState, useRef, useCallback } from 'react';
import { Button } from '../ui/button';
import type { ChatImage } from '../../../shared/types';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;

interface ChatInputProps {
  onSend: (message: string, images?: ChatImage[]) => void;
  onStop?: () => void;
  isRunning: boolean;
  isQueued: boolean;
}

export function ChatInput({ onSend, onStop, isRunning, isQueued }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFile = useCallback((file: File) => {
    if (!VALID_IMAGE_TYPES.has(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (!base64) return;
      setImages((curr) => {
        if (curr.length >= MAX_IMAGES) return curr;
        return [...curr, {
          mediaType: file.type as ChatImage['mediaType'],
          base64,
          name: file.name,
        }];
      });
    };
    reader.onerror = () => {
      console.error(`[ChatInput] Failed to read file "${file.name}":`, reader.error);
    };
    reader.readAsDataURL(file);
  }, []);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFile(file);
        return;
      }
    }
  }, [addImageFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        addImageFile(file);
      }
    }
  }, [addImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeImage = useCallback((index: number) => {
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed && images.length === 0) return;
    onSend(trimmed, images.length > 0 ? images : undefined);
    setValue('');
    setImages([]);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const canSend = value.trim().length > 0 || images.length > 0;

  return (
    <form
      onSubmit={handleSubmit}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      className="border-t border-border px-4 py-3"
    >
      {images.length > 0 && (
        <div className="flex gap-2 mb-2 flex-wrap">
          {images.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt={img.name || 'Attached image'}
                style={{ width: 64, height: 64 }}
                className="rounded border border-border object-cover"
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-muted-foreground hover:text-foreground transition-colors p-1"
          title="Attach image"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
            <circle cx="8.5" cy="8.5" r="1.5" />
            <polyline points="21 15 16 10 5 21" />
          </svg>
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/gif,image/webp"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = e.target.files;
            if (files) {
              for (const file of Array.from(files)) {
                addImageFile(file);
              }
            }
            e.target.value = '';
          }}
        />
        <textarea
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] max-h-[120px] focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={isRunning ? 'Type a message (will be queued)...' : 'Type a message...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
        />
        <div className="flex gap-1">
          {isRunning && onStop && (
            <Button type="button" variant="destructive" size="sm" onClick={onStop}>
              Stop
            </Button>
          )}
          <Button type="submit" size="sm" disabled={!canSend}>
            {isRunning ? 'Queue' : 'Send'}
          </Button>
        </div>
        {isQueued && (
          <span className="text-xs text-muted-foreground ml-1">Message queued</span>
        )}
      </div>
    </form>
  );
}
