import { useRef, useState, useCallback, useLayoutEffect } from 'react';

/**
 * Near-bottom threshold in pixels.
 * If the user is within this distance of the bottom, auto-scroll stays engaged.
 * Increased from the previous 80px to reduce false re-engagement when new
 * content pushes the scroll position slightly above the bottom.
 */
const NEAR_BOTTOM_THRESHOLD = 150;

/**
 * Duration (ms) to suppress `handleScroll` after a programmatic scroll.
 * Covers the smooth-scroll animation so the scroll handler doesn't
 * flip `autoScroll` off during a `scrollToLatest()` call.
 */
const PROGRAMMATIC_SCROLL_GUARD_MS = 600;

interface UseAutoScrollOptions {
  /** Dependency that triggers auto-scroll check (typically `messages.length`). */
  messagesLength: number;
}

interface UseAutoScrollReturn {
  /** Ref to attach to the scrollable container div. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  /** Ref to attach to the sentinel div at the bottom of content. */
  endRef: React.RefObject<HTMLDivElement | null>;
  /** Whether auto-scroll is currently active (controls "Back to latest" button visibility). */
  autoScroll: boolean;
  /** Scroll event handler to attach to the container's `onScroll`. */
  handleScroll: () => void;
  /** Programmatic scroll-to-bottom with smooth behavior; re-engages auto-scroll. */
  scrollToLatest: () => void;
}

/**
 * Shared hook that manages auto-scroll behaviour for chat message lists.
 *
 * Fixes scroll jumping during agent runs by:
 * 1. Using CSS `overflow-anchor: auto` on the container (callers add the style)
 *    so the browser natively preserves scroll position when content is appended.
 * 2. Guarding programmatic scrolls with an `isProgrammaticScroll` ref so
 *    `handleScroll` doesn't falsely flip `autoScroll` during animations.
 * 3. Using `useLayoutEffect` for flicker-free auto-scroll before paint.
 * 4. Increasing the near-bottom threshold from 80px to 150px.
 */
export function useAutoScroll({ messagesLength }: UseAutoScrollOptions): UseAutoScrollReturn {
  const containerRef = useRef<HTMLDivElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const [autoScroll, setAutoScroll] = useState(true);
  // Ref mirror avoids stale closures in the scroll handler callback.
  const autoScrollRef = useRef(true);

  // Guard to suppress handleScroll during programmatic scrollIntoView calls.
  const isProgrammaticScroll = useRef(false);

  /**
   * Scroll event handler — detects whether the user is near the bottom
   * and toggles auto-scroll accordingly.
   *
   * Skipped when a programmatic scroll is in progress to avoid race conditions.
   */
  const handleScroll = useCallback(() => {
    if (isProgrammaticScroll.current) return;

    const container = containerRef.current;
    if (!container) return;

    const nearBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight < NEAR_BOTTOM_THRESHOLD;

    if (nearBottom !== autoScrollRef.current) {
      autoScrollRef.current = nearBottom;
      setAutoScroll(nearBottom);
    }
  }, []);

  /**
   * Auto-scroll to the bottom when new messages arrive and auto-scroll is enabled.
   *
   * Uses `useLayoutEffect` so the scroll adjustment happens synchronously
   * before the browser paints, avoiding visual flicker.
   */
  useLayoutEffect(() => {
    if (!autoScrollRef.current) return;

    isProgrammaticScroll.current = true;
    endRef.current?.scrollIntoView({ behavior: 'instant' });

    // Release the guard after a microtask so the synchronous scroll event
    // triggered by `scrollIntoView({ behavior: 'instant' })` is suppressed.
    requestAnimationFrame(() => {
      isProgrammaticScroll.current = false;
    });
  }, [messagesLength]);

  /**
   * Smooth-scroll to the latest message and re-engage auto-scroll.
   * Used by the "Back to latest" / "scroll to latest" button.
   */
  const scrollToLatest = useCallback(() => {
    autoScrollRef.current = true;
    setAutoScroll(true);

    isProgrammaticScroll.current = true;
    endRef.current?.scrollIntoView({ behavior: 'smooth' });

    // Keep the guard active for the duration of the smooth scroll animation.
    setTimeout(() => {
      isProgrammaticScroll.current = false;
    }, PROGRAMMATIC_SCROLL_GUARD_MS);
  }, []);

  return { containerRef, endRef, autoScroll, handleScroll, scrollToLatest };
}
