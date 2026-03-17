/**
 * Claude Code preset — ChatInput.
 *
 * Terminal-style input with `❯` prompt prefix in yellow/gold, minimal dark
 * textarea, no inline model/agent selectors, stop/send buttons, image
 * attachment support, queued message indicator, and text-based context display.
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { ChatInputPresetProps } from '../types';
import type { ChatImage } from '../../../../../shared/types';
import { useImageInput } from '../../hooks/useImageInput';
import { useDraftPersistence } from '../../hooks/useDraftPersistence';
import { ImageAnnotationPanel } from '../../../ui/ImageAnnotationPanel';
import { MAX_MESSAGE_LENGTH } from '../../../../../shared/constants';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const CONTEXT_WINDOW = 200_000;

function getContextColor(percent: number): string {
  if (percent > 80) return '#ef4444';
  if (percent > 50) return '#f59e0b';
  return '#22c55e';
}

export const ClaudeCodeChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputPresetProps>(
  function ClaudeCodeChatInput(
    {
      onSend,
      onStop,
      isRunning,
      isQueued,
      tokenUsage,
      onCancelQueue,
      prefill,
      lastUserMessage,
      onEditLastMessage,
      initialDraft,
      onDraftChange,
    },
    forwardedRef,
  ) {
    const { draft: value, setDraft: setValue, clearDraft } = useDraftPersistence(initialDraft, onDraftChange);
    const {
      images, setImages, fileInputRef, addImageFile,
      handlePaste, handleDrop, handleDragOver, removeImage,
    } = useImageInput();
    const [previewIndex, setPreviewIndex] = useState<number | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Auto-resize textarea
    useEffect(() => {
      const el = textareaRef.current;
      if (!el) return;
      el.style.height = 'auto';
      el.style.height = `${el.scrollHeight}px`;
    }, [value]);

    // Prefill support
    useEffect(() => {
      if (prefill) {
        setValue(prefill.text);
        textareaRef.current?.focus();
      }
    }, [prefill?.seq]); // intentionally only tracks seq

    const handleSubmit = (e: React.FormEvent) => {
      e.preventDefault();
      const trimmed = value.trim();
      if (!trimmed && images.length === 0) return;
      onSend(trimmed, images.length > 0 ? images : undefined);
      setValue('');
      setImages([]);
      clearDraft();
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSubmit(e);
      }
      if (
        e.key === 'ArrowUp' &&
        value === '' &&
        onEditLastMessage &&
        lastUserMessage &&
        e.currentTarget.selectionStart === 0 &&
        e.currentTarget.selectionEnd === 0
      ) {
        e.preventDefault();
        onEditLastMessage();
      }
    };

    const handleAnnotationSave = useCallback((annotatedImage: ChatImage, idx: number) => {
      setImages((prev) => prev.map((img, i) => (i === idx ? annotatedImage : img)));
      setPreviewIndex(null);
    }, [setImages]);

    // Merge refs
    const mergedRef = useCallback(
      (node: HTMLTextAreaElement | null) => {
        (textareaRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
        if (typeof forwardedRef === 'function') forwardedRef(node);
        else if (forwardedRef) (forwardedRef as React.MutableRefObject<HTMLTextAreaElement | null>).current = node;
      },
      [forwardedRef],
    );

    // Context usage
    const effectiveContextWindow = (tokenUsage?.contextWindow && tokenUsage.contextWindow > 0)
      ? tokenUsage.contextWindow
      : CONTEXT_WINDOW;
    const contextTokens = tokenUsage?.lastContextInputTokens ?? tokenUsage?.inputTokens ?? 0;
    const contextPercent = tokenUsage
      ? Math.min((contextTokens / effectiveContextWindow) * 100, 100)
      : 0;

    const isOverLimit = value.length > MAX_MESSAGE_LENGTH;
    const canSubmit = (value.trim().length > 0 || images.length > 0) && !isOverLimit;

    return (
      <div
        style={{
          padding: '8px 16px 12px',
          borderTop: '1px solid #1e293b',
          backgroundColor: '#0d1117',
        }}
        onDrop={handleDrop}
        onDragOver={handleDragOver}
      >
        {/* Image previews */}
        {images.length > 0 && (
          <div style={{ display: 'flex', gap: 8, marginBottom: 8, flexWrap: 'wrap' }}>
            {images.map((img, i) => (
              <div key={i} style={{ position: 'relative' }}>
                <img
                  src={`data:${img.mediaType};base64,${img.base64}`}
                  alt={img.name || 'Attached'}
                  style={{ width: 48, height: 48, borderRadius: 4, objectFit: 'cover', border: '1px solid #374151', cursor: 'pointer' }}
                  onClick={() => setPreviewIndex(i)}
                />
                <button
                  type="button"
                  onClick={() => removeImage(i)}
                  style={{
                    position: 'absolute', top: -4, right: -4,
                    width: 16, height: 16, borderRadius: '50%',
                    backgroundColor: '#ef4444', color: '#fff',
                    border: 'none', fontSize: 10, lineHeight: 1,
                    cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}

        {previewIndex !== null && images[previewIndex] && (
          <ImageAnnotationPanel
            images={images.map((img) => ({ src: `data:${img.mediaType};base64,${img.base64}`, name: img.name }))}
            initialIndex={previewIndex}
            onClose={() => setPreviewIndex(null)}
            onSave={handleAnnotationSave}
          />
        )}

        <form onSubmit={handleSubmit} style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}>
          {/* ❯ prompt */}
          <span
            style={{
              color: '#e3b341',
              fontFamily: MONO,
              fontSize: 16,
              fontWeight: 700,
              lineHeight: '24px',
              flexShrink: 0,
              userSelect: 'none',
              paddingBottom: 2,
            }}
          >
            ❯
          </span>

          <textarea
            ref={mergedRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={isRunning ? 'Type a message (will be queued)...' : 'Type a message...'}
            style={{
              flex: 1,
              resize: 'none',
              backgroundColor: 'transparent',
              color: '#e5e7eb',
              fontFamily: MONO,
              fontSize: 14,
              lineHeight: '24px',
              border: 'none',
              outline: 'none',
              minHeight: 24,
              maxHeight: 200,
              overflowY: 'auto',
              caretColor: '#e3b341',
            }}
          />

          {/* Right-side controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
            {/* Context usage text */}
            {tokenUsage !== undefined && contextPercent > 0 && (
              <span
                style={{
                  fontFamily: MONO,
                  fontSize: 11,
                  color: getContextColor(contextPercent),
                }}
                title={`${contextTokens.toLocaleString()} / ${effectiveContextWindow.toLocaleString()} tokens`}
              >
                {Math.round(contextPercent)}%
              </span>
            )}

            {/* Queued indicator */}
            {isQueued && (
              <span style={{ fontFamily: MONO, fontSize: 11, color: '#f59e0b' }}>
                queued
                {onCancelQueue && (
                  <button
                    type="button"
                    onClick={onCancelQueue}
                    style={{
                      background: 'transparent', border: 'none', color: '#f59e0b',
                      cursor: 'pointer', fontSize: 11, marginLeft: 4,
                    }}
                    title="Cancel queue"
                  >
                    ×
                  </button>
                )}
              </span>
            )}

            {isOverLimit && (
              <span style={{ fontFamily: MONO, fontSize: 10, color: '#ef4444' }}>
                {value.length.toLocaleString()}/{MAX_MESSAGE_LENGTH.toLocaleString()}
              </span>
            )}

            {/* Image attach button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              style={{
                background: 'transparent', border: 'none',
                color: '#6b7280', cursor: 'pointer', fontSize: 14,
                padding: 2,
              }}
              title="Attach image"
            >
              📎
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              style={{ display: 'none' }}
              onChange={(e) => {
                const files = e.target.files;
                if (files) {
                  for (const file of Array.from(files)) addImageFile(file);
                }
                e.target.value = '';
              }}
            />

            {/* Stop button */}
            {isRunning && onStop && (
              <button
                type="button"
                onClick={onStop}
                style={{
                  background: 'transparent', border: '1px solid #374151',
                  color: isQueued ? '#f59e0b' : '#ef4444',
                  cursor: 'pointer', fontFamily: MONO, fontSize: 11,
                  padding: '2px 8px', borderRadius: 4,
                }}
                title={isQueued ? 'Stop & send queued' : 'Stop'}
              >
                {isQueued ? '⚡ send' : '■ stop'}
              </button>
            )}

            {/* Send button */}
            <button
              type="submit"
              disabled={!canSubmit}
              style={{
                background: canSubmit ? '#e3b341' : '#374151',
                color: canSubmit ? '#0d1117' : '#6b7280',
                border: 'none',
                cursor: canSubmit ? 'pointer' : 'not-allowed',
                fontFamily: MONO,
                fontSize: 11,
                fontWeight: 600,
                padding: '3px 10px',
                borderRadius: 4,
              }}
              title={isRunning ? 'Queue message' : 'Send'}
            >
              {isRunning ? 'queue' : 'send'}
            </button>
          </div>
        </form>
      </div>
    );
  },
);

ClaudeCodeChatInput.displayName = 'ClaudeCodeChatInput';
