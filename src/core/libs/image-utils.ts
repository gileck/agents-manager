import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

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
