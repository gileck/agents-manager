import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock sharp before importing the module under test
const mockMetadata = vi.fn();
const mockResize = vi.fn();
const mockPng = vi.fn();
const mockJpeg = vi.fn();
const mockWebp = vi.fn();
const mockGif = vi.fn();
const mockToBuffer = vi.fn();

vi.mock('sharp', () => {
  return {
    default: vi.fn((_buffer: Buffer) => {
      const pipeline = {
        metadata: mockMetadata,
        resize: mockResize.mockReturnValue({
          png: mockPng.mockReturnValue({ toBuffer: mockToBuffer }),
          jpeg: mockJpeg.mockReturnValue({ toBuffer: mockToBuffer }),
          webp: mockWebp.mockReturnValue({ toBuffer: mockToBuffer }),
          gif: mockGif.mockReturnValue({ toBuffer: mockToBuffer }),
        }),
      };
      return pipeline;
    }),
  };
});

// Mock the app logger
vi.mock('../../src/core/services/app-logger', () => ({
  getAppLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

import { resizeImageIfNeeded, resizeImages } from '../../src/core/libs/image-utils';
import type { ChatImage } from '../../src/shared/types';

describe('resizeImageIfNeeded', () => {
  const smallBase64 = Buffer.from('small-image-data').toString('base64');
  const resizedBuffer = Buffer.from('resized-image-data');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns the original base64 when image is within the limit', async () => {
    mockMetadata.mockResolvedValue({ width: 1000, height: 800 });

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(smallBase64);
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('returns the original base64 when image dimensions are exactly at the limit', async () => {
    mockMetadata.mockResolvedValue({ width: 2000, height: 1500 });

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(smallBase64);
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('resizes when width exceeds the limit', async () => {
    mockMetadata.mockResolvedValue({ width: 3000, height: 1500 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(resizedBuffer.toString('base64'));
    expect(mockResize).toHaveBeenCalledWith({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });
    expect(mockPng).toHaveBeenCalled();
  });

  it('resizes when height exceeds the limit', async () => {
    mockMetadata.mockResolvedValue({ width: 1500, height: 4000 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(resizedBuffer.toString('base64'));
    expect(mockResize).toHaveBeenCalledWith({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });
  });

  it('resizes when both dimensions exceed the limit', async () => {
    mockMetadata.mockResolvedValue({ width: 5000, height: 3000 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(resizedBuffer.toString('base64'));
    expect(mockResize).toHaveBeenCalledWith({
      width: 2000,
      height: 2000,
      fit: 'inside',
      withoutEnlargement: true,
    });
  });

  it('uses jpeg encoder for JPEG images', async () => {
    mockMetadata.mockResolvedValue({ width: 3000, height: 2000 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    await resizeImageIfNeeded(smallBase64, 'image/jpeg', 2000);

    expect(mockJpeg).toHaveBeenCalledWith({ quality: 90 });
  });

  it('uses webp encoder for WebP images', async () => {
    mockMetadata.mockResolvedValue({ width: 3000, height: 2000 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    await resizeImageIfNeeded(smallBase64, 'image/webp', 2000);

    expect(mockWebp).toHaveBeenCalled();
  });

  it('uses gif encoder for GIF images', async () => {
    mockMetadata.mockResolvedValue({ width: 3000, height: 2000 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    await resizeImageIfNeeded(smallBase64, 'image/gif', 2000);

    expect(mockGif).toHaveBeenCalled();
  });

  it('strips data URI prefix before processing', async () => {
    const dataUri = `data:image/png;base64,${smallBase64}`;
    mockMetadata.mockResolvedValue({ width: 800, height: 600 });

    const result = await resizeImageIfNeeded(dataUri, 'image/png', 2000);

    // Should return original (which includes data URI prefix) since image is small
    expect(result).toBe(dataUri);
  });

  it('returns the original base64 when metadata has no dimensions', async () => {
    mockMetadata.mockResolvedValue({});

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(smallBase64);
    expect(mockResize).not.toHaveBeenCalled();
  });

  it('returns the original base64 on sharp error (corrupt data)', async () => {
    mockMetadata.mockRejectedValue(new Error('Input buffer contains unsupported image format'));

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(smallBase64);
  });

  it('returns the original base64 when resize fails', async () => {
    mockMetadata.mockResolvedValue({ width: 5000, height: 3000 });
    mockToBuffer.mockRejectedValue(new Error('Resize failed'));

    const result = await resizeImageIfNeeded(smallBase64, 'image/png', 2000);

    expect(result).toBe(smallBase64);
  });

  it('uses default maxDimension of 2000 when not specified', async () => {
    mockMetadata.mockResolvedValue({ width: 1999, height: 1999 });

    const result = await resizeImageIfNeeded(smallBase64, 'image/png');

    expect(result).toBe(smallBase64);
    expect(mockResize).not.toHaveBeenCalled();
  });
});

describe('resizeImages', () => {
  const resizedBuffer = Buffer.from('resized-image-data');

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns small images unchanged', async () => {
    const smallBase64 = Buffer.from('small').toString('base64');

    const images: ChatImage[] = [
      { base64: smallBase64, mediaType: 'image/png' },
    ];

    mockMetadata.mockResolvedValue({ width: 800, height: 600 });

    const result = await resizeImages(images);

    expect(result).toHaveLength(1);
    expect(result[0].base64).toBe(smallBase64);
    expect(result[0].mediaType).toBe('image/png');
  });

  it('resizes oversized images', async () => {
    const bigBase64 = Buffer.from('big').toString('base64');

    const images: ChatImage[] = [
      { base64: bigBase64, mediaType: 'image/jpeg' },
    ];

    mockMetadata.mockResolvedValue({ width: 4000, height: 3000 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    const result = await resizeImages(images);

    expect(result).toHaveLength(1);
    expect(result[0].base64).toBe(resizedBuffer.toString('base64'));
    expect(result[0].mediaType).toBe('image/jpeg');
  });

  it('preserves the name field on ChatImage objects', async () => {
    const images: ChatImage[] = [
      { base64: Buffer.from('test').toString('base64'), mediaType: 'image/png', name: 'screenshot.png' },
    ];

    mockMetadata.mockResolvedValue({ width: 800, height: 600 });

    const result = await resizeImages(images);

    expect(result[0].name).toBe('screenshot.png');
  });

  it('processes an empty array without error', async () => {
    const result = await resizeImages([]);

    expect(result).toEqual([]);
  });

  it('handles custom maxDimension', async () => {
    const images: ChatImage[] = [
      { base64: Buffer.from('img').toString('base64'), mediaType: 'image/png' },
    ];

    mockMetadata.mockResolvedValue({ width: 1200, height: 900 });
    mockToBuffer.mockResolvedValue(resizedBuffer);

    const result = await resizeImages(images, 1000);

    expect(result[0].base64).toBe(resizedBuffer.toString('base64'));
    expect(mockResize).toHaveBeenCalledWith({
      width: 1000,
      height: 1000,
      fit: 'inside',
      withoutEnlargement: true,
    });
  });
});
