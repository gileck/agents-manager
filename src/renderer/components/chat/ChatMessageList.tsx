import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useAutoScroll } from './hooks/useAutoScroll';
import { useNavigate } from 'react-router-dom';
import { Pencil, ChevronDown, ChevronRight, Play, AlertTriangle, ShieldCheck, ShieldX, Bell, Bot, CheckCircle2, Terminal, Copy, Check } from 'lucide-react';
import type { AgentChatMessage, AgentChatMessageToolUse, AgentChatMessageToolResult, AgentChatMessageUser, AgentChatMessageStatus, AgentChatMessageAskUserQuestion, AgentChatMessagePermissionRequest, AgentChatMessagePermissionResponse, AgentChatMessageNotification, AgentChatMessageSubagentActivity, AgentChatMessageSlashCommand, ChatImageRef } from '../../../shared/types';
import { MarkdownContent } from './MarkdownContent';
import { ThinkingBlock } from './ThinkingBlock';
import { getToolRenderer } from '../tool-renderers';
import { AgentRunInfoCard } from './AgentRunInfoCard';
import { ThinkingGroup } from './ThinkingGroup';
import { AgentBlock } from './AgentBlock';
import { AskUserQuestionCard } from './AskUserQuestionCard';
import { useChatActions } from './ChatActionsContext';
import { ImageAnnotationPanel } from '../ui/ImageAnnotationPanel';
import type { AnnotationImage } from '../ui/ImageAnnotationPanel';
import { groupMessages } from './utils/group-messages';
export type { AgentSegment } from './utils/group-messages';

interface ChatMessageListProps {
  messages: AgentChatMessage[];
  isRunning?: boolean;
  isWaitingForInput?: boolean;
  onEditMessage?: (text: string) => void;
  onResume?: (text: string) => void;
  onPermissionResponse?: (requestId: string, allowed: boolean) => void;
}

/** Real-time elapsed time display, updates every second. */
function ElapsedTime({ startedAt }: { startedAt: number }) {
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, []);

  const elapsed = Math.floor((now - startedAt) / 1000);
  const minutes = Math.floor(elapsed / 60);
  const seconds = elapsed % 60;

  if (minutes > 0) {
    return <span className="text-xs text-muted-foreground tabular-nums">{minutes}m {seconds}s</span>;
  }
  return <span className="text-xs text-muted-foreground tabular-nums">{seconds}s</span>;
}

/** Error details card with copy button and expandable stack trace. */
function ErrorDetails({ message, stack }: { message: string; stack?: string }) {
  const [copied, setCopied] = useState(false);
  const [showStack, setShowStack] = useState(false);

  const handleCopy = useCallback(() => {
    const text = stack ? `${message}\n\n${stack}` : message;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [message, stack]);

  return (
    <div className="max-w-[80%] w-full text-xs border border-red-200 dark:border-red-800/40 rounded-lg overflow-hidden bg-red-50 dark:bg-red-950/20">
      <div className="flex items-start gap-2 px-3 py-2">
        <span className="flex-1 text-red-600 dark:text-red-400 whitespace-pre-wrap break-words">{message}</span>
        <button
          type="button"
          onClick={handleCopy}
          className="flex-shrink-0 flex items-center gap-1 px-2 py-1 rounded text-red-500 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
          title="Copy error"
        >
          {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
          <span>{copied ? 'Copied' : 'Copy'}</span>
        </button>
      </div>
      {stack && (
        <>
          <button
            type="button"
            onClick={() => setShowStack(s => !s)}
            className="flex items-center gap-1 w-full px-3 py-1.5 text-red-500/70 dark:text-red-400/60 hover:bg-red-100/50 dark:hover:bg-red-900/20 transition-colors border-t border-red-200/60 dark:border-red-800/30"
          >
            <ChevronRight className={`h-3 w-3 transition-transform ${showStack ? 'rotate-90' : ''}`} />
            <span>Stack Trace</span>
          </button>
          {showStack && (
            <pre className="px-3 py-2 text-red-600/80 dark:text-red-400/70 whitespace-pre-wrap break-words max-h-48 overflow-y-auto border-t border-red-200/60 dark:border-red-800/30 font-mono text-[11px] leading-relaxed">
              {stack}
            </pre>
          )}
        </>
      )}
    </div>
  );
}

/** Small copy-to-clipboard button. */
function CopyButton({ text, label }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [text]);
  return (
    <button
      type="button"
      onClick={handleCopy}
      className="flex items-center gap-1 px-2 py-1 text-xs rounded hover:bg-muted/60 text-muted-foreground hover:text-foreground transition-colors"
      title={label || 'Copy'}
    >
      {copied ? <Check className="h-3 w-3" /> : <Copy className="h-3 w-3" />}
      <span>{copied ? 'Copied' : (label || 'Copy')}</span>
    </button>
  );
}

/** Collapsed system notification with one-line summary and expand toggle. */
function CollapsedSystemNotification({ title, text }: { title?: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const summary = text.length > 100 ? text.slice(0, 100).trimEnd() + '…' : text;

  return (
    <div className="my-2 rounded-lg border text-sm" style={{ borderColor: 'hsl(var(--primary) / 0.3)', backgroundColor: 'hsl(var(--primary) / 0.04)' }}>
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex items-center gap-2 w-full px-3 py-2 text-left"
      >
        <Bell className="h-4 w-4 text-primary flex-shrink-0" />
        <span className="font-medium text-foreground flex-shrink-0">{title || 'System Notification'}</span>
        {!expanded && (
          <span className="text-muted-foreground overflow-hidden text-ellipsis whitespace-nowrap flex-1 min-w-0">
            {summary}
          </span>
        )}
        <ChevronRight className={`h-3.5 w-3.5 text-muted-foreground flex-shrink-0 ml-auto transition-transform ${expanded ? 'rotate-90' : ''}`} />
      </button>
      {expanded && (
        <div className="px-3 pb-2 pl-9 text-muted-foreground whitespace-pre-wrap break-words">
          {text}
        </div>
      )}
    </div>
  );
}

export function ChatMessageList({ messages, isRunning, isWaitingForInput: isWaitingForInputProp, onEditMessage, onResume, onPermissionResponse }: ChatMessageListProps) {
  const { containerRef, endRef, autoScroll, handleScroll, scrollToLatest } = useAutoScroll({ messagesLength: messages.length });
  const navigate = useNavigate();
  const { answerQuestion } = useChatActions();
  const [expandedTools, setExpandedTools] = useState<Set<number>>(new Set());
  const [viewerImages, setViewerImages] = useState<AnnotationImage[] | null>(null);
  const [viewerIndex, setViewerIndex] = useState(0);

  // Track when the agent started running for elapsed time display
  const [startedAt, setStartedAt] = useState<number | null>(null);
  const prevIsRunning = useRef(false);
  useEffect(() => {
    if (isRunning && !prevIsRunning.current) {
      setStartedAt(Date.now());
    } else if (!isRunning && prevIsRunning.current) {
      setStartedAt(null);
    }
    prevIsRunning.current = !!isRunning;
  }, [isRunning]);

  const toggleTool = useCallback((index: number) => {
    setExpandedTools((prev) => {
      const next = new Set(prev);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  }, []);

  const segments = useMemo(() => groupMessages(messages), [messages]);

  // isWaitingForInput comes from useChat via props — single source of truth
  const isWaitingForInput = isWaitingForInputProp ?? false;

  const rendered = useMemo(() => {
    // Pre-build toolId → toolResult map for top-level (ungrouped) tool calls
    const resultMap = new Map<string, AgentChatMessageToolResult>();
    for (const msg of messages) {
      if (msg.type === 'tool_result' && msg.toolId) {
        resultMap.set(msg.toolId, msg as AgentChatMessageToolResult);
      }
    }
    const matchedResultIds = new Set<string>();

    const nodes: React.ReactNode[] = [];

    for (const segment of segments) {
      if (segment.type === 'agent') {
        nodes.push(
          <AgentBlock
            key={`agent-${segment.startIndex}`}
            segment={segment}
            expandedTools={expandedTools}
            onToggleTool={toggleTool}
            sessionRunning={isRunning}
            isWaitingForInput={isWaitingForInput}
          />
        );
        continue;
      }

      if (segment.type === 'group') {
        nodes.push(
          <ThinkingGroup
            key={`group-${segment.startIndex}`}
            messages={segment.messages}
            startIndex={segment.startIndex}
            expandedTools={expandedTools}
            onToggleTool={toggleTool}
          />
        );
        continue;
      }

      const { msg, index: i } = segment;

      if (msg.type === 'assistant_text') {
        nodes.push(
          <div key={i} className="py-2.5 max-w-none prose-sm leading-7 text-foreground/95">
            <MarkdownContent content={msg.text} />
          </div>
        );
      } else if (msg.type === 'tool_use') {
        // Top-level tool_use (not inside a group) – kept for completeness
        const toolUse = msg as AgentChatMessageToolUse;
        const toolResult = toolUse.toolId ? resultMap.get(toolUse.toolId) : undefined;
        if (toolResult?.toolId) matchedResultIds.add(toolResult.toolId);
        const Renderer = getToolRenderer(toolUse.toolName);
        nodes.push(
          <Renderer
            key={i}
            toolUse={toolUse}
            toolResult={toolResult}
            expanded={expandedTools.has(i)}
            onToggle={() => toggleTool(i)}
          />
        );
      } else if (msg.type === 'tool_result') {
        const result = msg as AgentChatMessageToolResult;
        if (result.toolId && matchedResultIds.has(result.toolId)) continue;
        nodes.push(
          <div key={i} className="border border-border rounded p-2 my-2 text-xs">
            <span className="text-muted-foreground">Tool result:</span>
            <pre className="mt-1 overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto">
              {result.result.length > 2000 ? result.result.slice(0, 2000) + '\n...' : result.result}
            </pre>
          </div>
        );
      } else if (msg.type === 'user') {
        const msgText = msg.text;
        nodes.push(
          <div key={i} className="flex justify-end items-end py-2.5 group/msg">
            {onEditMessage && (
              <button
                type="button"
                disabled={isRunning}
                onClick={() => onEditMessage(msgText)}
                className="self-center mr-2 opacity-0 group-hover/msg:opacity-100 transition-opacity p-1.5 rounded-full hover:bg-muted/55 text-muted-foreground hover:text-foreground disabled:pointer-events-none"
                title="Edit & resend"
              >
                <Pencil className="h-3.5 w-3.5" />
              </button>
            )}
            <div className="bg-primary/90 text-primary-foreground rounded-2xl rounded-br-md px-4 py-2.5 max-w-[82%] shadow-[0_8px_18px_hsl(var(--primary)/0.24)]">
              <p className="leading-relaxed whitespace-pre-wrap">{msg.text}</p>
              {msg.images && msg.images.length > 0 && (
                <div className="flex gap-2 mt-2 flex-wrap">
                  {msg.images.map((img: ChatImageRef, j: number) => (
                    <img
                      key={j}
                      src={`/api/chat/images?path=${encodeURIComponent(img.path)}`}
                      alt={img.name || 'Attached image'}
                      className="rounded border border-primary-foreground/20 object-cover cursor-pointer"
                      style={{ maxHeight: 192, maxWidth: 256 }}
                      onClick={() => {
                        const annotationImages = msg.images!.map((im: ChatImageRef) => ({
                          src: `/api/chat/images?path=${encodeURIComponent(im.path)}`,
                          name: im.name,
                        }));
                        setViewerImages(annotationImages);
                        setViewerIndex(j);
                      }}
                      onError={(e) => {
                        const el = e.target as HTMLImageElement;
                        el.style.display = 'none';
                        const placeholder = document.createElement('span');
                        placeholder.className = 'text-xs opacity-60';
                        placeholder.textContent = `Image unavailable: ${img.name || 'file removed'}`;
                        el.parentElement?.appendChild(placeholder);
                      }}
                    />
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      } else if (msg.type === 'thinking') {
        nodes.push(
          <ThinkingBlock key={i} text={msg.text} />
        );
      } else if (msg.type === 'status') {
        const isStopped = msg.status === 'cancelled';
        const isError = msg.status === 'failed' || msg.status === 'timed_out';

        if (isStopped || isError) {
          const lastUserMsg = [...messages].reverse().find((m): m is AgentChatMessageUser => m.type === 'user');
          const lastUserText = lastUserMsg?.text ?? null;
          const label = isStopped ? 'Agent Stopped' : msg.status === 'timed_out' ? 'Agent Timed Out' : 'Agent Error';
          const statusMsg = msg as AgentChatMessageStatus;

          nodes.push(
            <div key={i} className="flex flex-col items-center py-4 gap-3">
              <div className={`flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full font-medium ${
                isError
                  ? 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-800/50'
                  : 'text-muted-foreground/80 bg-muted/35 border border-border/60'
              }`}>
                {isError && <AlertTriangle className="h-3 w-3" />}
                {label}
              </div>
              {(isError || isStopped) && statusMsg.message && (
                <ErrorDetails message={statusMsg.message} stack={statusMsg.stack} />
              )}
              {!isRunning && (
                <div className="flex gap-2">
                  {onResume && (
                    <button
                      type="button"
                      onClick={() => onResume(lastUserText ?? 'continue')}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                    >
                      <Play className="h-3 w-3" />
                      {lastUserText ? 'Continue' : 'Retry'}
                    </button>
                  )}
                  {onEditMessage && lastUserText && (
                    <button
                      type="button"
                      onClick={() => onEditMessage(lastUserText)}
                      className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md border border-border bg-background hover:bg-accent transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                      Edit & Retry
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        } else if (msg.message?.startsWith('[Conversation Summary]')) {
          nodes.push(
            <div key={i} className="py-2.5 max-w-none prose-sm leading-7 text-foreground/95">
              <div className="flex justify-end mb-1">
                <CopyButton text={msg.message} label="Copy Summary" />
              </div>
              <MarkdownContent content={msg.message} />
            </div>
          );
        } else {
          nodes.push(
            <div key={i} className="text-center py-3">
              <span className="text-xs text-muted-foreground/80 bg-muted/35 border border-border/60 px-3 py-1 rounded-full">
                {msg.message}
              </span>
            </div>
          );
        }
      } else if (msg.type === 'agent_run_info') {
        nodes.push(
          <div key={i} className="py-1.5">
            {msg.agentRunId ? (
              <AgentRunInfoCard
                agentRunId={msg.agentRunId}
                taskId={msg.taskId}
                agentType={msg.agentType}
              />
            ) : (
              <button
                className="text-xs text-muted-foreground hover:text-foreground transition-colors cursor-pointer border border-border/70 rounded-full px-2 py-1 hover:bg-accent/60"
                onClick={() => navigate(`/agents/${msg.agentRunId}`)}
              >
                Agent Run &middot; View details &rarr;
              </button>
            )}
          </div>
        );
      } else if (msg.type === 'compact_boundary') {
        // Find the conversation summary text that follows this compact boundary
        const summaryMsg = messages.slice(i + 1).find(m => m.type === 'assistant_text' && m.text.startsWith('[Conversation Summary]'));
        const summaryText = summaryMsg?.type === 'assistant_text' ? summaryMsg.text : undefined;
        nodes.push(
          <div key={i} className="flex justify-center items-center gap-2 py-3">
            <span className="text-xs font-medium px-3 py-1 rounded-full border" style={{ borderColor: '#f59e0b', color: '#f59e0b', backgroundColor: 'rgba(245, 158, 11, 0.08)' }}>
              Context compacted &middot; {msg.trigger} &middot; {msg.preTokens.toLocaleString()} tokens before
            </span>
            {summaryText && <CopyButton text={summaryText} label="Copy Summary" />}
          </div>
        );
      } else if (msg.type === 'ask_user_question') {
        const askMsg = msg as AgentChatMessageAskUserQuestion;
        nodes.push(
          <AskUserQuestionCard key={i} message={askMsg} onAnswer={answerQuestion} />
        );
      } else if (msg.type === 'compacting' && msg.active) {
        // Only show if no later compacting message supersedes this one
        const hasLaterCompacting = messages.slice(i + 1).some(m => m.type === 'compacting');
        if (!hasLaterCompacting) {
          nodes.push(
            <div key={i} className="flex items-center justify-center gap-2 py-3 text-muted-foreground text-sm">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f59e0b' }} />
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f59e0b', animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 rounded-full animate-pulse" style={{ backgroundColor: '#f59e0b', animationDelay: '0.4s' }} />
              </div>
              <span className="text-xs" style={{ color: '#f59e0b' }}>Compacting context...</span>
            </div>
          );
        }
      }
      else if (msg.type === 'permission_request') {
        const permReq = msg as AgentChatMessagePermissionRequest;
        // Check if this request has already been responded to
        const hasResponse = messages.some(m => m.type === 'permission_response' && (m as AgentChatMessagePermissionResponse).requestId === permReq.requestId);
        const responseMsg = hasResponse
          ? messages.find(m => m.type === 'permission_response' && (m as AgentChatMessagePermissionResponse).requestId === permReq.requestId) as AgentChatMessagePermissionResponse | undefined
          : undefined;

        nodes.push(
          <div key={i} className="my-3 border rounded-lg overflow-hidden" style={{ borderColor: '#f59e0b' }}>
            <div className="flex items-center gap-2 px-3 py-2 text-sm font-medium" style={{ backgroundColor: 'rgba(245, 158, 11, 0.08)', color: '#f59e0b' }}>
              <ShieldCheck className="h-4 w-4" />
              Tool Permission Request
            </div>
            <div className="px-3 py-2 text-sm">
              <p className="font-medium text-foreground">{permReq.toolName}</p>
              <pre className="mt-1 text-xs text-muted-foreground overflow-x-auto whitespace-pre-wrap max-h-32 overflow-y-auto bg-muted/30 rounded p-2">
                {typeof permReq.toolInput === 'string' ? permReq.toolInput : JSON.stringify(permReq.toolInput, null, 2).slice(0, 2000)}
              </pre>
            </div>
            {hasResponse ? (
              <div className={`flex items-center gap-2 px-3 py-2 text-xs font-medium ${responseMsg?.allowed ? 'text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-950/20' : 'text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20'}`}>
                {responseMsg?.allowed ? <ShieldCheck className="h-3.5 w-3.5" /> : <ShieldX className="h-3.5 w-3.5" />}
                {responseMsg?.allowed ? 'Allowed' : 'Denied'}
              </div>
            ) : (
              <div className="flex gap-2 px-3 py-2 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => onPermissionResponse?.(permReq.requestId, true)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-green-600 text-white hover:bg-green-700 transition-colors"
                >
                  <ShieldCheck className="h-3 w-3" />
                  Allow
                </button>
                <button
                  type="button"
                  onClick={() => onPermissionResponse?.(permReq.requestId, false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-md bg-red-600 text-white hover:bg-red-700 transition-colors"
                >
                  <ShieldX className="h-3 w-3" />
                  Deny
                </button>
              </div>
            )}
          </div>
        );
      } else if (msg.type === 'permission_response') {
        // Standalone permission_response (rendered inline with the request above — skip duplicate)
      } else if (msg.type === 'notification') {
        const notif = msg as AgentChatMessageNotification;
        const isSystemNotification = notif.body?.startsWith('[System Notification]');

        if (isSystemNotification) {
          const displayText = notif.body.replace(/^\[System Notification\]\s*/, '');
          nodes.push(
            <CollapsedSystemNotification key={i} title={notif.title} text={displayText} />,
          );
        } else {
          nodes.push(
            <div key={i} className="flex items-start gap-2 my-2 px-3 py-2 text-sm rounded-lg border" style={{ borderColor: 'hsl(var(--primary) / 0.3)', backgroundColor: 'hsl(var(--primary) / 0.04)' }}>
              <Bell className="h-4 w-4 mt-0.5 text-primary flex-shrink-0" />
              <div>
                {notif.title && <p className="font-medium text-foreground">{notif.title}</p>}
                <p className="text-muted-foreground">{notif.body}</p>
              </div>
            </div>
          );
        }
      } else if (msg.type === 'subagent_activity') {
        const activity = msg as AgentChatMessageSubagentActivity;
        const isStarted = activity.status === 'started';
        nodes.push(
          <div key={i} className="flex items-center gap-2 my-2 px-3 py-2 text-sm rounded-lg border" style={{ borderColor: isStarted ? '#8b5cf6' : '#22c55e', backgroundColor: isStarted ? 'rgba(139, 92, 246, 0.06)' : 'rgba(34, 197, 94, 0.06)' }}>
            {isStarted
              ? <Bot className="h-4 w-4 flex-shrink-0" style={{ color: '#8b5cf6' }} />
              : <CheckCircle2 className="h-4 w-4 flex-shrink-0" style={{ color: '#22c55e' }} />
            }
            <span style={{ color: isStarted ? '#8b5cf6' : '#22c55e' }} className="font-medium">
              {activity.agentName}
            </span>
            <span className="text-muted-foreground">
              {isStarted ? 'started' : 'completed'}
            </span>
          </div>
        );
      } else if (msg.type === 'slash_command') {
        const slashCmd = msg as AgentChatMessageSlashCommand;
        nodes.push(
          <div key={i} className="flex items-center gap-2 my-2 px-3 py-2 text-sm rounded-lg border" style={{ borderColor: '#6366f1', backgroundColor: 'rgba(99, 102, 241, 0.06)' }}>
            <Terminal className="h-4 w-4 flex-shrink-0" style={{ color: '#6366f1' }} />
            <span className="font-mono font-medium" style={{ color: '#6366f1' }}>{slashCmd.command}</span>
            {slashCmd.args && <span className="text-muted-foreground">{slashCmd.args}</span>}
            <span className="text-muted-foreground text-xs ml-auto">
              {slashCmd.status === 'completed' ? 'completed' : 'running...'}
            </span>
          </div>
        );
      }
      // usage messages are skipped
    }
    return nodes;
  }, [segments, messages, expandedTools, toggleTool, onEditMessage, onResume, onPermissionResponse, isRunning, navigate, answerQuestion]);

  return (
    <div className="relative flex-1 min-h-0">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto"
        style={{ overflowAnchor: 'auto' }}
        onScroll={handleScroll}
      >
        <div className="mx-auto w-full max-w-[980px] px-4 py-6">
          {rendered.length === 0 && isRunning && !isWaitingForInput && (
            <div className="flex items-center justify-center py-12 text-muted-foreground text-sm gap-2">
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" />
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
              <div className="w-1.5 h-1.5 bg-primary rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
              {startedAt && <ElapsedTime startedAt={startedAt} />}
            </div>
          )}
          {rendered}
          {isRunning && rendered.length > 0 && !isWaitingForInput && (
            <div className="flex items-center gap-2 py-3 text-muted-foreground text-sm">
              <div className="flex gap-1">
                <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse" />
                <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '0.2s' }} />
                <div className="w-1.5 h-1.5 bg-primary/60 rounded-full animate-pulse" style={{ animationDelay: '0.4s' }} />
              </div>
              <span className="text-xs">Thinking...</span>
              {startedAt && <ElapsedTime startedAt={startedAt} />}
            </div>
          )}
          <div ref={endRef} style={{ overflowAnchor: 'none' }} />
        </div>
      </div>

      {!autoScroll && (
        <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-10">
          <button
            type="button"
            onClick={scrollToLatest}
            className="flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-medium px-3.5 py-1.5 rounded-full shadow-lg hover:bg-primary/90 transition-colors"
          >
            <ChevronDown className="h-3.5 w-3.5" />
            Back to latest
          </button>
        </div>
      )}

      {viewerImages && (
        <ImageAnnotationPanel
          images={viewerImages}
          initialIndex={viewerIndex}
          onClose={() => setViewerImages(null)}
          readOnly
        />
      )}
    </div>
  );
}
