/**
 * Minimal type declarations for the `sharp` image processing library.
 * These will be superseded by @types/sharp when it is installed.
 */
declare module 'sharp' {
  interface SharpInstance {
    metadata(): Promise<{ width?: number; height?: number; format?: string }>;
    resize(options: {
      width?: number;
      height?: number;
      fit?: 'cover' | 'contain' | 'fill' | 'inside' | 'outside';
      withoutEnlargement?: boolean;
    }): SharpInstance;
    png(): SharpInstance;
    jpeg(options?: { quality?: number }): SharpInstance;
    webp(options?: { quality?: number }): SharpInstance;
    gif(): SharpInstance;
    toBuffer(): Promise<Buffer>;
  }

  function sharp(input: Buffer): SharpInstance;
  export default sharp;
}
