import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, ZoomIn, ZoomOut, Maximize2, ChevronLeft, ChevronRight } from 'lucide-react';
import type { ChatImage } from '../../../../shared/types';
import type { AnnotationImage } from './types';
import { DrawingCanvas } from './DrawingCanvas';
import type { DrawingCanvasHandle } from './DrawingCanvas';
import { Toolbar } from './Toolbar';
import { useDrawingState } from './useDrawingState';

export interface ImageAnnotationPanelProps {
  /** Image URLs or data-URIs to display. */
  images: AnnotationImage[];
  /** Which image to show first (defaults to 0). */
  initialIndex?: number;
  /** Close the panel. */
  onClose: () => void;
  /** Callback with the annotated image result. If omitted, annotation tools are hidden. */
  onSave?: (annotatedImage: ChatImage, index: number) => void;
  /** When true, hides drawing tools entirely (pure lightbox viewer). */
  readOnly?: boolean;
}

const ZOOM_STEP = 0.25;
const MIN_ZOOM = 0.25;
const MAX_ZOOM = 4;

export function ImageAnnotationPanel({
  images,
  initialIndex = 0,
  onClose,
  onSave,
  readOnly = false,
}: ImageAnnotationPanelProps) {
  const [index, setIndex] = useState(initialIndex);
  const [zoom, setZoom] = useState(1);
  const canvasRef = useRef<DrawingCanvasHandle>(null);

  const drawing = useDrawingState();

  // Sync drawing state when index changes
  const switchImage = drawing.switchImage;
  useEffect(() => {
    switchImage(index);
    setZoom(1); // reset zoom when switching images
  }, [index, switchImage]);

  const currentImage = images[index];

  // ── Navigation ──────────────────────────────────────────────────────
  const hasPrev = images.length > 1;
  const hasNext = images.length > 1;

  const goPrev = useCallback(() => {
    setIndex((prev) => (prev - 1 + images.length) % images.length);
  }, [images.length]);

  const goNext = useCallback(() => {
    setIndex((prev) => (prev + 1) % images.length);
  }, [images.length]);

  // ── Zoom ────────────────────────────────────────────────────────────
  const zoomIn = useCallback(() => setZoom((z) => Math.min(z + ZOOM_STEP, MAX_ZOOM)), []);
  const zoomOut = useCallback(() => setZoom((z) => Math.max(z - ZOOM_STEP, MIN_ZOOM)), []);
  const zoomFit = useCallback(() => setZoom(1), []);

  // ── Keyboard shortcuts ──────────────────────────────────────────────
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key === 'ArrowLeft') {
        goPrev();
        return;
      }
      if (e.key === 'ArrowRight') {
        goNext();
        return;
      }
      // Zoom
      if (e.key === '=' || e.key === '+') {
        zoomIn();
        return;
      }
      if (e.key === '-') {
        zoomOut();
        return;
      }
      if (e.key === '0') {
        zoomFit();
        return;
      }
      // Undo/Redo
      if (!readOnly && (e.metaKey || e.ctrlKey)) {
        if (e.key === 'z' && !e.shiftKey) {
          e.preventDefault();
          drawing.undo();
        } else if ((e.key === 'z' && e.shiftKey) || e.key === 'y') {
          e.preventDefault();
          drawing.redo();
        }
      }
    };
    document.addEventListener('keydown', handleKey);
    return () => document.removeEventListener('keydown', handleKey);
  }, [onClose, goPrev, goNext, zoomIn, zoomOut, zoomFit, readOnly, drawing]);

  // ── Mouse wheel zoom ───────────────────────────────────────────────
  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (e.deltaY < 0) {
      setZoom((z) => Math.min(z + 0.1, MAX_ZOOM));
    } else {
      setZoom((z) => Math.max(z - 0.1, MIN_ZOOM));
    }
  }, []);

  // ── Save handler ────────────────────────────────────────────────────
  const handleSave = useCallback(() => {
    if (!onSave || !canvasRef.current) return;
    const dataUrl = canvasRef.current.exportImage();
    if (!dataUrl) return;
    // data:image/png;base64,<data>
    const base64 = dataUrl.split(',')[1];
    if (!base64) return;
    const annotatedImage: ChatImage = {
      mediaType: 'image/png',
      base64,
      name: currentImage.name ? `annotated_${currentImage.name}` : 'annotated_image.png',
    };
    onSave(annotatedImage, index);
  }, [onSave, index, currentImage]);

  if (!currentImage) return null;

  const overlay = (
    <div
      className="fixed inset-0 flex flex-col items-center justify-center bg-black/85 backdrop-blur-sm"
      style={{ zIndex: 60 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Image annotation panel"
    >
      {/* Top bar */}
      <div
        className="absolute top-0 left-0 right-0 flex items-center justify-between px-4 py-3"
        style={{ zIndex: 62 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 text-white/80 text-sm">
          {currentImage.name && <span className="truncate max-w-[200px]">{currentImage.name}</span>}
          {images.length > 1 && (
            <span className="bg-white/15 rounded-full px-2 py-0.5 text-xs">
              {index + 1} / {images.length}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {/* Zoom controls */}
          <button type="button" onClick={zoomOut} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors" title="Zoom out (-)">
            <ZoomOut className="h-4 w-4" />
          </button>
          <span className="text-white/60 text-xs min-w-[3rem] text-center tabular-nums">{Math.round(zoom * 100)}%</span>
          <button type="button" onClick={zoomIn} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors" title="Zoom in (+)">
            <ZoomIn className="h-4 w-4" />
          </button>
          <button type="button" onClick={zoomFit} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors" title="Fit to screen (0)">
            <Maximize2 className="h-4 w-4" />
          </button>

          <div className="w-px h-5 bg-white/20 mx-1" />

          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 transition-colors"
            title="Close (Esc)"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Canvas area */}
      <div
        className="flex-1 flex items-center justify-center w-full overflow-auto"
        style={{ paddingTop: 52, paddingBottom: !readOnly ? 64 : 12 }}
        onClick={(e) => e.stopPropagation()}
        onWheel={handleWheel}
      >
        <DrawingCanvas
          ref={canvasRef}
          imageSrc={currentImage.src}
          strokes={drawing.strokes}
          readOnly={readOnly}
          activeTool={drawing.activeTool}
          activeColor={drawing.activeColor}
          brushSize={drawing.brushSize}
          zoom={zoom}
          onStrokeComplete={drawing.addStroke}
        />
      </div>

      {/* Navigation arrows */}
      {hasPrev && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goPrev(); }}
          className="absolute left-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          style={{ zIndex: 62 }}
          title="Previous image"
        >
          <ChevronLeft className="h-5 w-5" />
        </button>
      )}
      {hasNext && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); goNext(); }}
          className="absolute right-3 top-1/2 -translate-y-1/2 p-2 rounded-full bg-black/50 text-white/70 hover:text-white hover:bg-black/70 transition-colors"
          style={{ zIndex: 62 }}
          title="Next image"
        >
          <ChevronRight className="h-5 w-5" />
        </button>
      )}

      {/* Toolbar (annotation mode only) */}
      {!readOnly && (
        <div
          className="absolute bottom-4 left-1/2 -translate-x-1/2"
          style={{ zIndex: 62 }}
        >
          <Toolbar
            activeTool={drawing.activeTool}
            onToolChange={drawing.setActiveTool}
            activeColor={drawing.activeColor}
            onColorChange={drawing.setActiveColor}
            brushSizeLabel={drawing.brushSizeLabel}
            onBrushSizeChange={drawing.setBrushSizeLabel}
            canUndo={drawing.canUndo}
            canRedo={drawing.canRedo}
            onUndo={drawing.undo}
            onRedo={drawing.redo}
            onClear={drawing.clearAll}
            onSave={onSave ? handleSave : undefined}
            hasStrokes={drawing.strokes.length > 0}
          />
        </div>
      )}
    </div>
  );

  return createPortal(overlay, document.getElementById('root')!);
}
