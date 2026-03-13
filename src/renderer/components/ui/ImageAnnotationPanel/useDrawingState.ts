import { useState, useCallback, useRef } from 'react';
import type { Stroke, DrawingTool } from './types';

/** Per-image stroke history so navigating between images preserves strokes. */
interface DrawingState {
  strokes: Stroke[];
  redoStack: Stroke[];
}

const PRESET_COLORS = ['#ef4444', '#eab308', '#3b82f6', '#22c55e', '#ffffff'] as const;
const BRUSH_SIZES = { S: 2, M: 5, L: 10 } as const;

export type BrushSizeLabel = keyof typeof BRUSH_SIZES;

export { PRESET_COLORS, BRUSH_SIZES };

export function useDrawingState() {
  const [activeTool, setActiveTool] = useState<DrawingTool>('pen');
  const [activeColor, setActiveColor] = useState<string>(PRESET_COLORS[0]);
  const [brushSizeLabel, setBrushSizeLabel] = useState<BrushSizeLabel>('M');
  const brushSize = BRUSH_SIZES[brushSizeLabel];

  // Per-image stroke history keyed by image index
  const historyRef = useRef<Map<number, DrawingState>>(new Map());
  const [currentIndex, setCurrentIndex] = useState(0);
  // Re-render trigger
  const [revision, setRevision] = useState(0);

  const getState = useCallback((index: number): DrawingState => {
    if (!historyRef.current.has(index)) {
      historyRef.current.set(index, { strokes: [], redoStack: [] });
    }
    return historyRef.current.get(index)!;
  }, []);

  const strokes = getState(currentIndex).strokes;
  const canUndo = strokes.length > 0;
  const canRedo = getState(currentIndex).redoStack.length > 0;

  const switchImage = useCallback((index: number) => {
    setCurrentIndex(index);
    setRevision((r) => r + 1);
  }, []);

  const addStroke = useCallback((stroke: Stroke) => {
    const state = getState(currentIndex);
    state.strokes = [...state.strokes, stroke];
    state.redoStack = []; // clear redo on new stroke
    setRevision((r) => r + 1);
  }, [currentIndex, getState]);

  const undo = useCallback(() => {
    const state = getState(currentIndex);
    if (state.strokes.length === 0) return;
    const last = state.strokes[state.strokes.length - 1];
    state.strokes = state.strokes.slice(0, -1);
    state.redoStack = [...state.redoStack, last];
    setRevision((r) => r + 1);
  }, [currentIndex, getState]);

  const redo = useCallback(() => {
    const state = getState(currentIndex);
    if (state.redoStack.length === 0) return;
    const last = state.redoStack[state.redoStack.length - 1];
    state.redoStack = state.redoStack.slice(0, -1);
    state.strokes = [...state.strokes, last];
    setRevision((r) => r + 1);
  }, [currentIndex, getState]);

  const clearAll = useCallback(() => {
    const state = getState(currentIndex);
    state.strokes = [];
    state.redoStack = [];
    setRevision((r) => r + 1);
  }, [currentIndex, getState]);

  return {
    activeTool,
    setActiveTool,
    activeColor,
    setActiveColor,
    brushSizeLabel,
    setBrushSizeLabel,
    brushSize,
    strokes,
    canUndo,
    canRedo,
    addStroke,
    undo,
    redo,
    clearAll,
    switchImage,
    currentIndex,
    revision,
  };
}
