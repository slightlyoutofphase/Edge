import { Vec2 } from "./Vec2";

export interface AABB {
  x: number;
  y: number;
  width: number;
  height: number;
}

export function aabbIntersects(a: AABB, b: AABB): boolean {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

export function getOverlap(a: AABB, b: AABB, out: Vec2 = { x: 0, y: 0 }): Vec2 {
  out.x = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  out.y = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return out;
}
