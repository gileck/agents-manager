import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '../ui/button';
import { reportError } from '../../lib/error-handler';
import type { ChatImage } from '../../../shared/types';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;

const CONTEXT_WINDOW = 200_000;

function getContextColor(percent: number): string {
  if (percent > 80) return '#ef4444';
  if (percent > 50) return '#f59e0b';
  return '#22c55e';
}

interface ChatInputProps {
  onSend: (message: string, images?: ChatImage[]) => void;
  onStop?: () => void;
  isRunning: boolean;
  isQueued: boolean;
  tokenUsage?: { inputTokens: number; outputTokens: number };
}

export function ChatInput({ onSend, onStop, isRunning, isQueued, tokenUsage }: ChatInputProps) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea height to match content
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [value]);

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
      reportError(reader.error, `ChatInput: read file "${file.name}"`);
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
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
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

  useEffect(() => {
    if (previewIndex === null) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreviewIndex(null);
      if (e.key === 'ArrowLeft') setPreviewIndex((prev) => prev === null ? null : (prev - 1 + images.length) % images.length);
      if (e.key === 'ArrowRight') setPreviewIndex((prev) => prev === null ? null : (prev + 1) % images.length);
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [previewIndex, images.length]);

  const contextPercent = tokenUsage
    ? Math.min((tokenUsage.inputTokens / CONTEXT_WINDOW) * 100, 100)
    : 0;
  const circleRadius = 9;
  const circleCircumference = 2 * Math.PI * circleRadius;
  const circleOffset = circleCircumference * (1 - contextPercent / 100);
  const circleColor = getContextColor(contextPercent);

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
                className="rounded border border-border object-cover cursor-pointer"
                onClick={() => setPreviewIndex(i)}
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
      {previewIndex !== null && images[previewIndex] && createPortal(
        <div
          className="absolute inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setPreviewIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${images[previewIndex].mediaType};base64,${images[previewIndex].base64}`}
              alt={images[previewIndex].name || 'Preview'}
              style={{ maxHeight: '80vh', maxWidth: '80vw' }}
              className="rounded-lg"
            />
            <button
              type="button"
              onClick={() => setPreviewIndex(null)}
              aria-label="Close preview"
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}
            >
              ×
            </button>
            {images.length > 1 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreviewIndex((prev) => prev === null ? null : (prev - 1 + images.length) % images.length)}
                  aria-label="Previous image"
                  className="bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
                  style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}
                >
                  ‹
                </button>
                <span className="bg-black/60 text-white rounded-full px-3 flex items-center text-sm">
                  {previewIndex + 1} / {images.length}
                </span>
                <button
                  type="button"
                  onClick={() => setPreviewIndex((prev) => prev === null ? null : (prev + 1) % images.length)}
                  aria-label="Next image"
                  className="bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
                  style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}
                >
                  ›
                </button>
              </div>
            )}
          </div>
        </div>,
        document.getElementById('root')!,
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
          ref={textareaRef}
          className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm min-h-[40px] max-h-[240px] overflow-y-auto focus:outline-none focus:ring-2 focus:ring-ring"
          placeholder={isRunning ? 'Type a message (will be queued)...' : 'Type a message...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
        />
        {tokenUsage !== undefined && (
          <svg
            width="22" height="22"
            viewBox="0 0 22 22"
            className="shrink-0 mb-1"
            aria-label={`Context: ${contextPercent.toFixed(1)}% used`}
          >
            <title>{`Context: ${contextPercent.toFixed(1)}% used (${tokenUsage.inputTokens.toLocaleString()} / ${CONTEXT_WINDOW.toLocaleString()} tokens)`}</title>
            <circle cx="11" cy="11" r={circleRadius} fill="none" stroke="currentColor" strokeWidth="2" className="text-muted-foreground/20" />
            <circle
              cx="11" cy="11" r={circleRadius}
              fill="none"
              stroke={circleColor}
              strokeWidth="2"
              strokeDasharray={circleCircumference}
              strokeDashoffset={circleOffset}
              strokeLinecap="round"
              transform="rotate(-90 11 11)"
            />
          </svg>
        )}
        {isRunning && onStop && (
          <Button type="button" variant="destructive" size="sm" onClick={onStop} className="mb-0.5">
            Stop
          </Button>
        )}
        {isQueued && (
          <span className="text-xs text-muted-foreground mb-1">Queued</span>
        )}
      </div>
    </form>
  );
}
