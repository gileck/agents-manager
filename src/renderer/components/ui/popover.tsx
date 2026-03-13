/**
 * Lightweight Popover component — portal-based dropdown with click-outside
 * dismiss and viewport-aware positioning.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';

interface PopoverContextValue {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  triggerRef: React.RefObject<HTMLElement | null>;
}

const PopoverContext = React.createContext<PopoverContextValue | null>(null);

function usePopoverContext() {
  const ctx = React.useContext(PopoverContext);
  if (!ctx) throw new Error('Popover components must be used within a Popover');
  return ctx;
}

interface PopoverProps {
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  children: React.ReactNode;
}

function Popover({ open: controlledOpen, onOpenChange: controlledOnChange, children }: PopoverProps) {
  const [internalOpen, setInternalOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLElement | null>(null);

  const open = controlledOpen ?? internalOpen;
  const onOpenChange = controlledOnChange ?? setInternalOpen;

  return (
    <PopoverContext.Provider value={{ open, onOpenChange, triggerRef }}>
      {children}
    </PopoverContext.Provider>
  );
}

interface PopoverTriggerProps {
  children: React.ReactNode;
  asChild?: boolean;
}

function PopoverTrigger({ children, asChild }: PopoverTriggerProps) {
  const { open, onOpenChange, triggerRef } = usePopoverContext();

  const handleClick = () => onOpenChange(!open);

  if (asChild && React.isValidElement(children)) {
    return React.cloneElement(children as React.ReactElement<{ onClick?: () => void; ref?: React.Ref<HTMLElement> }>, {
      onClick: handleClick,
      ref: triggerRef,
    });
  }

  return (
    <button
      type="button"
      ref={triggerRef as React.RefObject<HTMLButtonElement>}
      onClick={handleClick}
    >
      {children}
    </button>
  );
}

interface PopoverContentProps {
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
  align?: 'start' | 'center' | 'end';
  sideOffset?: number;
}

function PopoverContent({ children, className, style, align = 'start', sideOffset = 4 }: PopoverContentProps) {
  const { open, onOpenChange, triggerRef } = usePopoverContext();
  const contentRef = React.useRef<HTMLDivElement>(null);
  const [position, setPosition] = React.useState<{ top: number; left: number }>({ top: 0, left: 0 });

  // Calculate position relative to trigger
  React.useEffect(() => {
    if (!open || !triggerRef.current) return;

    const triggerRect = triggerRef.current.getBoundingClientRect();
    const viewportWidth = window.innerWidth;
    const viewportHeight = window.innerHeight;

    let top = triggerRect.bottom + sideOffset;
    let left = triggerRect.left;

    if (align === 'end') {
      left = triggerRect.right;
    } else if (align === 'center') {
      left = triggerRect.left + triggerRect.width / 2;
    }

    // Viewport-aware adjustment (after content renders)
    requestAnimationFrame(() => {
      if (!contentRef.current) return;
      const contentRect = contentRef.current.getBoundingClientRect();

      // Adjust if overflows right
      if (left + contentRect.width > viewportWidth - 8) {
        left = viewportWidth - contentRect.width - 8;
      }
      // Adjust if overflows bottom — flip above trigger
      if (top + contentRect.height > viewportHeight - 8) {
        top = triggerRect.top - contentRect.height - sideOffset;
      }
      // Ensure not off-screen left
      if (left < 8) left = 8;

      setPosition({ top, left });
    });

    setPosition({ top, left });
  }, [open, triggerRef, align, sideOffset]);

  // Click outside handler
  React.useEffect(() => {
    if (!open) return;

    function handleClickOutside(e: MouseEvent) {
      if (
        contentRef.current && !contentRef.current.contains(e.target as Node) &&
        triggerRef.current && !triggerRef.current.contains(e.target as Node)
      ) {
        onOpenChange(false);
      }
    }

    function handleEscape(e: KeyboardEvent) {
      if (e.key === 'Escape') onOpenChange(false);
    }

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [open, onOpenChange, triggerRef]);

  if (!open) return null;

  const portalTarget = document.getElementById('root');
  if (!portalTarget) return null;

  return createPortal(
    <div
      ref={contentRef}
      className={cn(
        'absolute z-50 min-w-[8rem] overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-lg',
        'animate-in fade-in-0 zoom-in-95',
        className,
      )}
      style={{ top: position.top, left: position.left, ...style }}
    >
      {children}
    </div>,
    portalTarget,
  );
}

export { Popover, PopoverTrigger, PopoverContent };
