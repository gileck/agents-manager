/** Drawing tool types for the annotation panel. */
export type DrawingTool = 'pen' | 'highlighter';

/** A single stroke drawn on the canvas. */
export interface Stroke {
  /** Array of [x, y] coordinate pairs in image-space. */
  points: number[];
  color: string;
  width: number;
  tool: DrawingTool;
}

/** Image source for the annotation panel. */
export interface AnnotationImage {
  /** URL or data-URI (data:image/…;base64,…) */
  src: string;
  name?: string;
}
