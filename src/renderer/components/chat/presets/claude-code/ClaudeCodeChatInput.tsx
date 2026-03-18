/**
 * Claude Code preset — ChatInput.
 *
 * Terminal-style input with `❯` prompt prefix, minimal dark textarea,
 * stop button, queued message indicator, and a terminal-styled config
 * row below the input for engine/model/permission selection and context usage.
 * Enter sends — no send button needed (CLI aesthetic).
 */

import React, { useRef, useCallback, useEffect } from 'react';
import type { ChatInputPresetProps } from '../types';
import type { PermissionMode } from '../../../../../shared/types';
import { useDraftPersistence } from '../../hooks/useDraftPersistence';
import { useImageInput } from '../../hooks/useImageInput';
import { ImagePreviewStrip } from '../../ImagePreviewStrip';
import { MAX_MESSAGE_LENGTH } from '../../../../../shared/constants';

const MONO = 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace';
const CONTEXT_WINDOW = 200_000;

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

    return (
      <div
        style={{
          padding: '16px 16px 12px',
          borderTop: '1px solid #1e293b',
          backgroundColor: '#0d1117',
        }}
      >
        {/* Image preview strip with annotation support */}
        <ImagePreviewStrip
          images={images}
          setImages={setImages}
          removeImage={removeImage}
          variant="terminal"
        />

        <form
          onSubmit={handleSubmit}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          style={{ display: 'flex', alignItems: 'flex-end', gap: 8 }}
        >
          {/* ❯ prompt */}
          <span
            style={{
              color: '#e3b341',
              fontFamily: MONO,
              fontSize: '1.23em',
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
              fontSize: '1.077em',
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
                  background: 'transparent', border: '1px solid #374151',
                  color: isQueued ? '#f59e0b' : '#ef4444',
                  cursor: 'pointer', fontFamily: MONO, fontSize: '0.846em',
                  padding: '2px 8px', borderRadius: 4,
                }}
                title={isQueued ? 'Stop & send queued' : 'Stop'}
              >
                {isQueued ? '⚡ send' : '■ stop'}
              </button>
            )}
          </div>
        </form>

        {/* Terminal-styled config row below input */}
        {(agentLibs || models || onPermissionModeChange) && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: 4,
            paddingTop: 22,
            fontFamily: MONO,
            fontSize: '0.846em',
            color: '#6b7280',
          }}>
            {/* Engine selector */}
            {agentLibs && agentLibs.length > 0 && onAgentLibChange && (
              <>
                <span>engine:</span>
                <select
                  value={selectedAgentLib || ''}
                  onChange={(e) => onAgentLibChange(e.target.value)}
                  style={{
                    background: '#161b22',
                    color: '#d1d5db',
                    border: '1px solid #374151',
                    borderRadius: 3,
                    fontFamily: MONO,
                    fontSize: '1em',
                    padding: '1px 4px',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {agentLibs.map((lib) => (
                    <option key={lib.name} value={lib.name} disabled={!lib.available}>
                      {lib.name}
                    </option>
                  ))}
                </select>
              </>
            )}

            {/* Separator */}
            {agentLibs && agentLibs.length > 0 && models && models.length > 0 && (
              <span style={{ color: '#374151', margin: '0 2px' }}>|</span>
            )}

            {/* Model selector */}
            {models && models.length > 0 && onModelChange && (
              <>
                <span>model:</span>
                <select
                  value={selectedModel || ''}
                  onChange={(e) => onModelChange(e.target.value)}
                  style={{
                    background: '#161b22',
                    color: '#d1d5db',
                    border: '1px solid #374151',
                    borderRadius: 3,
                    fontFamily: MONO,
                    fontSize: '1em',
                    padding: '1px 4px',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {models.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            {/* Permission mode selector */}
            {onPermissionModeChange && (
              <>
                {(agentLibs?.length || (models && models.length > 0)) && (
                  <span style={{ color: '#374151', margin: '0 2px' }}>|</span>
                )}
                <span>perms:</span>
                <select
                  value={permissionMode || 'full_access'}
                  onChange={(e) => onPermissionModeChange(e.target.value as PermissionMode)}
                  style={{
                    background: '#161b22',
                    color: '#d1d5db',
                    border: '1px solid #374151',
                    borderRadius: 3,
                    fontFamily: MONO,
                    fontSize: '1em',
                    padding: '1px 4px',
                    cursor: 'pointer',
                    outline: 'none',
                  }}
                >
                  {PERMISSION_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              </>
            )}

            {/* Context usage */}
            {tokenUsage !== undefined && contextPercent > 0 && (
              <>
                <span style={{ color: '#374151', margin: '0 2px' }}>|</span>
                <span style={{ color: getContextColor(contextPercent) }}>
                  {Math.round(contextPercent)}% context
                </span>
              </>
            )}
          </div>
        )}
      </div>
    );
  },
);

ClaudeCodeChatInput.displayName = 'ClaudeCodeChatInput';
