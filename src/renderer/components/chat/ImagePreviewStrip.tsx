/**
 * Shared image preview strip component.
 *
 * Renders a row of image thumbnails with click-to-preview and remove buttons.
 * Manages `previewIndex` state internally and integrates ImageAnnotationPanel
 * for in-place annotation/editing of attached images.
 *
 * Used by both the default ChatInput and the Claude Code preset input.
 */

import React, { useState, useCallback } from 'react';
import type { ChatImage } from '../../../shared/types';
import { ImageAnnotationPanel } from '../ui/ImageAnnotationPanel';

export interface ImagePreviewStripProps {
  /** Current list of attached images. */
  images: ChatImage[];
  /** State setter so the annotation panel can replace images in-place. */
  setImages: React.Dispatch<React.SetStateAction<ChatImage[]>>;
  /** Remove an image at the given index. */
  removeImage: (index: number) => void;
  /** Visual variant — 'default' uses Tailwind classes, 'terminal' uses inline dark styles. */
  variant?: 'default' | 'terminal';
}

export function ImagePreviewStrip({
  images,
  setImages,
  removeImage,
  variant = 'default',
}: ImagePreviewStripProps) {
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);

  const handleRemove = useCallback((index: number) => {
    removeImage(index);
    setPreviewIndex((prev) => {
      if (prev === null) return null;
      if (prev === index) return null;
      if (prev > index) return prev - 1;
      return prev;
    });
  }, [removeImage]);

  const handleAnnotationSave = useCallback((annotatedImage: ChatImage, idx: number) => {
    setImages((prev) => prev.map((img, i) => i === idx ? annotatedImage : img));
    setPreviewIndex(null);
  }, [setImages]);

  if (images.length === 0) return null;

  if (variant === 'terminal') {
    return (
      <>
        <div style={{ display: 'flex', gap: 6, padding: '6px 16px 0', flexWrap: 'wrap' }}>
          {images.map((img, i) => (
            <div key={i} style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={`data:${img.mediaType};base64,${img.base64}`}
                alt={img.name || 'Attached image'}
                style={{
                  width: 48,
                  height: 48,
                  borderRadius: 6,
                  objectFit: 'cover',
                  border: '1px solid #374151',
                  cursor: 'pointer',
                }}
                onClick={() => setPreviewIndex(i)}
              />
              <button
                type="button"
                onClick={() => handleRemove(i)}
                style={{
                  position: 'absolute',
                  top: -6,
                  right: -6,
                  width: 16,
                  height: 16,
                  borderRadius: '50%',
                  border: 'none',
                  background: '#ef4444',
                  color: '#fff',
                  fontSize: 10,
                  lineHeight: '16px',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: 0,
                }}
                title="Remove image"
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {previewIndex !== null && images[previewIndex] && (
          <ImageAnnotationPanel
            images={images.map((img) => ({
              src: `data:${img.mediaType};base64,${img.base64}`,
              name: img.name,
            }))}
            initialIndex={previewIndex}
            onClose={() => setPreviewIndex(null)}
            onSave={handleAnnotationSave}
          />
        )}
      </>
    );
  }

  // Default variant — Tailwind classes
  return (
    <>
      <div className="flex gap-2 px-4 pt-3 flex-wrap">
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
              onClick={() => handleRemove(i)}
              className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full text-xs leading-none opacity-0 group-hover:opacity-100 transition-opacity"
              style={{ width: 18, height: 18, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
            >
              x
            </button>
          </div>
        ))}
      </div>

      {previewIndex !== null && images[previewIndex] && (
        <ImageAnnotationPanel
          images={images.map((img) => ({
            src: `data:${img.mediaType};base64,${img.base64}`,
            name: img.name,
          }))}
          initialIndex={previewIndex}
          onClose={() => setPreviewIndex(null)}
          onSave={handleAnnotationSave}
        />
      )}
    </>
  );
}
