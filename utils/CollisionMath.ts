import { Vec2 } from "./Vec2";
import { AABB } from "./AABB";

// Rotated Rectangle
export interface OBB {
  center: Vec2;
  width: number;
  height: number;
  rotation: number; // Degrees
}

// Matrix-transformed rectangles can be sheared as well as reflected/scaled.
// Half-edge vectors preserve that shape without approximating it as an OBB.
export function parallelogramIntersectsAABB(center: Vec2, u: Vec2, v: Vec2, aabb: AABB): boolean {
  const dx = aabb.x + aabb.width / 2 - center.x;
  const dy = aabb.y + aabb.height / 2 - center.y;
  const halfWidth = aabb.width / 2,
    halfHeight = aabb.height / 2;
  if (
    Math.abs(dx) > halfWidth + Math.abs(u.x) + Math.abs(v.x) ||
    Math.abs(dy) > halfHeight + Math.abs(u.y) + Math.abs(v.y)
  )
    return false;
  const overlaps = (x: number, y: number) =>
    Math.abs(dx * x + dy * y) <=
    Math.abs(u.x * x + u.y * y) +
      Math.abs(v.x * x + v.y * y) +
      halfWidth * Math.abs(x) +
      halfHeight * Math.abs(y);
  return overlaps(-u.y, u.x) && overlaps(-v.y, v.x);
}

export function obbIntersectsAABB(obb: OBB, aabb: AABB): boolean {
  // Convert rotation to radians
  const rad = (obb.rotation * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  // OBB axes (normalized)
  const axisX = { x: cos, y: sin };
  const axisY = { x: -sin, y: cos };

  // AABB center
  const aabbCenter = { x: aabb.x + aabb.width / 2, y: aabb.y + aabb.height / 2 };

  // Distance vector between centers
  const dist = { x: aabbCenter.x - obb.center.x, y: aabbCenter.y - obb.center.y };

  // --- SAT Check ---
  // We need to check overlap on 4 axes: OBB_X, OBB_Y, Global_X, Global_Y

  // 1. Project onto OBB X Axis
  // Distance projection
  const distProjX = Math.abs(dist.x * axisX.x + dist.y * axisX.y);
  // Sum of half-widths
  // OBB half-width on this axis is just obb.width/2
  // AABB projection: dot(aabb_half_extents, axisX)
  const aabbExtX_on_OBB_X =
    (aabb.width / 2) * Math.abs(axisX.x) + (aabb.height / 2) * Math.abs(axisX.y);

  if (distProjX > obb.width / 2 + aabbExtX_on_OBB_X) return false;

  // 2. Project onto OBB Y Axis
  const distProjY = Math.abs(dist.x * axisY.x + dist.y * axisY.y);
  const aabbExtY_on_OBB_Y =
    (aabb.width / 2) * Math.abs(axisY.x) + (aabb.height / 2) * Math.abs(axisY.y);

  if (distProjY > obb.height / 2 + aabbExtY_on_OBB_Y) return false;

  // 3. Project onto Global X Axis (1, 0)
  const distGlobalX = Math.abs(dist.x);
  // OBB projection onto Global X
  const obbExt_on_Global_X = (obb.width / 2) * Math.abs(cos) + (obb.height / 2) * Math.abs(sin);

  if (distGlobalX > aabb.width / 2 + obbExt_on_Global_X) return false;

  // 4. Project onto Global Y Axis (0, 1)
  const distGlobalY = Math.abs(dist.y);
  const obbExt_on_Global_Y = (obb.width / 2) * Math.abs(sin) + (obb.height / 2) * Math.abs(cos);

  if (distGlobalY > aabb.height / 2 + obbExt_on_Global_Y) return false;

  return true;
}
