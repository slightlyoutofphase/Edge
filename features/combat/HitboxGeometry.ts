import { World } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { InventoryComponent } from "../../components/Inventory";
import { SkeletonComponent } from "../animation/SkeletonComponent";
import { ActiveHitboxComponent } from "./ActiveHitboxComponent";
import { actorWeaponPath, drawingBounds } from "./ContactGeometry";
import { WEAPONS, WeaponDef } from "../../data/WeaponDefinitions";
import { WeaponPaths } from "../../assets/svg/WeaponSVGs";
import { AABB } from "../../utils/AABB";
import { Vec2 } from "../../utils/Vec2";
import { parallelogramIntersectsAABB } from "../../utils/CollisionMath";

export interface HitboxShape {
  center: Vec2;
  u: Vec2;
  v: Vec2;
}

export interface HitboxInput {
  width?: number;
  height?: number;
  offset?: { x?: number; y?: number };
  rotation?: number;
  attachedToBone?: string;
}

export interface ResolvedHitboxBounds {
  width: number;
  height: number;
  offset: Vec2;
  rotation: number;
}

// Single source of truth for attack hitbox size, offset, and orientation across
// gameplay spawning, AI reach prediction, and AnimationViewer overlays.
export function resolveAttackHitbox(
  world: World,
  entityId: number,
  data: HitboxInput,
  weaponOverride?: WeaponDef,
): ResolvedHitboxBounds {
  const inventory = world.getComponent<InventoryComponent>(entityId, "Inventory");
  const weapon = weaponOverride ?? (inventory ? WEAPONS[inventory.currentWeapon] : undefined);

  if (data.attachedToBone === "weapon") {
    const weaponPath =
      (weapon ? WeaponPaths[weapon.svgAsset]?.path : undefined) ?? actorWeaponPath(world, entityId);
    if (weaponPath) {
      const box = drawingBounds(weaponPath, 0);
      // Clip rear handles/pommels behind the hand grip (x < 0) so hitboxes cover the striking blade only.
      const startX = box.x < 0 && box.x + box.width > 0 ? 0 : box.x;
      const endX = box.x + box.width;
      const width = Math.max(1, endX - startX);
      const height = Math.max(1, box.height);
      return {
        width,
        height,
        offset: {
          x: startX + width / 2,
          y: box.y + box.height / 2,
        },
        rotation: 0,
      };
    }
  }

  const reachScale = weapon ? weapon.reach / WEAPONS.longsword.reach : 1;
  return {
    width: (data.width ?? 0) * reachScale,
    height: data.height ?? 0,
    offset: {
      x: (data.offset?.x ?? 0) * reachScale,
      y: data.offset?.y ?? 0,
    },
    rotation: data.rotation || 0,
  };
}

// Half-edges retain bone shear, reflection and foreshortening, as well as rotation.
export function hitboxShape(
  world: World,
  hitbox: ActiveHitboxComponent,
  transform: TransformComponent,
): HitboxShape {
  const matrix =
    hitbox.attachedToBone &&
    world
      .getComponent<SkeletonComponent>(hitbox.sourceEntityId, "Skeleton")
      ?.worldTransforms.get(hitbox.attachedToBone);
  const angle =
    ((matrix ? hitbox.rotation : transform.facing === 1 ? hitbox.rotation : 180 - hitbox.rotation) *
      Math.PI) /
    180;
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  if (matrix)
    return {
      center: {
        x: matrix.a * hitbox.offset.x + matrix.c * hitbox.offset.y + matrix.tx,
        y: matrix.b * hitbox.offset.x + matrix.d * hitbox.offset.y + matrix.ty,
      },
      u: {
        x: ((matrix.a * cos + matrix.c * sin) * hitbox.width) / 2,
        y: ((matrix.b * cos + matrix.d * sin) * hitbox.width) / 2,
      },
      v: {
        x: ((-matrix.a * sin + matrix.c * cos) * hitbox.height) / 2,
        y: ((-matrix.b * sin + matrix.d * cos) * hitbox.height) / 2,
      },
    };
  const w = (hitbox.width * Math.abs(transform.scale.x)) / 2,
    h = (hitbox.height * transform.scale.y) / 2;
  return {
    center: {
      x: transform.position.x + hitbox.offset.x * Math.abs(transform.scale.x) * transform.facing,
      y: transform.position.y + hitbox.offset.y * transform.scale.y,
    },
    u: { x: cos * w, y: sin * w },
    v: { x: -sin * h, y: cos * h },
  };
}

export function shapeBounds(shape: HitboxShape): AABB {
  const x = Math.abs(shape.u.x) + Math.abs(shape.v.x),
    y = Math.abs(shape.u.y) + Math.abs(shape.v.y);
  return { x: shape.center.x - x, y: shape.center.y - y, width: 2 * x, height: 2 * y };
}

export function interpolateShape(a: HitboxShape, b: HitboxShape, t: number): HitboxShape {
  const mix = (x: Vec2, y: Vec2) => ({ x: x.x + (y.x - x.x) * t, y: x.y + (y.y - x.y) * t });
  return { center: mix(a.center, b.center), u: mix(a.u, b.u), v: mix(a.v, b.v) };
}

function corners(s: HitboxShape): Vec2[] {
  return [
    [-1, -1],
    [1, -1],
    [1, 1],
    [-1, 1],
  ].map(([u, v]) => ({
    x: s.center.x + u * s.u.x + v * s.v.x,
    y: s.center.y + u * s.u.y + v * s.v.y,
  }));
}

function hull(points: Vec2[]): Vec2[] {
  points.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (a: Vec2, b: Vec2, c: Vec2) =>
    (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  const half = (list: Vec2[]) => {
    const out: Vec2[] = [];
    for (const p of list) {
      while (out.length > 1 && cross(out[out.length - 2], out[out.length - 1], p) <= 0) out.pop();
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(points), ...half([...points].reverse())];
}

// Clip only confirmed contacts. The average of the clipped vertices lies in
// both convex shapes, so effects do not float at the weapon hitbox's center.
function contactPoint(polygon: Vec2[], box: AABB): Vec2 | undefined {
  let points = polygon;
  for (const [axis, edge, sign] of [
    ["x", box.x, 1],
    ["x", box.x + box.width, -1],
    ["y", box.y, 1],
    ["y", box.y + box.height, -1],
  ] as const) {
    const clipped: Vec2[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i],
        b = points[(i + 1) % points.length];
      const insideA = (a[axis] - edge) * sign >= -1e-8,
        insideB = (b[axis] - edge) * sign >= -1e-8;
      if (insideA) clipped.push(a);
      if (insideA !== insideB) {
        const t = (edge - a[axis]) / (b[axis] - a[axis]);
        clipped.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    points = clipped;
    if (!points.length) return undefined;
  }
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

export function sweptContact(
  from: HitboxShape,
  to: HitboxShape,
  box: AABB,
): { time: number; point: Vec2 } | undefined {
  if (parallelogramIntersectsAABB(from.center, from.u, from.v, box)) {
    const point = contactPoint(corners(from), box);
    if (point) return { time: 0, point };
  }
  const a = corners(from),
    b = corners(to);
  const travel = Math.max(...a.map((p, i) => Math.hypot(b[i].x - p.x, b[i].y - p.y)));
  if (travel < 1e-6) return undefined;
  // Short hull segments bound rotating/scaling blades without testing only
  // isolated poses. Work is capped even for a very fast or large weapon.
  const steps = Math.min(
    32,
    Math.max(1, Math.ceil(travel / Math.max(2, Math.min(box.width, box.height) / 2))),
  );
  let previous = from;
  for (let i = 1; i <= steps; i++) {
    const end = i / steps,
      next = interpolateShape(from, to, end);
    let point = contactPoint(hull([...corners(previous), ...corners(next)]), box);
    if (point) {
      let low = (i - 1) / steps,
        high = end;
      // Find the first contact, allowing walls to win over targets behind them.
      for (let j = 0; j < 7; j++) {
        const mid = (low + high) / 2;
        const candidate = contactPoint(
          hull([...corners(previous), ...corners(interpolateShape(from, to, mid))]),
          box,
        );
        if (candidate) {
          high = mid;
          point = candidate;
        } else low = mid;
      }
      return { time: high, point };
    }
    previous = next;
  }
  return undefined;
}

// Express the attacking shape in the receiving bone's coordinates, retaining
// reflection/shear. The existing swept rectangle solver then handles both.
export function sweptShapeContact(
  from: HitboxShape,
  to: HitboxShape,
  target: HitboxShape,
): ReturnType<typeof sweptContact> {
  const a = shapeBounds(from),
    b = shapeBounds(to),
    t = shapeBounds(target);
  if (
    Math.min(a.x, b.x) > t.x + t.width ||
    Math.max(a.x + a.width, b.x + b.width) < t.x ||
    Math.min(a.y, b.y) > t.y + t.height ||
    Math.max(a.y + a.height, b.y + b.height) < t.y
  )
    return;
  const det = target.u.x * target.v.y - target.u.y * target.v.x;
  if (Math.abs(det) < 1e-6) return;
  const vector = (p: Vec2) => ({
    x: (p.x * target.v.y - p.y * target.v.x) / det,
    y: (target.u.x * p.y - target.u.y * p.x) / det,
  });
  const local = (s: HitboxShape): HitboxShape => ({
    center: vector({ x: s.center.x - target.center.x, y: s.center.y - target.center.y }),
    u: vector(s.u),
    v: vector(s.v),
  });
  const contact = sweptContact(local(from), local(to), { x: -1, y: -1, width: 2, height: 2 });
  if (contact)
    return {
      time: contact.time,
      point: {
        x: target.center.x + target.u.x * contact.point.x + target.v.x * contact.point.y,
        y: target.center.y + target.u.y * contact.point.x + target.v.y * contact.point.y,
      },
    };
  return;
}
