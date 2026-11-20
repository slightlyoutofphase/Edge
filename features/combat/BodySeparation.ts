import { World } from "../../core/World";
import { TransformComponent } from "../../components/Transform";
import { ColliderComponent } from "../../components/Collider";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { SkeletonComponent } from "../animation/SkeletonComponent";
import { AssetLoader } from "../../assets/AssetLoader";
import { EnemyBonePaths } from "../../assets/svg/EnemySVGs";
import { PlayerBonePaths } from "../../assets/svg/PlayerSVG";
import { poseMatrices } from "../../animation/data/PoseAuthoring";
import { drawingBounds, matrixShape } from "./ContactGeometry";
import { shapeBounds } from "./HitboxGeometry";
import { AABB } from "../../utils/AABB";

const footprints = new Map<
  string,
  { revision: number; left: number; right: number; coreLeft: number; coreRight: number }
>();

// Character-to-character clearance has its own stable neutral body footprint.
// Arms, weapons, ears and tails are not solid obstacles. Animation swings never
// inflate this footprint; terrain/navigation keep the existing movement box.
// A quadruped's explicit rear posture lifts its muzzle out of the ground-level
// corridor, so that posture uses the core footprint instead of a phantom head.
export function bodySeparationBounds(world: World, id: number, out?: AABB): AABB {
  const t = world.getComponent<TransformComponent>(id, "Transform")!,
    c = world.getComponent<ColliderComponent>(id, "Collider")!;
  const box = c.hurtboxes[0],
    skin = world.getComponent<EnemyTagComponent>(id, "EnemyTag")?.enemyType ?? "player";
  const s = world.getComponent<SkeletonComponent>(id, "Skeleton"),
    rig = s?.definition ?? (s && AssetLoader.getSkeleton(s.definitionId));
  let footprint = footprints.get(skin);
  if (rig && (!footprint || footprint.revision !== AssetLoader.animationRevision)) {
    const idle = AssetLoader.getAnimation("idle", { skin }),
      art = skin === "player" ? PlayerBonePaths : EnemyBonePaths[skin];
    let left = box.x,
      right = box.x + box.width;
    let coreLeft = left,
      coreRight = right;
    if (art) {
      const matrices = poseMatrices(idle?.keyframes[0]?.bones ?? {}, rig);
      for (const bone of ["chest", "torso", "pelvis", "neck", "head"]) {
        const m = matrices.get(bone),
          path = art[bone]?.path;
        if (!m || !path) continue;
        const b = shapeBounds(matrixShape(m, drawingBounds(path, 0)));
        // Keep outlines/fur out of the solid core, while never shrinking the
        // locomotion box. This small inset avoids demanding penetration to
        // reach flesh at a muzzle-to-body contact.
        left = Math.min(left, b.x + 1);
        right = Math.max(right, b.x + b.width - 1);
        if (bone !== "head" && bone !== "neck") {
          coreLeft = left;
          coreRight = right;
        }
      }
    }
    footprint = { revision: AssetLoader.animationRevision, left, right, coreLeft, coreRight };
    footprints.set(skin, footprint);
  }
  const rearing = rig?.bones.has("fore-near-paw") && box.height > 50;
  const left = rig ? ((rearing ? footprint?.coreLeft : footprint?.left) ?? box.x) : box.x;
  const right = rig
      ? ((rearing ? footprint?.coreRight : footprint?.right) ?? box.x + box.width)
      : box.x + box.width,
    scale = Math.abs(t.scale.x);
  const bounds = out ?? { x: 0, y: 0, width: 0, height: 0 };
  bounds.x = t.position.x + (t.facing === 1 ? left : -right) * scale;
  bounds.y = t.position.y + box.y * t.scale.y;
  bounds.width = (right - left) * scale;
  bounds.height = box.height * t.scale.y;
  return bounds;
}

export function bodyContactDistance(world: World, sourceId: number, targetId: number): number {
  const a = world.getComponent<TransformComponent>(sourceId, "Transform")!,
    b = world.getComponent<TransformComponent>(targetId, "Transform")!;
  const aa = bodySeparationBounds(world, sourceId),
    bb = bodySeparationBounds(world, targetId);
  return b.position.x >= a.position.x
    ? aa.x + aa.width - a.position.x + b.position.x - bb.x
    : a.position.x - aa.x + bb.x + bb.width - b.position.x;
}
