import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import type { ChatImage } from '../../shared/types';
import { getAppLogger } from '../services/app-logger';

const DEFAULT_MAX_DIMENSION = 2000;

/** Lazy-load sharp to avoid import errors when the native module is not yet installed. */
async function loadSharp(): Promise<typeof import('sharp')['default']> {
  const mod = await import('sharp');
  return mod.default;
}

export function mediaTypeToExtension(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png';
    case 'image/jpeg': return 'jpg';
    case 'image/gif': return 'gif';
    case 'image/webp': return 'webp';
    default: return 'img';
  }
}

export function normalizeBase64(base64: string): string {
  const marker = 'base64,';
  const idx = base64.indexOf(marker);
  return idx >= 0 ? base64.slice(idx + marker.length) : base64;
}

/**
 * Resize a single base64-encoded image if its longest side exceeds maxDimension.
 * Preserves aspect ratio and original format. Returns the original base64 unchanged
 * if the image is already within limits or if an error occurs during processing.
 */
export async function resizeImageIfNeeded(
  base64: string,
  mediaType: string,
  maxDimension: number = DEFAULT_MAX_DIMENSION,
): Promise<string> {
  try {
    const sharp = await loadSharp();
    const raw = normalizeBase64(base64);
    const buffer = Buffer.from(raw, 'base64');
    const image = sharp(buffer);
    const metadata = await image.metadata();
    const { width, height } = metadata;

    if (!width || !height) {
      return base64;
    }

    if (width <= maxDimension && height <= maxDimension) {
      return base64;
    }

    const resized = image.resize({
      width: maxDimension,
      height: maxDimension,
      fit: 'inside',
      withoutEnlargement: true,
    });

    let outputBuffer: Buffer;
    switch (mediaType) {
      case 'image/png':
        outputBuffer = await resized.png().toBuffer();
        break;
      case 'image/jpeg':
        outputBuffer = await resized.jpeg({ quality: 90 }).toBuffer();
        break;
      case 'image/webp':
        outputBuffer = await resized.webp().toBuffer();
        break;
      case 'image/gif':
        outputBuffer = await resized.gif().toBuffer();
        break;
      default:
        outputBuffer = await resized.png().toBuffer();
        break;
    }

    getAppLogger().info('ImageUtils', `Resized image from ${width}x${height} to fit within ${maxDimension}px`);
    return outputBuffer.toString('base64');
  } catch (err) {
    getAppLogger().warn('ImageUtils', 'Failed to resize image, returning original', {
      error: err instanceof Error ? err.message : String(err),
    });
    return base64;
  }
}

/**
 * Resize all images in an array whose longest side exceeds maxDimension.
 * Returns a new array with resized images (or originals if already within limits).
 */
export async function resizeImages(
  images: ChatImage[],
  maxDimension: number = DEFAULT_MAX_DIMENSION,
): Promise<ChatImage[]> {
  return Promise.all(
    images.map(async (img) => {
      const resizedBase64 = await resizeImageIfNeeded(img.base64, img.mediaType, maxDimension);
      return { ...img, base64: resizedBase64 };
    }),
  );
}

/**
 * Write a list of base64 images to a temporary directory.
 * Returns the temp dir path and the file paths in order.
 * Cleans up the temp dir and rethrows if any write fails.
 */
export async function writeImagesToTempDir(
  runId: string,
  prefix: string,
  images: Array<{ base64: string; mediaType: string }>,
): Promise<{ tempDir: string; filePaths: string[] }> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `${prefix}-${runId}-`));
  const filePaths: string[] = [];
  try {
    for (let i = 0; i < images.length; i++) {
      const img = images[i];
      const ext = mediaTypeToExtension(img.mediaType);
      const filePath = path.join(tempDir, `image-${i + 1}.${ext}`);
      await fs.promises.writeFile(filePath, Buffer.from(normalizeBase64(img.base64), 'base64'));
      filePaths.push(filePath);
    }
  } catch (err) {
    await fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    throw err;
  }
  return { tempDir, filePaths };
}
