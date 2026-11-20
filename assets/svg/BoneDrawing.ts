export interface DrawingLayer {
  path: string;
  fill: string;
  stroke?: string;
  strokeWidth?: number;
}

export interface BoneDrawing extends DrawingLayer {
  layers?: DrawingLayer[];
  vector?: boolean; // Preserve fine detail when a large actor is scaled up.
  tipOffset?: { x: number; y: number };
}
