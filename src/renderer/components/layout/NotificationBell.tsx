import React, { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { Button } from '../ui/button';
import { ScrollArea } from '../ui/scroll-area';
import { useNotifications } from '../../hooks/useNotifications';
import { useCurrentProject } from '../../contexts/CurrentProjectContext';
import type { InAppNotification } from '../../../shared/types';

const utilityButtonClass =
  'h-9 rounded-full border border-border/70 bg-card/65 hover:bg-accent/70 text-muted-foreground hover:text-foreground';

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const minutes = Math.floor(diff / 60_000);
  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function NotificationBell() {
  const { currentProjectId } = useCurrentProject();
  const { notifications, unreadCount, markRead, markAllRead } = useNotifications(currentProjectId ?? undefined);
  const [panelOpen, setPanelOpen] = useState(false);
  const navigate = useNavigate();
  const containerRef = useRef<HTMLDivElement>(null);

  // Close panel on click outside
  useEffect(() => {
    if (!panelOpen) return;
    const handleMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setPanelOpen(false);
      }
    };
    document.addEventListener('mousedown', handleMouseDown);
    return () => document.removeEventListener('mousedown', handleMouseDown);
  }, [panelOpen]);

  const handleNotificationClick = async (notification: InAppNotification) => {
    await markRead(notification.id);
    setPanelOpen(false);
    navigate(notification.navigationUrl);
  };

  return (
    <div ref={containerRef} className="relative">
      <Button
        variant="ghost"
        size="icon"
        onClick={() => setPanelOpen(prev => !prev)}
        title="Notifications"
        className={utilityButtonClass}
      >
        <div className="relative">
          <Bell className="h-4 w-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 h-4 min-w-4 rounded-full bg-destructive text-destructive-foreground text-[10px] flex items-center justify-center px-0.5 font-medium">
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </div>
      </Button>

      {panelOpen && (
        <div className="absolute right-0 top-full mt-1 z-50 w-80 max-h-[480px] bg-card border border-border rounded-lg shadow-lg overflow-hidden flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-border shrink-0">
            <span className="text-sm font-medium">Notifications</span>
            {unreadCount > 0 && (
              <button
                onClick={markAllRead}
                className="text-xs text-muted-foreground hover:text-foreground transition-colors"
              >
                Mark all read
              </button>
            )}
          </div>

          <ScrollArea className="flex-1">
            {notifications.length === 0 ? (
              <div className="flex items-center justify-center h-24 text-sm text-muted-foreground">
                No notifications
              </div>
            ) : (
              <div className="py-1">
                {notifications.map(notification => (
                  <button
                    key={notification.id}
                    onClick={() => handleNotificationClick(notification)}
                    className={`w-full text-left px-3 py-2.5 hover:bg-accent/50 transition-colors border-l-2 ${
                      notification.read ? 'border-transparent' : 'border-primary bg-accent/30'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <span className={`text-xs font-medium truncate flex-1 ${notification.read ? 'text-foreground' : 'text-foreground font-semibold'}`}>
                        {notification.title}
                      </span>
                      <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                        {formatRelativeTime(notification.createdAt)}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2 text-left">
                      {notification.body}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>
      )}
    </div>
  );
}
