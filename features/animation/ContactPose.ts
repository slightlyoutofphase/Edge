import { World } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { ColliderComponent } from "../../components/Collider";
import { PlatformComponent } from "../../components/Platform";
import { HealthComponent } from "../../components/Health";
import { SpatialGridState } from "../../core/Resources";
import { AnimatorComponent } from "./AnimatorComponent";
import { SkeletonComponent } from "./SkeletonComponent";
import { BonePose } from "./AnimationTypes";
import {
  poseMatrices,
  placeHand,
  holdWeapon,
  weaponDirection,
  setWeaponDirection,
} from "../../animation/data/PoseAuthoring";
import { actorWeaponPath, drawingBounds, matrixShape } from "../combat/ContactGeometry";
import { shapeBounds, sweptContact } from "../combat/HitboxGeometry";
import { Matrix2D } from "../../utils/Matrix2D";
import { SpriteCache } from "../../utils/SpriteCache";
import { Animation } from "./AnimationTypes";
import { bodySeparationBounds } from "../combat/BodySeparation";

const amounts = new WeakMap<AnimatorComponent, number>();
const matrices = new WeakMap<AnimatorComponent, Map<string, Matrix2D>>();
const candidates: number[] = [];

export function blendWeaponDirection(
  pose: BonePose,
  from: number,
  to: number,
  weight: number,
): void {
  const delta = ((((to - from + 540) % 360) + 360) % 360) - 180;
  setWeaponDirection(pose, from + delta * weight);
}

// A resting weapon is harmless. Retract the carrying pose when a body or a
// wall crowds it, instead of turning the blade into a permanent damage hazard.
export function avoidCarryOverlap(
  world: World,
  id: number,
  pose: BonePose,
  dt: number,
  reference: BonePose = pose,
): void {
  const skeleton = world.getComponent<SkeletonComponent>(id, "Skeleton")!,
    animator = world.getComponent<AnimatorComponent>(id, "Animator")!,
    transform = world.getComponent<TransformComponent>(id, "Transform")!,
    grids = world.getResource<SpatialGridState>(SpatialGridState);
  const path = actorWeaponPath(world, id);
  if (!path || !skeleton.definition || !grids) return;
  let scratch = matrices.get(animator);
  if (!scratch) {
    scratch = new Map();
    matrices.set(animator, scratch);
  }
  const weapon = poseMatrices(reference, skeleton.definition, scratch).get("weapon");
  if (!weapon) return;
  const worldMatrix = new Matrix2D()
    .translate(transform.position.x, transform.position.y)
    .scale(transform.facing * transform.scale.x, transform.scale.y)
    .multiply(weapon);
  const shape = matrixShape(worldMatrix, drawingBounds(path, 0)),
    bounds = shapeBounds(shape);
  const old = amounts.get(animator) ?? 0,
    margin = old > 0 ? 4 * Math.abs(transform.scale.x) : 0;
  bounds.x -= margin;
  bounds.y -= margin;
  bounds.width += margin * 2;
  bounds.height += margin * 2;
  let blocked = false;
  for (const grid of [grids.staticGrid, grids.dynamicGrid])
    for (const other of grid.query(bounds, candidates)) {
      if (other === id) continue;
      const t = world.getComponent<TransformComponent>(other, "Transform"),
        c = world.getComponent<ColliderComponent>(other, "Collider");
      const platform = world.getComponent<PlatformComponent>(other, "Platform"),
        health = world.getComponent<HealthComponent>(other, "Health");
      if (
        !t ||
        !c ||
        (platform && (platform.type !== "solid" || platform.collidable === false)) ||
        (!platform && (!health || health.isDead || health.current <= 0))
      )
        continue;
      for (const b of c.hurtboxes) {
        const box = platform
          ? {
              x: t.position.x + b.x * Math.abs(t.scale.x),
              y: t.position.y + b.y * t.scale.y,
              width: b.width * Math.abs(t.scale.x),
              height: b.height * t.scale.y,
            }
          : bodySeparationBounds(world, other);
        if (platform && box.y >= transform.position.y - 2) continue;
        box.x -= margin;
        box.y -= margin;
        box.width += margin * 2;
        box.height += margin * 2;
        if (sweptContact(shape, shape, box)) {
          blocked = true;
          break;
        }
      }
      if (blocked) break;
    }
  const amount = Math.max(0, Math.min(1, old + ((blocked ? 1 : -1) * dt) / 100));
  amounts.set(animator, amount);
  if (amount <= 0) return;
  const angle = weaponDirection(pose),
    parts = ["shoulder-front", "arm-front-upper", "arm-front-lower", "hand-front", "weapon-grip"];
  const from = Object.fromEntries(parts.map((b) => [b, { ...pose[b] }]));
  placeHand(pose, "front", { x: 7, y: -36 });
  setWeaponDirection(pose, -100);
  for (const bone of parts) {
    const to = pose[bone] ?? {},
      start = from[bone];
    const a = start.rotate ?? 0,
      b = to.rotate ?? 0;
    pose[bone] = { ...to, rotate: a + (((((b - a + 540) % 360) + 360) % 360) - 180) * amount };
  }
  blendWeaponDirection(pose, angle, -100, amount);
}

// Blends and recoil overlays can be legal at both endpoints yet dip the blade
// through the support surface in between. Correct only those displayed poses,
// keeping the wrist/feet origins and the authored clips intact.
export function keepWeaponAboveSupport(
  world: World,
  id: number,
  pose: BonePose,
  clip: Animation,
): void {
  const s = world.getComponent<SkeletonComponent>(id, "Skeleton")!,
    a = world.getComponent<AnimatorComponent>(id, "Animator")!;
  const path = actorWeaponPath(world, id);
  if (!s.definition || !path || clip.bodyContact || !s.definition.bones.has("weapon-grip")) return;
  let scratch = matrices.get(a);
  if (!scratch) {
    scratch = new Map();
    matrices.set(a, scratch);
  }
  const vertices = SpriteCache.getCoordinates(path);
  const depth = () => {
    const m = poseMatrices(pose, s.definition!, scratch).get("weapon")!;
    let y = -Infinity;
    for (let i = 0; i < vertices.length; i += 2)
      y = Math.max(y, m.b * vertices[i] + m.d * vertices[i + 1] + m.ty);
    return y;
  };
  for (let attempt = 0; attempt < 3 && depth() > 0.1; attempt++) {
    const m = scratch.get("weapon")!,
      grip = (pose["weapon-grip"] ??= {}),
      start = grip.rotate ?? 0;
    const angle = (Math.atan2(m.b, m.a) * 180) / Math.PI,
      delta = ((((-90 - angle + 540) % 360) + 360) % 360) - 180;
    let low = 0,
      high = 1;
    for (let i = 0; i < 9; i++) {
      const mid = (low + high) / 2;
      grip.rotate = start + delta * mid;
      if (depth() > -0.25) low = mid;
      else high = mid;
    }
    grip.rotate = start + delta * high;
    if (clip.offHandGrip) holdWeapon(pose, clip.offHandGrip);
  }
}
