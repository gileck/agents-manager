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
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      let { naturalWidth: w, naturalHeight: h } = img;
      // Downscale if exceeds max dimension
      if (w > MAX_IMAGE_DIM || h > MAX_IMAGE_DIM) {
        const scale = MAX_IMAGE_DIM / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      imgRef.current = img;
      setImgDims({ w, h });
      setImgLoaded(true);
      setImgError(false);
    };
    img.onerror = () => {
      setImgError(true);
      setImgLoaded(false);
    };
    img.src = imageSrc;
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

    canvas.width = imgDims.w;
    canvas.height = imgDims.h;
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
    currentPoints.current = [...currentPoints.current, x, y];
    redraw();
  }, [toImageCoords, redraw]);

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
