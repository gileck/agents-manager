import React, { useRef, useEffect, useCallback, useState, useImperativeHandle, forwardRef } from 'react';
import type { Stroke, DrawingTool } from './types';

interface DrawingCanvasProps {
  imageSrc: string;
  strokes: Stroke[];
  readOnly?: boolean;
  activeTool: DrawingTool;
  activeColor: string;
  brushSize: number;
  zoom: number;
  onStrokeComplete: (stroke: Stroke) => void;
}

export interface DrawingCanvasHandle {
  /** Export the canvas (base image + strokes) as a base64 PNG data-URI. */
  exportImage: () => string | null;
}

/** Maximum dimension for loaded images to avoid canvas performance issues. */
const MAX_IMAGE_DIM = 4096;

/** Shape tools use drag-to-draw mode (start + end point) instead of freehand point accumulation. */
function isShapeTool(tool: DrawingTool): boolean {
  return tool === 'circle' || tool === 'arrow';
}

/**
 * Canvas-based drawing surface with a base image layer and freehand stroke overlay.
 * All drawing coordinates are in image-space; zoom is applied via CSS transform.
 */
export const DrawingCanvas = forwardRef<DrawingCanvasHandle, DrawingCanvasProps>(function DrawingCanvas(
  { imageSrc, strokes, readOnly, activeTool, activeColor, brushSize, zoom, onStrokeComplete },
  ref,
) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const [imgDims, setImgDims] = useState<{ w: number; h: number }>({ w: 0, h: 0 });

  // Active drawing state
  const isDrawing = useRef(false);
  const currentPoints = useRef<number[]>([]);

  // ── Load image ──────────────────────────────────────────────────────
  useEffect(() => {
    const htmlImg = document.createElement('img');
    htmlImg.crossOrigin = 'anonymous';
    htmlImg.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = htmlImg;
      // Downscale if exceeds max dimension
      if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      imgRef.current = htmlImg;
      setImgDims({ w, h });
      setImgLoaded(true);
      setImgError(false);
    };
    htmlImg.onerror = () => {
      setImgError(true);
      setImgLoaded(false);
    };
    htmlImg.src = imageSrc;
    // Reset state when image src changes
    setImgLoaded(false);
    setImgError(false);
  }, [imageSrc]);

  // ── Draw everything ─────────────────────────────────────────────────
  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const img = imgRef.current;
    if (!canvas || !img || !imgLoaded) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Only reset canvas dimensions when they actually change to avoid
    // resetting the entire context state on every redraw during drawing.
    if (canvas.width !== imgDims.w || canvas.height !== imgDims.h) {
      canvas.width = imgDims.w;
      canvas.height = imgDims.h;
    }
    ctx.clearRect(0, 0, imgDims.w, imgDims.h);

    // Base image
    ctx.drawImage(img, 0, 0, imgDims.w, imgDims.h);

    // Strokes
    for (const stroke of strokes) {
      drawStroke(ctx, stroke);
    }

    // Active (in-progress) stroke
    if (isDrawing.current && currentPoints.current.length >= 4) {
      drawStroke(ctx, {
        points: currentPoints.current,
        color: activeColor,
        width: brushSize,
        tool: activeTool,
      });
    }
  }, [imgLoaded, imgDims, strokes, activeColor, brushSize, activeTool]);

  useEffect(() => {
    redraw();
  }, [redraw]);

  // ── Export ───────────────────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    exportImage: () => {
      const canvas = canvasRef.current;
      if (!canvas) return null;
      // Re-draw to ensure canvas is up-to-date
      redraw();
      return canvas.toDataURL('image/png');
    },
  }), [redraw]);

  // ── Pointer → image-space coordinate conversion ────────────────────
  const toImageCoords = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * imgDims.w;
    const y = ((e.clientY - rect.top) / rect.height) * imgDims.h;
    return { x, y };
  }, [imgDims]);

  // ── Pointer handlers ───────────────────────────────────────────────
  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (readOnly || !imgLoaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    isDrawing.current = true;
    const { x, y } = toImageCoords(e);
    currentPoints.current = [x, y];
  }, [readOnly, imgLoaded, toImageCoords]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDrawing.current) return;
    const { x, y } = toImageCoords(e);
    if (isShapeTool(activeTool)) {
      // Shape tools: store only [startX, startY, currentX, currentY]
      currentPoints.current = [currentPoints.current[0], currentPoints.current[1], x, y];
    } else {
      currentPoints.current.push(x, y);
    }
    redraw();
  }, [toImageCoords, redraw, activeTool]);

  const handlePointerUp = useCallback(() => {
    if (!isDrawing.current) return;
    isDrawing.current = false;
    if (currentPoints.current.length >= 4) {
      onStrokeComplete({
        points: currentPoints.current,
        color: activeColor,
        width: brushSize,
        tool: activeTool,
      });
    }
    currentPoints.current = [];
  }, [activeColor, brushSize, activeTool, onStrokeComplete]);

  if (imgError) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Image could not be loaded
      </div>
    );
  }

  if (!imgLoaded) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading...
      </div>
    );
  }

  return (
    <canvas
      ref={canvasRef}
      width={imgDims.w}
      height={imgDims.h}
      className="block"
      style={{
        cursor: readOnly ? 'default' : 'crosshair',
        transformOrigin: 'center center',
        transform: `scale(${zoom})`,
        maxWidth: '100%',
        maxHeight: '100%',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
    />
  );
});

DrawingCanvas.displayName = 'DrawingCanvas';

// ── Helper: draw a single stroke onto a 2D context ───────────────────
function drawStroke(ctx: CanvasRenderingContext2D, stroke: Stroke) {
  if (stroke.points.length < 4) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = stroke.width;
  ctx.strokeStyle = stroke.color;

  if (stroke.tool === 'circle') {
    const [x1, y1, x2, y2] = stroke.points;
    const cx = (x1 + x2) / 2;
    const cy = (y1 + y2) / 2;
    const rx = Math.abs(x2 - x1) / 2;
    const ry = Math.abs(y2 - y1) / 2;
    // Skip degenerate shapes (too small to be visible)
    if (rx < 2 && ry < 2) { ctx.restore(); return; }
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, 2 * Math.PI);
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (stroke.tool === 'arrow') {
    const [x1, y1, x2, y2] = stroke.points;
    const dx = x2 - x1;
    const dy = y2 - y1;
    // Skip degenerate shapes
    if (Math.abs(dx) < 2 && Math.abs(dy) < 2) { ctx.restore(); return; }
    const angle = Math.atan2(dy, dx);
    const headLen = Math.max(12, stroke.width * 4);
    // Main line
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
    // Arrowhead — two angled lines from the endpoint
    ctx.beginPath();
    ctx.moveTo(x2 - headLen * Math.cos(angle - Math.PI / 6), y2 - headLen * Math.sin(angle - Math.PI / 6));
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2 - headLen * Math.cos(angle + Math.PI / 6), y2 - headLen * Math.sin(angle + Math.PI / 6));
    ctx.stroke();
    ctx.restore();
    return;
  }

  if (stroke.tool === 'highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = stroke.width * 3; // highlighter is wider
  }

  ctx.beginPath();
  ctx.moveTo(stroke.points[0], stroke.points[1]);
  for (let i = 2; i < stroke.points.length; i += 2) {
    ctx.lineTo(stroke.points[i], stroke.points[i + 1]);
  }
  ctx.stroke();
  ctx.restore();
}
