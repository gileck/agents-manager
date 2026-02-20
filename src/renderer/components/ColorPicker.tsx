import type React from 'react';
import { useCallback, useMemo } from 'react';
import { parseHslString, formatHslString, hslStringToHex, hexToHslString } from '../utils/color-utils';
import { Input } from './ui/input';
import { Label } from './ui/label';

interface ColorPickerProps {
  label: string;
  value: string; // HSL string e.g. "222.2 47.4% 11.2%"
  onChange: (value: string) => void;
}

export function ColorPicker({ label, value, onChange }: ColorPickerProps) {
  const hsl = useMemo(() => parseHslString(value), [value]);
  const hex = useMemo(() => hslStringToHex(value), [value]);

  const handleHexChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newHex = e.target.value;
    const newHsl = hexToHslString(newHex);
    onChange(newHsl);
  }, [onChange]);

  const handleHChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newH = parseFloat(e.target.value) || 0;
    onChange(formatHslString(Math.max(0, Math.min(360, newH)), hsl.s, hsl.l));
  }, [onChange, hsl.s, hsl.l]);

  const handleSChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newS = parseFloat(e.target.value) || 0;
    onChange(formatHslString(hsl.h, Math.max(0, Math.min(100, newS)), hsl.l));
  }, [onChange, hsl.h, hsl.l]);

  const handleLChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const newL = parseFloat(e.target.value) || 0;
    onChange(formatHslString(hsl.h, hsl.s, Math.max(0, Math.min(100, newL))));
  }, [onChange, hsl.h, hsl.s]);

  return (
    <div className="flex items-center gap-3 py-1.5">
      <div className="flex items-center gap-2 min-w-[140px]">
        <input
          type="color"
          value={hex}
          onChange={handleHexChange}
          className="w-8 h-8 rounded cursor-pointer border border-border p-0.5 bg-transparent"
          title={label}
        />
        <Label className="text-xs font-medium text-foreground whitespace-nowrap">{label}</Label>
      </div>
      <div className="flex items-center gap-1.5 flex-1">
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-3">H</span>
          <Input
            type="number"
            min={0}
            max={360}
            step={1}
            value={Math.round(hsl.h)}
            onChange={handleHChange}
            className="h-7 w-16 text-xs px-1.5"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-3">S</span>
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsl.s)}
            onChange={handleSChange}
            className="h-7 w-16 text-xs px-1.5"
          />
        </div>
        <div className="flex items-center gap-1">
          <span className="text-[10px] text-muted-foreground w-3">L</span>
          <Input
            type="number"
            min={0}
            max={100}
            step={1}
            value={Math.round(hsl.l)}
            onChange={handleLChange}
            className="h-7 w-16 text-xs px-1.5"
          />
        </div>
      </div>
    </div>
  );
}
