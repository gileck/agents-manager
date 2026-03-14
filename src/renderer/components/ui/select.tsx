import * as React from 'react';
import { createPortal } from 'react-dom';
import { cn } from '../../lib/utils';
import { Check, ChevronDown } from 'lucide-react';

interface SelectProps {
  value: string;
  onValueChange: (value: string) => void;
  children: React.ReactNode;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}

interface SelectContextValue {
  value: string;
  onValueChange: (value: string) => void;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  disabled: boolean;
  triggerRef: React.RefObject<HTMLButtonElement | null>;
  labelMap: Map<string, React.ReactNode>;
}

const SelectContext = React.createContext<SelectContextValue | null>(null);

function useSelectContext() {
  const context = React.useContext(SelectContext);
  if (!context) {
    throw new Error('Select components must be used within a Select provider');
  }
  return context;
}

function Select({ value, onValueChange, children, disabled = false, className }: SelectProps) {
  const [isOpen, setIsOpen] = React.useState(false);
  const triggerRef = React.useRef<HTMLButtonElement | null>(null);

  React.useEffect(() => {
    if (disabled && isOpen) {
      setIsOpen(false);
    }
  }, [disabled, isOpen]);

  const labelMap = React.useMemo(() => {
    const map = new Map<string, React.ReactNode>();
    function traverse(nodes: React.ReactNode) {
      React.Children.forEach(nodes, (child) => {
        if (!React.isValidElement(child)) return;
        if ((child as React.ReactElement).type === SelectItem) {
          const el = child as React.ReactElement<SelectItemProps>;
          map.set(el.props.value, el.props.children);
        } else {
          traverse((child.props as { children?: React.ReactNode }).children);
        }
      });
    }
    traverse(children);
    return map;
  }, [children]);

  return (
    <SelectContext.Provider value={{ value, onValueChange, isOpen, setIsOpen, disabled, triggerRef, labelMap }}>
      <div className={cn('relative', className)}>{children}</div>
    </SelectContext.Provider>
  );
}

interface SelectTriggerProps {
  children: React.ReactNode;
  className?: string;
  id?: string;
}

function SelectTrigger({ children, className, id }: SelectTriggerProps) {
  const { isOpen, setIsOpen, disabled, triggerRef } = useSelectContext();

  return (
    <button
      ref={triggerRef}
      type="button"
      id={id}
      disabled={disabled}
      aria-expanded={isOpen}
      aria-haspopup="listbox"
      onClick={() => {
        if (disabled) return;
        setIsOpen(!isOpen);
      }}
      className={cn(
        'flex h-9 w-full items-center justify-between whitespace-nowrap rounded-full border border-input/80 bg-background dark:bg-background/70 px-3 py-1.5 text-sm text-foreground shadow-[0_0_0_1px_hsl(var(--border)/0.22)_inset] ring-offset-background placeholder:text-muted-foreground transition-[border-color,background-color,box-shadow] duration-[var(--motion-fast)] ease-[var(--ease-standard)] hover:bg-muted/45 focus:outline-none focus:ring-2 focus:ring-ring/65 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50',
        className
      )}
    >
      {children}
      <ChevronDown className={cn('h-4 w-4 opacity-50 transition-transform', isOpen && 'rotate-180')} />
    </button>
  );
}

interface SelectValueProps {
  placeholder?: string;
  children?: React.ReactNode;
}

// TODO: Add component tests for SelectValue label resolution once a frontend
// testing framework (e.g. Vitest + Testing Library) is adopted. Key cases:
//   - SelectValue displays the matching SelectItem label, not the raw value
//   - SelectValue falls back to the raw value when no matching item exists
//   - SelectValue renders placeholder when value is empty
function SelectValue({ placeholder, children }: SelectValueProps) {
  const { value, labelMap } = useSelectContext();
  if (children) {
    return <span className={cn(!value && 'text-muted-foreground')}>{children}</span>;
  }
  const label = labelMap.get(value);
  return <span className={cn(!value && 'text-muted-foreground')}>{label ?? value ?? placeholder}</span>;
}

interface SelectContentProps {
  children: React.ReactNode;
  className?: string;
}

function SelectContent({ children, className }: SelectContentProps) {
  const { isOpen, setIsOpen, triggerRef } = useSelectContext();
  const ref = React.useRef<HTMLDivElement>(null);
  const [style, setStyle] = React.useState<React.CSSProperties>({});

  const updatePosition = React.useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;

    const rect = trigger.getBoundingClientRect();
    const viewportPadding = 8;
    const gap = 6;
    const preferredHeight = 320;
    const spaceBelow = window.innerHeight - rect.bottom - viewportPadding;
    const spaceAbove = rect.top - viewportPadding;
    const openUp = spaceBelow < 220 && spaceAbove > spaceBelow;
    const maxHeight = Math.max(
      120,
      Math.min(preferredHeight, openUp ? spaceAbove - gap : spaceBelow - gap)
    );
    const maxWidth = Math.min(480, window.innerWidth - viewportPadding * 2);
    const clampedLeft = Math.min(
      Math.max(viewportPadding, rect.left),
      window.innerWidth - Math.min(rect.width, maxWidth) - viewportPadding
    );

    setStyle({
      top: openUp ? 'auto' : Math.max(viewportPadding, rect.bottom + gap),
      bottom: openUp ? Math.max(viewportPadding, window.innerHeight - rect.top + gap) : 'auto',
      left: clampedLeft,
      minWidth: rect.width,
      maxWidth,
      maxHeight,
    });
  }, [triggerRef]);

  React.useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      const target = event.target as Node;
      const clickedTrigger = !!triggerRef.current && triggerRef.current.contains(target);
      const clickedContent = !!ref.current && ref.current.contains(target);
      if (!clickedTrigger && !clickedContent) {
        setIsOpen(false);
      }
    }

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      updatePosition();
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('keydown', handleEscape);
      window.addEventListener('resize', updatePosition);
      window.addEventListener('scroll', updatePosition, true);
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleEscape);
      window.removeEventListener('resize', updatePosition);
      window.removeEventListener('scroll', updatePosition, true);
    };
  }, [isOpen, setIsOpen, triggerRef, updatePosition]);

  if (!isOpen) return null;

  return createPortal(
    <div
      ref={ref}
      role="listbox"
      style={style}
      className={cn(
        'fixed z-[80] overflow-auto rounded-2xl border border-border/80 bg-popover p-1.5 text-popover-foreground shadow-[0_20px_44px_rgba(2,8,23,0.24)] dark:shadow-[0_26px_56px_rgba(0,0,0,0.58)]',
        className
      )}
    >
      {children}
    </div>,
    document.body
  );
}

interface SelectItemProps {
  value: string;
  children: React.ReactNode;
  className?: string;
  disabled?: boolean;
}

function SelectItem({ value, children, className, disabled = false }: SelectItemProps) {
  const { value: selectedValue, onValueChange, setIsOpen } = useSelectContext();
  const isSelected = selectedValue === value;

  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      disabled={disabled}
      onClick={() => {
        if (disabled) return;
        onValueChange(value);
        setIsOpen(false);
      }}
      className={cn(
        'relative flex w-full select-none items-center rounded-xl px-3 py-2 text-left text-sm outline-none transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)]',
        isSelected ? 'bg-accent/80 text-accent-foreground' : 'text-foreground/90 hover:bg-accent/60',
        disabled && 'cursor-not-allowed text-muted-foreground/60 hover:bg-transparent',
        className
      )}
    >
      <span className="flex-1 min-w-0 truncate">{children}</span>
      <Check className={cn('h-4 w-4 text-foreground/85', isSelected ? 'opacity-100' : 'opacity-0')} />
    </button>
  );
}

export { Select, SelectTrigger, SelectValue, SelectContent, SelectItem };
