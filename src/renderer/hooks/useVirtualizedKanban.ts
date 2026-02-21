import { useState, useEffect, useMemo } from 'react';

interface UseVirtualizedKanbanOptions {
  itemCount: number;
  itemHeight: number;
  containerHeight: number;
  scrollTop: number;
  overscan?: number;
}

interface VirtualizedRange {
  start: number;
  end: number;
  offsetY: number;
  totalHeight: number;
}

/**
 * Custom hook for virtualizing long lists in kanban columns
 * Only renders visible items plus an overscan buffer for smooth scrolling
 */
export function useVirtualizedKanban({
  itemCount,
  itemHeight,
  containerHeight,
  scrollTop,
  overscan = 3,
}: UseVirtualizedKanbanOptions): VirtualizedRange {

  // Calculate which items should be visible
  const range = useMemo(() => {
    const totalHeight = itemCount * itemHeight;

    // Calculate visible range
    const startIndex = Math.floor(scrollTop / itemHeight);
    const endIndex = Math.ceil((scrollTop + containerHeight) / itemHeight);

    // Add overscan buffer
    const start = Math.max(0, startIndex - overscan);
    const end = Math.min(itemCount, endIndex + overscan);

    // Calculate offset for positioning
    const offsetY = start * itemHeight;

    return {
      start,
      end,
      offsetY,
      totalHeight,
    };
  }, [itemCount, itemHeight, containerHeight, scrollTop, overscan]);

  return range;
}

/**
 * Hook to track scroll position of a container element
 */
export function useScrollPosition(containerRef: React.RefObject<HTMLElement | null>): number {
  const [scrollTop, setScrollTop] = useState(0);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleScroll = () => {
      setScrollTop(container.scrollTop);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [containerRef]);

  return scrollTop;
}
