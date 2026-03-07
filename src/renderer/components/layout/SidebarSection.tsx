import React, { useState, ReactNode } from 'react';
import { ChevronRight } from 'lucide-react';
import { cn } from '../../lib/utils';

interface SidebarSectionProps {
  title: string;
  storageKey: string;
  children: ReactNode;
  defaultOpen?: boolean;
  trailing?: ReactNode;
}

export function SidebarSection({
  title,
  storageKey,
  children,
  defaultOpen = true,
  trailing,
}: SidebarSectionProps) {
  const [open, setOpen] = useState(() => {
    const stored = localStorage.getItem(`sidebar.${storageKey}`);
    return stored !== null ? stored === 'true' : defaultOpen;
  });

  const toggle = () => {
    const next = !open;
    setOpen(next);
    localStorage.setItem(`sidebar.${storageKey}`, String(next));
  };

  return (
    <div className="border-t border-border/55 first:border-t-0">
      <button
        onClick={toggle}
        className="flex items-center w-full px-3 py-2.5 text-[11px] font-semibold text-muted-foreground uppercase tracking-[0.08em] hover:text-foreground transition-colors"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 mr-1.5 transition-transform duration-[var(--motion-base)] ease-[var(--ease-standard)]',
            open && 'rotate-90'
          )}
        />
        <span className="flex-1 text-left">{title}</span>
        {trailing && (
          <span
            onClick={(e) => e.stopPropagation()}
            className="ml-auto"
          >
            {trailing}
          </span>
        )}
      </button>
      {open && <div className="pb-1">{children}</div>}
    </div>
  );
}
