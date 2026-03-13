import React, { useState, useCallback, useRef, useEffect } from 'react';
import type { ChatImage } from '../../../shared/types';
import { ImageAnnotationPanel } from './ImageAnnotationPanel';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;

interface ImagePasteAreaProps {
  images: ChatImage[];
  onImagesChange: (images: ChatImage[]) => void;
}

export function ImagePasteArea({ images, onImagesChange }: ImagePasteAreaProps) {
  // Internal state avoids stale-closure race when multiple FileReader.onload
  // callbacks fire in the same tick (e.g. multi-file drop).
  const [internalImages, setInternalImages] = useState<ChatImage[]>(images);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync parent → internal when parent changes (e.g. dialog reset)
  useEffect(() => {
    setInternalImages(images);
  }, [images]);

  // Sync internal → parent whenever internal state changes
  const onImagesChangeRef = useRef(onImagesChange);
  onImagesChangeRef.current = onImagesChange;
  useEffect(() => {
    onImagesChangeRef.current(internalImages);
  }, [internalImages]);

  const addImageFile = useCallback((file: File) => {
    if (!VALID_IMAGE_TYPES.has(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (!base64) return;
      setInternalImages((curr) => {
        if (curr.length >= MAX_IMAGES) return curr;
        return [...curr, {
          mediaType: file.type as ChatImage['mediaType'],
          base64,
          name: file.name,
        }];
      });
    };
    reader.readAsDataURL(file);
  }, []);

  useEffect(() => {
    const handlePaste = (e: ClipboardEvent) => {
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
    };
    document.addEventListener('paste', handlePaste);
    return () => document.removeEventListener('paste', handlePaste);
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
    setInternalImages((prev) => prev.filter((_, i) => i !== index));
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  }, []);

  const handleAnnotationSave = useCallback((annotatedImage: ChatImage, idx: number) => {
    setInternalImages((prev) => prev.map((img, i) => i === idx ? annotatedImage : img));
    setPreviewIndex(null);
  }, []);

  return (
    <div
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {internalImages.length > 0 && (
        <div className="flex gap-2 flex-wrap mb-2">
          {internalImages.map((img, i) => (
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

      {previewIndex !== null && internalImages[previewIndex] && (
        <ImageAnnotationPanel
          images={internalImages.map((img) => ({
            src: `data:${img.mediaType};base64,${img.base64}`,
            name: img.name,
          }))}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onSave={handleAnnotationSave}
        />
      )}

      <div
        className="border border-dashed border-border/60 rounded-lg p-3 text-center text-xs text-muted-foreground cursor-pointer hover:border-border hover:bg-muted/30 transition-colors"
        onClick={() => fileInputRef.current?.click()}
      >
        Paste, drop, or click to add screenshots ({internalImages.length}/{MAX_IMAGES})
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
