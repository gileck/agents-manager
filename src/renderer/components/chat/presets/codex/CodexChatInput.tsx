/**
 * Codex preset — ChatInput.
 *
 * Modern chat-app input area with 3-row vertical layout:
 * Row 1: Large rounded textarea with dark background
 * Row 2: Attachment, model/effort controls, mic icon, amber send button
 * Row 3: Status bar (local indicator, permission mode, branch)
 */

import React, { useRef, useCallback, useEffect, useState } from 'react';
import type { ChatInputPresetProps } from '../types';
import type { PermissionMode } from '../../../../../shared/types';
import { useDraftPersistence } from '../../hooks/useDraftPersistence';
import { useImageInput } from '../../hooks/useImageInput';
import { ImagePreviewStrip } from '../../ImagePreviewStrip';
import { MAX_MESSAGE_LENGTH } from '../../../../../shared/constants';

const SANS = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
const BORDER = '#333';
const ACCENT = '#f59e0b';
const BG_INPUT = '#1e1e1e';

const EFFORT_OPTIONS = [
  { value: 'high', label: 'High' },
  { value: 'medium', label: 'Medium' },
  { value: 'low', label: 'Low' },
];

const PERMISSION_MODE_OPTIONS: { value: PermissionMode; label: string }[] = [
  { value: 'read_only', label: 'Read-only' },
  { value: 'read_write', label: 'Read-write' },
  { value: 'full_access', label: 'Full access' },
];

function getPermModeLabel(mode: PermissionMode | null | undefined): string {
  switch (mode) {
    case 'read_only': return 'Read-only';
    case 'read_write': return 'Read-write';
    default: return 'Full access';
  }
}

/** Shared dropdown style for Row 2 controls. */
const DROPDOWN_CHEVRON = 'url("data:image/svg+xml,%3Csvg xmlns=\'http://www.w3.org/2000/svg\' width=\'8\' height=\'5\' viewBox=\'0 0 8 5\'%3E%3Cpath d=\'M0 0l4 5 4-5z\' fill=\'%23888\'/%3E%3C/svg%3E")';

export const CodexChatInput = React.forwardRef<HTMLTextAreaElement, ChatInputPresetProps>(
  function CodexChatInput(
    {
      onSend,
      onStop,
      isRunning,
      isQueued,
      tokenUsage: _tokenUsage,
      onCancelQueue,
      prefill,
      lastUserMessage,
      onEditLastMessage,
      initialDraft,
      onDraftChange,
      agentLibs: _agentLibs,
      selectedAgentLib: _selectedAgentLib,
      onAgentLibChange: _onAgentLibChange,
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
      images, setImages, fileInputRef,
      addImageFile, handlePaste, handleDrop, handleDragOver, removeImage,
    } = useImageInput();
    const textareaRef = useRef<HTMLTextAreaElement>(null);

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

    const isOverLimit = value.length > MAX_MESSAGE_LENGTH;
    const canSend = (value.trim() || images.length > 0) && !isOverLimit;

    const handleAttachClick = () => { fileInputRef.current?.click(); };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;
      for (const file of Array.from(files)) { addImageFile(file); }
      e.target.value = '';
    };

    // Dropdown select style helper
    const selectStyle: React.CSSProperties = {
      background: 'transparent',
      color: '#9ca3af',
      border: 'none',
      borderRadius: 0,
      fontFamily: SANS,
      fontSize: '0.85em',
      padding: '2px 14px 2px 0',
      cursor: 'pointer',
      outline: 'none',
      appearance: 'none',
      WebkitAppearance: 'none',
      backgroundImage: DROPDOWN_CHEVRON,
      backgroundRepeat: 'no-repeat',
      backgroundPosition: 'right 0 center',
    };

    const isWarning = permissionMode === 'full_access' || !permissionMode;
    const permModeLabel = getPermModeLabel(permissionMode);

    return (
      <div style={{ padding: '0 16px 0', backgroundColor: '#141414' }}>
        {/* Image preview strip */}
        <ImagePreviewStrip
          images={images}
          setImages={setImages}
          removeImage={removeImage}
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

        <form onSubmit={handleSubmit} onDrop={handleDrop} onDragOver={handleDragOver}>
          {/* ── Input container (Row 1 + Row 2) ── */}
          <div style={{
            borderRadius: 22,
            border: `1px solid ${BORDER}`,
            backgroundColor: BG_INPUT,
            overflow: 'hidden',
          }}>
            {/* Row 1: Textarea */}
            <textarea
              ref={mergedRef}
              value={value}
              onChange={(e) => setValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              rows={2}
              placeholder={isRunning ? 'Type a message (will be queued)…' : 'Ask for follow-up changes'}
              style={{
                display: 'block',
                width: '100%',
                resize: 'none',
                backgroundColor: 'transparent',
                color: '#e5e7eb',
                fontFamily: SANS,
                fontSize: '0.95em',
                lineHeight: '22px',
                border: 'none',
                outline: 'none',
                minHeight: 60,
                maxHeight: 200,
                overflowY: 'auto',
                padding: '16px 18px',
                boxSizing: 'border-box',
              }}
            />

            {/* Row 2: Controls */}
            <div style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '6px 14px',
              marginTop: 0,
              borderTop: '1px solid rgba(255,255,255,0.05)',
            }}>
              {/* Left controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                {/* Attachment button */}
                <button
                  type="button"
                  onClick={handleAttachClick}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#666',
                    cursor: 'pointer',
                    borderRadius: 0,
                    padding: '4px 6px',
                    fontSize: '1.1em',
                    fontFamily: SANS,
                    display: 'flex',
                    alignItems: 'center',
                  }}
                  title="Attach image"
                >
                  +
                </button>

                {/* Model selector */}
                {models && models.length > 0 && onModelChange && (
                  <select
                    value={selectedModel || ''}
                    onChange={(e) => onModelChange(e.target.value)}
                    style={selectStyle}
                    title="Model"
                  >
                    {models.map((m) => (
                      <option key={m.value} value={m.value}>{m.label}</option>
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
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>

                {/* Engine selector removed — real Codex does not have it in the input area */}
              </div>

              {/* Right controls */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {/* Queued indicator */}
                {isQueued && (
                  <span style={{ fontFamily: SANS, fontSize: '0.8em', color: ACCENT }}>
                    queued
                    {onCancelQueue && (
                      <button
                        type="button"
                        onClick={onCancelQueue}
                        style={{
                          background: 'transparent', border: 'none', color: ACCENT,
                          cursor: 'pointer', fontSize: '1em', marginLeft: 4,
                        }}
                        title="Cancel queue"
                      >×</button>
                    )}
                  </span>
                )}

                {isOverLimit && (
                  <span style={{ fontFamily: SANS, fontSize: '0.75em', color: '#ef4444' }}>
                    {value.length.toLocaleString()}/{MAX_MESSAGE_LENGTH.toLocaleString()}
                  </span>
                )}

                {/* Stop button */}
                {isRunning && onStop && (
                  <button
                    type="button"
                    onClick={onStop}
                    style={{
                      background: 'transparent',
                      border: `1px solid ${isQueued ? ACCENT : '#ef4444'}`,
                      color: isQueued ? ACCENT : '#ef4444',
                      cursor: 'pointer',
                      borderRadius: 6,
                      padding: '3px 8px',
                      fontSize: '0.85em',
                      fontFamily: SANS,
                    }}
                    title={isQueued ? 'Stop & send queued' : 'Stop'}
                  >
                    {isQueued ? '⚡' : '■'}
                  </button>
                )}

                {/* Mic button (visual-only) */}
                <button
                  type="button"
                  disabled
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: '#555',
                    cursor: 'default',
                    fontSize: '1em',
                    opacity: 1,
                    padding: '6px 8px',
                  }}
                  title="Voice input (coming soon)"
                >🎤</button>

                {/* Send button (amber circle) */}
                <button
                  type="submit"
                  disabled={!canSend}
                  style={{
                    background: canSend ? ACCENT : 'transparent',
                    border: canSend ? 'none' : '1px solid #444',
                    color: canSend ? '#fff' : '#555',
                    cursor: canSend ? 'pointer' : 'default',
                    borderRadius: '50%',
                    width: 32,
                    height: 32,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '1.1em',
                    lineHeight: 1,
                    flexShrink: 0,
                    transition: 'background 0.15s, color 0.15s',
                  }}
                  title="Send message"
                >↑</button>
              </div>
            </div>
          </div>
        </form>

        {/* ── Row 3: Status bar ── */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '6px 14px 8px',
          borderTop: '1px solid #1a1a1a',
          fontFamily: SANS,
          fontSize: '0.75em',
          color: '#888',
        }}>
          {/* Left: Local + Permission */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* Local indicator */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <span>▪</span>
              <span>Local ∨</span>
            </div>

            {/* Permission mode */}
            {onPermissionModeChange ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: isWarning ? ACCENT : '#888' }}>⚠️</span>
                <select
                  value={permissionMode || 'full_access'}
                  onChange={(e) => onPermissionModeChange(e.target.value as PermissionMode)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: isWarning ? ACCENT : '#888',
                    fontFamily: SANS,
                    fontSize: '1em',
                    cursor: 'pointer',
                    outline: 'none',
                    appearance: 'none',
                    WebkitAppearance: 'none',
                    paddingRight: 14,
                    backgroundImage: DROPDOWN_CHEVRON,
                    backgroundRepeat: 'no-repeat',
                    backgroundPosition: 'right 0 center',
                  }}
                  title="Permission mode"
                >
                  {PERMISSION_MODE_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: isWarning ? ACCENT : '#888' }}>⚠️</span>
                <span style={{ color: isWarning ? ACCENT : '#888' }}>{permModeLabel}</span>
              </div>
            )}
          </div>

          {/* Right: Branch indicator */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <span>⎇</span>
            <span>main ∨</span>
          </div>
        </div>
      </div>
    );
  },
);

CodexChatInput.displayName = 'CodexChatInput';
