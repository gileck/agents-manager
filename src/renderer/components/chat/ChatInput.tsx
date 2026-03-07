import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Image, Square, Cpu, ArrowUp } from 'lucide-react';
import { reportError } from '../../lib/error-handler';
import type { ChatImage } from '../../../shared/types';
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '../ui/select';

function mergeRefs<T>(
  ...refs: Array<React.Ref<T> | undefined>
): React.RefCallback<T> {
  return (value: T | null) => {
    for (const ref of refs) {
      if (typeof ref === 'function') {
        ref(value);
      } else if (ref != null) {
        (ref as React.MutableRefObject<T | null>).current = value;
      }
    }
  };
}

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;

const CONTEXT_WINDOW = 200_000;

function getContextColor(percent: number): string {
  if (percent > 80) return '#ef4444';
  if (percent > 50) return '#f59e0b';
  return '#22c55e';
}

export interface AgentLibOption {
  name: string;
  available: boolean;
}

export interface ModelOption {
  value: string;
  label: string;
}

interface ChatInputProps {
  onSend: (message: string, images?: ChatImage[]) => void;
  onStop?: () => void;
  isRunning: boolean;
  isQueued: boolean;
  tokenUsage?: { inputTokens: number; outputTokens: number };
  agentLibs?: AgentLibOption[];
  selectedAgentLib?: string;
  onAgentLibChange?: (lib: string) => void;
  models?: ModelOption[];
  selectedModel?: string;
  onModelChange?: (model: string) => void;
}

export const ChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputProps>(function ChatInput({
  onSend,
  onStop,
  isRunning,
  isQueued,
  tokenUsage,
  agentLibs,
  selectedAgentLib,
  onAgentLibChange,
  models,
  selectedModel,
  onModelChange,
}: ChatInputProps, forwardedRef) {
  const [value, setValue] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

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

  const canSubmit = value.trim().length > 0 || images.length > 0;

  return (
    <div className="px-6 pb-5 pt-3">
      <form
        onSubmit={handleSubmit}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        className="rounded-[1.35rem] border border-border/75 bg-card/82 shadow-[0_16px_30px_hsl(var(--background)/0.42)] overflow-hidden transition-[border-color,box-shadow] duration-[var(--motion-base)] ease-[var(--ease-standard)] focus-within:shadow-[0_18px_36px_hsl(var(--background)/0.52)] focus-within:border-ring/60 backdrop-blur-lg"
      >
        {images.length > 0 && (
          <div className="flex gap-2 px-4 pt-3 flex-wrap">
            {images.map((img, i) => (
              <div key={i} className="relative group">
                <img
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt={img.name || 'Attached image'}
                  style={{ width: 56, height: 56 }}
                  className="rounded-lg border border-border object-cover cursor-pointer"
                  onClick={() => setPreviewIndex(i)}
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
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

        <textarea
          ref={mergeRefs(textareaRef, forwardedRef)}
          className="w-full resize-none bg-transparent px-4 pt-3 pb-2.5 text-sm min-h-[52px] max-h-[240px] overflow-y-auto focus:outline-none placeholder:text-muted-foreground/70"
          placeholder={isRunning ? 'Type a message (will be queued)...' : 'Type a message...'}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={handleKeyDown}
          onPaste={handlePaste}
          rows={1}
        />

        <div className="flex items-center justify-between px-3.5 pb-3 pt-0.5">
          <div className="flex items-center gap-1.5 min-w-0">
            {agentLibs && agentLibs.length > 0 && onAgentLibChange && (
              <Select
                value={selectedAgentLib || ''}
                onValueChange={onAgentLibChange}
                disabled={isStreaming(isRunning)}
                className="min-w-[144px]"
              >
                <SelectTrigger className="h-8 rounded-full border-border/65 bg-muted/45 px-2.5 py-1 text-xs font-medium shadow-none">
                  <span className="flex items-center gap-1.5 min-w-0">
                    <Cpu className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                    <SelectValue placeholder="Engine" />
                  </span>
                </SelectTrigger>
                <SelectContent className="max-h-64">
                  {agentLibs.map((lib) => (
                    <SelectItem key={lib.name} value={lib.name} disabled={!lib.available}>
                      {lib.name}{!lib.available ? ' (unavailable)' : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {models && models.length > 0 && onModelChange && (
              <Select
                value={selectedModel || ''}
                onValueChange={onModelChange}
                disabled={isStreaming(isRunning)}
                className="min-w-[140px]"
              >
                <SelectTrigger
                  className="h-8 rounded-full border-transparent bg-transparent px-2 py-1 text-xs text-muted-foreground shadow-none hover:border-border/65 hover:bg-muted/45"
                >
                  <SelectValue placeholder="Model" />
                </SelectTrigger>
                <SelectContent className="max-h-72">
                  {models.map((m) => (
                    <SelectItem key={m.value} value={m.value}>
                      {m.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            {isQueued && (
              <span className="text-xs text-amber-500 font-medium ml-1">Queued</span>
            )}
          </div>

          <div className="flex items-center gap-1.5">
            {tokenUsage !== undefined && contextPercent > 0 && (
              <svg
                width="22" height="22"
                viewBox="0 0 22 22"
                className="shrink-0"
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
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="p-2 rounded-full text-muted-foreground hover:text-foreground hover:bg-muted/55 transition-colors"
              title="Attach image"
            >
              <Image className="h-4 w-4" />
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
            {isRunning && onStop && (
              <button
                type="button"
                onClick={onStop}
                className="p-2 rounded-full text-destructive hover:bg-destructive/10 transition-colors"
                title="Stop"
              >
                <Square className="h-4 w-4 fill-current" />
              </button>
            )}
            <button
              type="submit"
              disabled={!canSubmit}
              className="p-2 rounded-full bg-primary text-primary-foreground disabled:opacity-45 disabled:cursor-not-allowed hover:bg-primary/92 transition-colors shadow-[0_8px_18px_hsl(var(--primary)/0.32)]"
              title={isRunning ? 'Queue message' : 'Send message'}
            >
              <ArrowUp className="h-4 w-4" />
            </button>
          </div>
        </div>
      </form>
    </div>
  );
});

ChatInput.displayName = 'ChatInput';

function isStreaming(isRunning: boolean): boolean {
  return isRunning;
}
