/**
 * Codex preset — ChatInput.
 *
 * Styled input bar matching the Codex CLI design:
 * - Model selector dropdown (wired to existing models/onModelChange props)
 * - Effort/reasoning level selector (visual-only local state)
 * - "Ask for follow-up changes" placeholder text
 * - Attachment (+) button
 * - Microphone icon button (visual-only)
 * - Send button (arrow icon)
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import type { ChatInputPresetProps } from '../types';
import type { PermissionMode } from '../../../../../shared/types';
import { useDraftPersistence } from '../../hooks/useDraftPersistence';
import { useImageInput } from '../../hooks/useImageInput';
import { ImagePreviewStrip } from '../../ImagePreviewStrip';
import { MAX_MESSAGE_LENGTH } from '../../../../../shared/constants';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const CONTEXT_WINDOW = 200_000;
const ACCENT = '#10b981';

const EFFORT_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'read_only', label: 'read-only' },
  { value: 'read_write', label: 'read-write' },
  { value: 'full_access', label: 'full-access' },
];

function getContextColor(percent: number): string {
  if (percent > 80) return '#ef4444';
  if (percent > 50) return '#f59e0b';
  return '#22c55e';
}

export const CodexChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputPresetProps>(
  function CodexChatInput(
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
      agentLibs,
      selectedAgentLib,
      onAgentLibChange,
      models,
      selectedModel,
      onModelChange,
      permissionMode,
      onPermissionModeChange,
    },
    forwardedRef,
  ) {
    const { draft: value, setDraft: setValue, clearDraft } = useDraftPersistence(initialDraft, onDraftChange);
    const {
      images, setImages,
      handlePaste, handleDrop, handleDragOver, removeImage,
    } = useImageInput();
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Visual-only effort selector state
    const [effort, setEffort] = useState('high');

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

    const handleAttachClick = () => {
      fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      // Trigger the same flow as paste — read as base64
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) continue;
        const reader = new FileReader();
        reader.onload = () => {
          const dataUrl = reader.result as string;
          const b64 = dataUrl.split(',')[1];
          if (b64) {
            setImages((prev) => [...prev, {
              base64: b64,
              mediaType: file.type as 'image/png' | 'image/jpeg' | 'image/gif' | 'image/webp',
              name: file.name,
            }]);
          }
        };
        reader.readAsDataURL(file);
      }
      // Reset so same file can be re-attached
      e.target.value = '';
    };

    // Selector dropdown style helper
    const selectStyle: React.CSSProperties = {
      background: '#1a1f2e',
      color: '#d1d5db',
      border: '1px solid #2d3748',
      borderRadius: 4,
      fontFamily: MONO,
      fontSize: '0.846em',
      padding: '3px 6px',
      cursor: 'pointer',
      outline: 'none',
      appearance: 'none',
      WebkitAppearance: 'none',
      backgroundImage: 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'5\' viewBox=\'0 0 8 5\'%3E%3Cpath d=\'M0 0l4 5 4-5z\' fill=\'%236b7280\'/%3E%3C/svg%3E")',
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 6px center',
      paddingRight: 18,
    };

    // Icon button style helper
    const iconBtnStyle: React.CSSProperties = {
      background: 'transparent',
      border: '1px solid #2d3748',
      color: '#6b7280',
      cursor: 'pointer',
      borderRadius: 4,
      padding: '4px 6px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontSize: '1em',
      lineHeight: 1,
    };

    return (
      <div
        style={{
          padding: '0 16px 0',
          borderTop: '1px solid #1e293b',
          backgroundColor: '#0d1117',
        }}
      >
        {/* Image preview strip */}
        <ImagePreviewStrip
          images={images}
          setImages={setImages}
          removeImage={removeImage}
          variant="terminal"
        />

        {/* Hidden file input for attachment */}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          multiple
          style={{ display: 'none' }}
          onChange={handleFileChange}
        />

        {/* ── Selector row (model + effort) ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 0 4px',
          fontFamily: MONO,
          fontSize: '0.923em',
        }}>
          {/* Model selector */}
          {models && models.length > 0 && onModelChange && (
            <select
              value={selectedModel || ''}
              onChange={(e) => onModelChange(e.target.value)}
              style={selectStyle}
              title="Model"
            >
              {models.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
            </select>
          )}

          {/* Effort selector (visual-only) */}
          <select
            value={effort}
            onChange={(e) => setEffort(e.target.value)}
            style={selectStyle}
            title="Reasoning effort"
          >
            {EFFORT_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          {/* Engine selector (small, secondary) */}
          {agentLibs && agentLibs.length > 0 && onAgentLibChange && (
            <select
              value={selectedAgentLib || ''}
              onChange={(e) => onAgentLibChange(e.target.value)}
              style={{ ...selectStyle, color: '#6b7280' }}
              title="Engine"
            >
              {agentLibs.map((lib) => (
                <option key={lib.name} value={lib.name} disabled={!lib.available}>
                  {lib.name}
                </option>
              ))}
            </select>
          )}

          {/* Permission mode selector */}
          {onPermissionModeChange && (
            <select
              value={permissionMode || 'full_access'}
              onChange={(e) => onPermissionModeChange(e.target.value as PermissionMode)}
              style={{ ...selectStyle, color: '#6b7280' }}
              title="Permission mode"
            >
              {PERMISSION_MODE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {/* Spacer */}
          <div style={{ flex: 1 }} />

          {/* Context usage indicator */}
          {tokenUsage !== undefined && contextPercent > 0 && (
            <span style={{
              fontFamily: MONO,
              fontSize: '0.846em',
              color: getContextColor(contextPercent),
            }}>
              {Math.round(contextPercent)}% context
            </span>
          )}
        </div>

        {/* ── Input bar ── */}
        <form
          onSubmit={handleSubmit}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          style={{
            display: 'flex',
            alignItems: 'flex-end',
            gap: 8,
            padding: '6px 0 10px',
            borderTop: '1px solid #1a1f2e',
          }}
        >
          {/* Attachment button */}
          <button
            type="button"
            onClick={handleAttachClick}
            style={iconBtnStyle}
            title="Attach image"
          >
            +
          </button>

          {/* Textarea */}
          <textarea
            ref={mergedRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={handlePaste}
            rows={1}
            placeholder={isRunning ? 'Type a message (will be queued)...' : 'Ask for follow-up changes'}
            style={{
              flex: 1,
              resize: 'none',
              backgroundColor: '#161b22',
              color: '#e5e7eb',
              fontFamily: MONO,
              fontSize: '1em',
              lineHeight: '22px',
              border: '1px solid #2d3748',
              borderRadius: 6,
              outline: 'none',
              minHeight: 36,
              maxHeight: 200,
              overflowY: 'auto',
              padding: '7px 12px',
            }}
          />

          {/* Right-side controls */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0 }}>
            {/* Queued indicator */}
            {isQueued && (
              <span style={{ fontFamily: MONO, fontSize: '0.846em', color: '#f59e0b' }}>
                queued
                {onCancelQueue && (
                  <button
                    type="button"
                    onClick={onCancelQueue}
                    style={{
                      background: 'transparent', border: 'none', color: '#f59e0b',
                      cursor: 'pointer', fontSize: '0.846em', marginLeft: 4,
                    }}
                    title="Cancel queue"
                  >
                    ×
                  </button>
                )}
              </span>
            )}

            {isOverLimit && (
              <span style={{ fontFamily: MONO, fontSize: '0.77em', color: '#ef4444' }}>
                {value.length.toLocaleString()}/{MAX_MESSAGE_LENGTH.toLocaleString()}
              </span>
            )}

            {/* Stop button */}
            {isRunning && onStop && (
              <button
                type="button"
                onClick={onStop}
                style={{
                  ...iconBtnStyle,
                  color: isQueued ? '#f59e0b' : '#ef4444',
                  border: `1px solid ${isQueued ? '#f59e0b' : '#ef4444'}`,
                  fontSize: '0.846em',
                  padding: '4px 8px',
                }}
                title={isQueued ? 'Stop & send queued' : 'Stop'}
              >
                {isQueued ? '⚡' : '■'}
              </button>
            )}

            {/* Microphone button (visual-only) */}
            <button
              type="button"
              style={{ ...iconBtnStyle, opacity: 0.4, cursor: 'default' }}
              title="Voice input (coming soon)"
              disabled
            >
              🎤
            </button>

            {/* Send button */}
            <button
              type="submit"
              disabled={(!value.trim() && images.length === 0) || isOverLimit}
              style={{
                background: (value.trim() || images.length > 0) && !isOverLimit ? ACCENT : '#1a1f2e',
                border: 'none',
                color: (value.trim() || images.length > 0) && !isOverLimit ? '#fff' : '#4b5563',
                cursor: (value.trim() || images.length > 0) && !isOverLimit ? 'pointer' : 'default',
                borderRadius: 6,
                padding: '6px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1em',
                lineHeight: 1,
                transition: 'background 0.15s, color 0.15s',
              }}
              title="Send message"
            >
              ↑
            </button>
          </div>
        </form>
      </div>
    );
  },
);

CodexChatInput.displayName = 'CodexChatInput';
