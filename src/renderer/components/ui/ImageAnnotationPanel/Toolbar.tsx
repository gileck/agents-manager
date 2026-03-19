import React from 'react';
import { Pen, Highlighter, Circle, ArrowRight, Undo2, Redo2, Trash2, Save } from 'lucide-react';
import type { DrawingTool } from './types';
import type { BrushSizeLabel } from './useDrawingState';
import { PRESET_COLORS, BRUSH_SIZES } from './useDrawingState';

interface ToolbarProps {
  activeTool: DrawingTool;
  onToolChange: (tool: DrawingTool) => void;
  activeColor: string;
  onColorChange: (color: string) => void;
  brushSizeLabel: BrushSizeLabel;
  onBrushSizeChange: (size: BrushSizeLabel) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  onClear: () => void;
  onSave?: () => void;
  hasStrokes: boolean;
}

const TOOL_BTNS: { tool: DrawingTool; Icon: React.ComponentType<{ className?: string }>; label: string }[] = [
  { tool: 'pen', Icon: Pen, label: 'Pen' },
  { tool: 'highlighter', Icon: Highlighter, label: 'Highlighter' },
  { tool: 'circle', Icon: Circle, label: 'Circle' },
  { tool: 'arrow', Icon: ArrowRight, label: 'Arrow' },
];

const SIZE_LABELS = Object.keys(BRUSH_SIZES) as BrushSizeLabel[];

export function Toolbar({
  activeTool,
  onToolChange,
  activeColor,
  onColorChange,
  brushSizeLabel,
  onBrushSizeChange,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  onClear,
  onSave,
  hasStrokes,
}: ToolbarProps) {
  return (
    <div
      className="flex items-center gap-1.5 px-3 py-2 rounded-xl border border-white/15 bg-black/60 backdrop-blur-md select-none"
      onClick={(e) => e.stopPropagation()}
    >
      {/* Tools */}
      {TOOL_BTNS.map(({ tool, Icon, label }) => (
        <button
          key={tool}
          type="button"
          onClick={() => onToolChange(tool)}
          className={`p-1.5 rounded-md transition-colors ${activeTool === tool ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          title={label}
        >
          <Icon className="h-4 w-4" />
        </button>
      ))}

      <div className="w-px h-5 bg-white/20 mx-1" />

      {/* Colors */}
      {PRESET_COLORS.map((c) => (
        <button
          key={c}
          type="button"
          onClick={() => onColorChange(c)}
          className={`rounded-full transition-transform ${activeColor === c ? 'ring-2 ring-white ring-offset-1 ring-offset-black/60 scale-110' : 'hover:scale-110'}`}
          style={{ width: 18, height: 18, backgroundColor: c, border: c === '#ffffff' ? '1px solid rgba(255,255,255,0.4)' : undefined }}
          title={c}
        />
      ))}

      <div className="w-px h-5 bg-white/20 mx-1" />

      {/* Brush size */}
      {SIZE_LABELS.map((s) => (
        <button
          key={s}
          type="button"
          onClick={() => onBrushSizeChange(s)}
          className={`px-1.5 py-0.5 text-xs font-medium rounded transition-colors ${brushSizeLabel === s ? 'bg-white/20 text-white' : 'text-white/60 hover:text-white hover:bg-white/10'}`}
          title={`Brush size: ${s}`}
        >
          {s}
        </button>
      ))}

      <div className="w-px h-5 bg-white/20 mx-1" />

      {/* Undo/Redo */}
      <button type="button" onClick={onUndo} disabled={!canUndo} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors" title="Undo">
        <Undo2 className="h-4 w-4" />
      </button>
      <button type="button" onClick={onRedo} disabled={!canRedo} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors" title="Redo">
        <Redo2 className="h-4 w-4" />
      </button>
      <button type="button" onClick={onClear} disabled={!hasStrokes} className="p-1.5 rounded-md text-white/60 hover:text-white hover:bg-white/10 disabled:opacity-30 disabled:pointer-events-none transition-colors" title="Clear all">
        <Trash2 className="h-4 w-4" />
      </button>

      {/* Save */}
      {onSave && (
        <>
          <div className="w-px h-5 bg-white/20 mx-1" />
          <button
            type="button"
            onClick={onSave}
            disabled={!hasStrokes}
            className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium rounded-md bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-30 disabled:pointer-events-none transition-colors"
            title="Save annotated image"
          >
            <Save className="h-3.5 w-3.5" />
            Save
          </button>
        </>
      )}
    </div>
  );
}
