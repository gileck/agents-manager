import React, { useState, useCallback, useRef } from 'react';
import { createPortal } from 'react-dom';
import type { ChatImage } from '../../../shared/types';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;

interface ImagePasteAreaProps {
  images: ChatImage[];
  onImagesChange: (images: ChatImage[]) => void;
}

export function ImagePasteArea({ images, onImagesChange }: ImagePasteAreaProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFile = useCallback((file: File) => {
    if (!VALID_IMAGE_TYPES.has(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (!base64) return;
      onImagesChange([...images.slice(0, MAX_IMAGES - 1), {
        mediaType: file.type as ChatImage['mediaType'],
        base64,
        name: file.name,
      }].slice(0, MAX_IMAGES));
    };
    reader.readAsDataURL(file);
  }, [images, onImagesChange]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();
        const file = item.getAsFile();
        if (file) addImageFile(file);
        return;
      }
    }
  }, [addImageFile]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    const files = e.dataTransfer?.files;
    if (!files) return;
    for (const file of Array.from(files)) {
      if (file.type.startsWith('image/')) {
        addImageFile(file);
      }
    }
  }, [addImageFile]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
  }, []);

  const removeImage = useCallback((index: number) => {
    onImagesChange(images.filter((_, i) => i !== index));
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  }, [images, onImagesChange]);

  return (
    <div
      onPaste={handlePaste}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {images.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-2">
          {images.map((img, i) => (
            <div key={i} className="relative group">
              <img
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt={img.name || 'Attached image'}
                style={{ width: 56, height: 56 }}
                className="rounded-lg border border-border object-cover cursor-pointer"
                onClick={() => setPreviewIndex(i)}
              />
              <button
                type="button"
                onClick={() => removeImage(i)}
                className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
                style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
              >
                x
              </button>
            </div>
          ))}
        </div>
      )}

      {previewIndex !== null && images[previewIndex] && createPortal(
        <div
          className="absolute inset-0 bg-black/80 flex items-center justify-center z-50"
          onClick={() => setPreviewIndex(null)}
          role="dialog"
          aria-modal="true"
          aria-label="Image preview"
        >
          <div className="relative" onClick={(e) => e.stopPropagation()}>
            <img
              src={`data:${images[previewIndex].mediaType};base64,${images[previewIndex].base64}`}
              alt={images[previewIndex].name || 'Preview'}
              style={{ maxHeight: '80vh', maxWidth: '80vw' }}
              className="rounded-lg"
            />
            <button
              type="button"
              onClick={() => setPreviewIndex(null)}
              aria-label="Close preview"
              className="absolute top-2 right-2 bg-black/60 text-white rounded-full hover:bg-black/80 transition-colors"
              style={{ width: 32, height: 32, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18 }}
            >
              ×
            </button>
          </div>
        </div>,
        document.getElementById('root')!,
      )}

      <div
        className="border border-dashed border-border/60 rounded-lg p-3 text-center text-xs text-muted-foreground cursor-pointer hover:border-border hover:bg-muted/30 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        Paste, drop, or click to add screenshots ({images.length}/{MAX_IMAGES})
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = e.target.files;
          if (files) {
            for (const file of Array.from(files)) {
              addImageFile(file);
            }
          }
          e.target.value = '';
        }}
      />
    </div>
  );
}
