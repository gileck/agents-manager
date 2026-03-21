/**
 * Claude Code preset — SessionTabs.
 *
 * Minimal terminal-styled tab bar with monospace font, dark background,
 * and subtle active tab highlighting.
 */

import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import type { SessionTabsPresetProps } from '../types';
import type { RunningAgent } from '../../../../../shared/types';

export function ClaudeCodeSessionTabs({
  sessions,
  currentSessionId,
  activeAgents,
  onSessionChange,
  onSessionCreate,
  onSessionRename,
  onSessionDelete,
}: SessionTabsPresetProps) {
  const [renameId, setRenameId] = useState<string | null>(null);
  const [renameName, setRenameName] = useState('');
  const [ctxMenuId, setCtxMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState({ top: 0, left: 0 });
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setCtxMenuId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleNew = () => onSessionCreate(`Session ${sessions.length + 1}`);

  const handleRename = () => {
    if (renameId && renameName.trim()) {
      onSessionRename(renameId, renameName.trim());
      setRenameId(null);
    }
  };

  const getAgentStatus = (sessionId: string) => {
    const sa = activeAgents.filter((a: RunningAgent) => a.sessionId === sessionId);
    return {
      running: sa.filter((a: RunningAgent) => a.status === 'running').length,
      waiting: sa.filter((a: RunningAgent) => a.status === 'waiting_for_input').length,
      completed: sa.filter((a: RunningAgent) => a.status === 'completed').length,
    };
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 2, fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace', fontSize: '0.923em' }}>
      {sessions.map((s) => {
        const active = s.id === currentSessionId;
        const { running, waiting, completed } = getAgentStatus(s.id);
        return (
          <div
            key={s.id}
            onClick={() => onSessionChange(s.id)}
            onContextMenu={(e) => {
              e.preventDefault();
              setMenuPos({ top: e.clientY, left: e.clientX });
              setCtxMenuId(s.id);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              padding: '4px 10px',
              cursor: 'pointer',
              borderRadius: 4,
              backgroundColor: active ? 'rgba(255,255,255,0.08)' : 'transparent',
              color: active ? '#e5e7eb' : '#6b7280',
              borderBottom: active ? '2px solid #6366f1' : '2px solid transparent',
              transition: 'background-color 0.15s, color 0.15s',
            }}
          >
            {running > 0 && (
              <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', backgroundColor: '#3b82f6', animation: 'pulse 1.5s infinite' }} />
            )}
            {waiting > 0 && running === 0 && (
              <span style={{ color: '#f59e0b', fontSize: '0.85em', fontWeight: 700 }}>?</span>
            )}
            {completed > 0 && running === 0 && waiting === 0 && (
              <span style={{ color: '#22c55e', fontSize: '0.77em' }}>✓</span>
            )}
            {renameId === s.id ? (
              <form
                onSubmit={(e) => { e.preventDefault(); handleRename(); }}
                style={{ display: 'inline' }}
              >
                <input
                  value={renameName}
                  onChange={(e) => setRenameName(e.target.value)}
                  onBlur={handleRename}
                  autoFocus
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: 'transparent',
                    border: '1px solid #4b5563',
                    color: '#e5e7eb',
                    fontSize: '1em',
                    fontFamily: 'inherit',
                    width: 80,
                    padding: '1px 4px',
                    borderRadius: 2,
                    outline: 'none',
                  }}
                />
              </form>
            ) : (
              <span
                style={{ maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setRenameId(s.id);
                  setRenameName(s.name);
                }}
              >
                {s.name}
              </span>
            )}
            {sessions.length > 1 && (
              <span
                onClick={(e) => { e.stopPropagation(); onSessionDelete(s.id); }}
                style={{ opacity: 0.4, cursor: 'pointer', fontSize: '0.77em', lineHeight: 1 }}
                title="Close"
              >
                ×
              </span>
            )}
          </div>
        );
      })}

      <button
        onClick={handleNew}
        style={{
          background: 'transparent',
          border: '1px solid #374151',
          color: '#6b7280',
          cursor: 'pointer',
          fontSize: '1.077em',
          padding: '2px 8px',
          borderRadius: 4,
          lineHeight: 1,
        }}
        title="New session"
      >
        +
      </button>

      {ctxMenuId && createPortal(
        <div
          ref={menuRef}
          style={{
            position: 'fixed',
            top: menuPos.top,
            left: menuPos.left,
            backgroundColor: '#1f2937',
            border: '1px solid #374151',
            borderRadius: 6,
            padding: 4,
            zIndex: 9999,
            minWidth: 120,
            fontFamily: 'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace',
            fontSize: '0.923em',
          }}
        >
          <button
            onClick={() => {
              setRenameId(ctxMenuId);
              setRenameName(sessions.find((s) => s.id === ctxMenuId)?.name ?? '');
              setCtxMenuId(null);
            }}
            style={{
              display: 'block', width: '100%', textAlign: 'left',
              padding: '4px 8px', background: 'transparent', border: 'none',
              color: '#d1d5db', cursor: 'pointer',
            }}
          >
            Rename
          </button>
          {sessions.length > 1 && (
            <button
              onClick={() => { onSessionDelete(ctxMenuId); setCtxMenuId(null); }}
              style={{
                display: 'block', width: '100%', textAlign: 'left',
                padding: '4px 8px', background: 'transparent', border: 'none',
                color: '#ef4444', cursor: 'pointer',
              }}
            >
              Delete
            </button>
          )}
        </div>,
        document.body,
      )}
    </div>
  );
}
