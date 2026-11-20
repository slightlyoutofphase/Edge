import { Vec2 } from "../../utils/Vec2";

export interface WeaponTrailComponent {
  boneId: string;
  tipOffset: Vec2; // Offset from bone origin to tip (e.g., {x: 40, y: 0})
  baseOffset: Vec2; // Offset from bone origin to base/hilt
  history: { base: Vec2; tip: Vec2 }[]; // Ring buffer or simple array
  maxLength: number;
  active: boolean; // Only record when attacking
  color: string;
}
