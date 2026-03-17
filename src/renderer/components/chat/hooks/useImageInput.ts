import { useState, useRef, useCallback } from 'react';
import { reportError } from '../../../lib/error-handler';
import type { ChatImage } from '../../../../shared/types';

const VALID_IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const MAX_IMAGES = 5;

export interface UseImageInputReturn {
  images: ChatImage[];
  setImages: React.Dispatch<React.SetStateAction<ChatImage[]>>;
  fileInputRef: React.RefObject<HTMLInputElement | null>;
  addImageFile: (file: File) => void;
  handlePaste: (e: React.ClipboardEvent) => void;
  handleDrop: (e: React.DragEvent) => void;
  handleDragOver: (e: React.DragEvent) => void;
  removeImage: (index: number) => void;
}

/**
 * Hook that encapsulates image attachment state and event handlers for chat input.
 * Manages image paste, drag-and-drop, file input, and removal.
 */
export function useImageInput(): UseImageInputReturn {
  const [images, setImages] = useState<ChatImage[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addImageFile = useCallback((file: File) => {
    if (!VALID_IMAGE_TYPES.has(file.type)) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const base64 = result.split(',')[1];
      if (!base64) return;
      setImages((curr) => {
        if (curr.length >= MAX_IMAGES) return curr;
        return [...curr, {
          mediaType: file.type as ChatImage['mediaType'],
          base64,
          name: file.name,
        }];
      });
    };
    reader.onerror = () => {
      reportError(reader.error, `ChatInput: read file "${file.name}"`);
    };
    reader.readAsDataURL(file);
  }, []);

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
    setImages((prev) => prev.filter((_, i) => i !== index));
  }, []);

  return {
    images,
    setImages,
    fileInputRef,
    addImageFile,
    handlePaste,
    handleDrop,
    handleDragOver,
    removeImage,
  };
}
