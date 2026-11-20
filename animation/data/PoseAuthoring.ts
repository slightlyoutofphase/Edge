import { BonePose, Keyframe } from "../../features/animation/AnimationTypes";
import { PlayerSkeleton } from "../../skeleton/data/PlayerSkeleton";
import { Matrix2D } from "../../utils/Matrix2D";
import { SkeletonDef } from "../../features/animation/SkeletonTypes";
import { SpriteCache } from "../../utils/SpriteCache";

const matrixDefinitions = new WeakMap<Map<string, Matrix2D>, SkeletonDef>();
const identityMatrix = new Matrix2D();
// Separate scratch maps keep nested hand/grip solves from overwriting each other.
const handMatrices = new Map<string, Matrix2D>();
const gripMatrices = new Map<string, Matrix2D>();
const carryMatrices = new Map<string, Matrix2D>();
const bodyMatrices = new WeakMap<SkeletonDef, Map<string, Matrix2D>>();

export function guardPose(style = "player"): BonePose {
  const guards: Record<string, [number, number, number, number]> = {
    player: [0, 0, -45, 50],
    hollow: [15, 10, -35, 25],
    soldier: [0, -10, -45, 50],
    duelist: [-5, -25, -45, 70],
    rogue: [14, -15, -65, 65],
    brute: [6, -15, -35, 25],
    boss: [2, -20, -40, 38],
  };
  const [torso, shoulder, elbow, grip] = guards[style] ?? guards.player;
  return {
    hip: { translate: { x: 0, y: 0 }, rotate: 0 },
    torso: { rotate: torso },
    head: { rotate: style === "hollow" ? 15 : -torso / 3 },
    "shoulder-front": { rotate: shoulder },
    "arm-front-lower": { rotate: elbow },
    "shoulder-back": { rotate: 10 },
    "arm-back-lower": { rotate: -25 },
    "weapon-grip": { rotate: grip },
  };
}

export function bracePose(angle = 20, spread = 4): BonePose {
  return {
    "leg-front-upper": { rotate: -angle, translate: { x: spread, y: 0 } },
    "leg-front-lower": { rotate: 2 * angle },
    "foot-front": { rotate: -angle },
    "leg-back-upper": { rotate: -angle, translate: { x: -spread, y: 0 } },
    "leg-back-lower": { rotate: 2 * angle },
    "foot-back": { rotate: -angle },
  };
}

export function neutralLegsPose(): BonePose {
  return {
    "leg-front-upper": { rotate: -14, translate: { x: 3, y: 0 } },
    "leg-front-lower": { rotate: 22 },
    "foot-front": { rotate: -8 },
    "leg-back-upper": { rotate: 8, translate: { x: -3, y: 0 } },
    "leg-back-lower": { rotate: 6 },
    "foot-back": { rotate: -14 },
  };
}

// Explicit defaults at each key, with local overrides. This is authoring reuse;
// sparse-key interpolation retains its original neutral-default semantics.
export function stancePose(
  overrides: BonePose = {},
  angle = 0,
  spread = 0,
  style = "player",
): BonePose {
  const legs = angle === 0 && spread === 0 ? neutralLegsPose() : bracePose(angle, spread);
  return { ...guardPose(style), ...legs, ...overrides };
}

// Boots on every skin share a sole at local y=4. Solve only the pelvis height
// and ankle counter-rotation; authored knees and all gameplay origins stay intact.
// Applying this after interpolation also fixes the curved knee/linear hip mismatch.
export function plantFeet(pose: BonePose, clearance = 0): void {
  const hip = pose.hip ?? {};
  const hipAngle = hip.rotate ?? 0;
  const pivot = pose["body-pivot"] ?? {};
  const bodyAngle = pivot.rotate ?? 0;
  const bodyRadians = (bodyAngle * Math.PI) / 180;
  if (Math.abs(Math.cos(bodyRadians)) < 0.2) return;
  let lowest = -Infinity;
  for (const side of ["front", "back"]) {
    const upper = pose[`leg-${side}-upper`] ?? {},
      lower = pose[`leg-${side}-lower`] ?? {};
    const a = ((bodyAngle + hipAngle + (upper.rotate ?? 0)) * Math.PI) / 180;
    const b = a + ((lower.rotate ?? 0) * Math.PI) / 180;
    const h = ((bodyAngle + hipAngle) * Math.PI) / 180;
    const upperY =
      (upper.translate?.x ?? 0) * Math.sin(h) + (upper.translate?.y ?? 0) * Math.cos(h);
    const lowerPivot = PlayerSkeleton.bones.get(`leg-${side}-lower`)!.pivot;
    const footPivot = PlayerSkeleton.bones.get(`foot-${side}`)!.pivot;
    const y =
      upperY +
      (lowerPivot.x + (lower.translate?.x ?? 0)) * Math.sin(a) +
      (lowerPivot.y + (lower.translate?.y ?? 0)) * Math.cos(a) +
      footPivot.x * Math.sin(b) +
      footPivot.y * Math.cos(b) +
      4;
    lowest = Math.max(lowest, y);
    pose[`foot-${side}`] = {
      rotate: -(bodyAngle + hipAngle + (upper.rotate ?? 0) + (lower.rotate ?? 0)),
    };
  }
  const hipPivot = PlayerSkeleton.bones.get("hip")!.pivot;
  pose.hip = {
    ...hip,
    translate: {
      x: hip.translate?.x ?? 0,
      y:
        -hipPivot.y -
        (lowest +
          clearance +
          (pivot.translate?.y ?? 0) +
          (hipPivot.x + (hip.translate?.x ?? 0)) * Math.sin(bodyRadians)) /
          Math.cos(bodyRadians),
    },
  };
}

export function poseMatrices(
  pose: BonePose,
  definition: SkeletonDef = PlayerSkeleton,
  out?: Map<string, Matrix2D>,
): Map<string, Matrix2D> {
  const matrices = out ?? new Map<string, Matrix2D>();
  if (out && matrixDefinitions.get(out) !== definition) {
    out.clear();
    matrixDefinitions.set(out, definition);
  }
  const visit = (bone: typeof PlayerSkeleton.root, parent: Matrix2D) => {
    const p = pose[bone.id] ?? {};
    const existing = out ? matrices.get(bone.id) : undefined;
    const m = (existing ?? new Matrix2D()).copy(parent).translate(bone.pivot.x, bone.pivot.y);
    if (p.translate) m.translate(p.translate.x, p.translate.y);
    m.rotate(((p.rotate ?? 0) * Math.PI) / 180);
    if (p.scale) m.scale(p.scale.x, p.scale.y);
    if (!existing) matrices.set(bone.id, m);
    for (const child of bone.children) visit(child, m);
  };
  visit(definition.root, identityMatrix);
  return matrices;
}

export function restBody(
  pose: BonePose,
  paths: Record<string, { path: string }>,
  definition: SkeletonDef = PlayerSkeleton,
): void {
  let scratch = bodyMatrices.get(definition);
  if (!scratch) {
    scratch = new Map();
    bodyMatrices.set(definition, scratch);
  }
  const matrices = poseMatrices(pose, definition, scratch);
  let lowest = -Infinity;
  for (const [bone, drawing] of Object.entries(paths)) {
    const m = matrices.get(bone);
    if (!m) continue;
    if (Math.hypot(m.a, m.b) < 0.001) continue;
    // All limb/weapon paths are polygons. Head curves are enclosed by their
    // control points, so this conservative envelope also keeps the head clear.
    const values = SpriteCache.getCoordinates(drawing.path);
    for (let i = 0; i < values.length; i += 2) {
      lowest = Math.max(lowest, m.b * values[i] + m.d * values[i + 1] + m.ty);
    }
  }
  if (!Number.isFinite(lowest)) return;
  const pivot = pose["body-pivot"] ?? {};
  pose["body-pivot"] = {
    ...pivot,
    translate: {
      x: pivot.translate?.x ?? 0,
      y: (pivot.translate?.y ?? 0) - lowest,
    },
  };
}

// A two-segment arm placement for authored grips and a planted ladder hand.
// No skeleton hierarchy, movement constraint, or gameplay position is changed.
export function placeHand(
  pose: BonePose,
  side: "front" | "back",
  target: { x: number; y: number },
): void {
  const shoulder = poseMatrices(pose, PlayerSkeleton, handMatrices).get(`shoulder-${side}`)!;
  const dx = target.x - shoulder.tx,
    dy = target.y - shoulder.ty;
  const angle = Math.atan2(shoulder.b, shoulder.a);
  const x = Math.cos(angle) * dx + Math.sin(angle) * dy;
  const y = -Math.sin(angle) * dx + Math.cos(angle) * dy;
  const upper = PlayerSkeleton.bones.get(`arm-${side}-lower`)!.pivot.y;
  const lower = PlayerSkeleton.bones.get(`hand-${side}`)!.pivot.y;
  const distance = Math.max(
    Math.abs(upper - lower) + 0.01,
    Math.min(upper + lower - 0.01, Math.hypot(x, y)),
  );
  const elbow = -Math.acos(
    Math.max(
      -1,
      Math.min(1, (distance * distance - upper * upper - lower * lower) / (2 * upper * lower)),
    ),
  );
  const arm =
    Math.atan2(y, x) -
    Math.PI / 2 -
    Math.atan2(lower * Math.sin(elbow), upper + lower * Math.cos(elbow));
  pose[`arm-${side}-upper`] = { rotate: (arm * 180) / Math.PI };
  pose[`arm-${side}-lower`] = { rotate: (elbow * 180) / Math.PI };
}

// Keep a support hand attached after interpolation, transitions, and stance
// overrides. The small shoulder protraction stays inside the heavy actors' torso.
export function holdWeapon(pose: BonePose, grip: { x: number; y: number }): void {
  pose["shoulder-back"] = { rotate: 0, translate: { x: 7, y: 0 } };
  let matrices = poseMatrices(pose, PlayerSkeleton, gripMatrices);
  const upper = PlayerSkeleton.bones.get("arm-back-lower")!.pivot.y;
  const lower = PlayerSkeleton.bones.get("hand-back")!.pivot.y;
  // A blend from a released grip or a guard override can put the handle beyond
  // the support arm. Retract the leading wrist only in that case, preserving
  // the palm/blade direction; authored reachable attacks need no correction.
  for (let i = 0; i < 3; i++) {
    const blade = matrices.get("weapon")!,
      shoulder = matrices.get("shoulder-back")!;
    const target = {
      x: blade.a * grip.x + blade.c * grip.y + blade.tx,
      y: blade.b * grip.x + blade.d * grip.y + blade.ty,
    };
    const dx = target.x - shoulder.tx,
      dy = target.y - shoulder.ty,
      distance = Math.hypot(dx, dy);
    if (distance >= Math.abs(upper - lower) + 0.01 && distance <= upper + lower - 0.01) break;
    const reachable = Math.max(
      Math.abs(upper - lower) + 0.05,
      Math.min(upper + lower - 0.05, distance),
    );
    const wrist = matrices.get("hand-front")!;
    const joints = [
      "body-pivot",
      "hip",
      "torso",
      "shoulder-front",
      "arm-front-upper",
      "arm-front-lower",
    ];
    const angle =
      joints.reduce((sum, bone) => sum + (pose[bone]?.rotate ?? 0), 0) +
      (pose["hand-front"]?.rotate ?? 0);
    placeHand(pose, "front", {
      x: wrist.tx + (distance > 0.001 ? dx / distance : 1) * reachable - dx,
      y: wrist.ty + (distance > 0.001 ? dy / distance : 0) * reachable - dy,
    });
    pose["hand-front"] = {
      ...pose["hand-front"],
      rotate: angle - joints.reduce((sum, bone) => sum + (pose[bone]?.rotate ?? 0), 0),
    };
    matrices = poseMatrices(pose, PlayerSkeleton, gripMatrices);
  }
  const weapon = matrices.get("weapon")!;
  placeHand(pose, "back", {
    x: weapon.a * grip.x + weapon.c * grip.y + weapon.tx,
    y: weapon.b * grip.x + weapon.d * grip.y + weapon.ty,
  });
  matrices = poseMatrices(pose, PlayerSkeleton, gripMatrices);
  const forearm = matrices.get("arm-back-lower")!;
  const axis = matrices.get("weapon-grip")!;
  pose["hand-back"] = {
    rotate: ((Math.atan2(axis.b, axis.a) - Math.atan2(forearm.b, forearm.a)) * 180) / Math.PI - 90,
    scale: { x: 1, y: pose.weapon?.scale?.x ?? 1 },
  };
}

// Heavy attack authoring uses a primary wrist position and blade direction.
// Signed horizontal projection represents a lateral swing in this side view;
// scaling about the leading grip keeps the handle attached to the primary hand.
export function heavyWeaponPose(
  style: "brute" | "boss",
  x: number,
  y: number,
  blade: number,
  knees = 24,
  torso = 0,
  projection = 1,
): BonePose {
  const pose = stancePose(
    {
      torso: { rotate: torso },
      head: { rotate: -torso / 3 },
      "shoulder-front": { rotate: 0, translate: { x: 2, y: 0 } },
    },
    knees,
    4,
    style,
  );
  plantFeet(pose);
  placeHand(pose, "front", { x, y });
  setWeaponDirection(pose, blade);
  pose.weapon = { scale: { x: projection, y: 1 }, translate: { x: 6 * (1 - projection), y: 0 } };
  holdWeapon(pose, { x: -3, y: 0 });
  return pose;
}

export function weaponDirection(pose: BonePose): number {
  return [
    "body-pivot",
    "hip",
    "torso",
    "shoulder-front",
    "arm-front-upper",
    "arm-front-lower",
    "hand-front",
    "weapon-grip",
  ].reduce((sum, bone) => sum + (pose[bone]?.rotate ?? 0), 0);
}

export function setWeaponDirection(pose: BonePose, blade: number): void {
  // Use authored joint angles, not atan2's wrapped angle: otherwise a raised
  // wrist can send the interpolated blade around an unintended full turn.
  const angle = [
    "body-pivot",
    "hip",
    "torso",
    "shoulder-front",
    "arm-front-upper",
    "arm-front-lower",
    "hand-front",
  ].reduce((sum, bone) => sum + (pose[bone]?.rotate ?? 0), 0);
  pose["weapon-grip"] = { ...pose["weapon-grip"], rotate: blade - angle };
}

export function carryHeavyWeapon(pose: BonePose, blockZone?: 0 | 1 | 2 | 3): void {
  pose["shoulder-front"] = { rotate: 0, translate: { x: 2, y: 0 } };
  // The shared one-handed guard rotations cannot be layered onto placed arms.
  // Give the heavy grip its own high/mid/low hand targets on the same rig.
  const [x, y, blade] =
    blockZone === undefined
      ? [12, -2, -18]
      : [
          [10, -4, -35],
          [6, -18, -10],
          [10, -4, -75],
          [8, 4, -5],
        ][blockZone];
  if (blockZone === 3) Object.assign(pose, bracePose(35, 4));
  const torso = poseMatrices(pose, PlayerSkeleton, carryMatrices).get("torso")!;
  placeHand(pose, "front", {
    x: torso.a * x + torso.c * y + torso.tx,
    y: torso.b * x + torso.d * y + torso.ty,
  });
  setWeaponDirection(pose, blade);
  holdWeapon(pose, { x: -3, y: 0 });
}

export function gaitKeyframes(
  style: string,
  stride = 24,
  running = false,
  crouched = false,
): Keyframe[] {
  const times = [0, 0.125, 0.25, 0.375, 0.5, 0.625, 0.75, 0.875, 1];
  const guard = guardPose(style);
  const baseTorso = guard.torso.rotate ?? 0;
  const baseHead = guard.head.rotate ?? 0;
  const baseShoulderFront = guard["shoulder-front"].rotate ?? 0;
  const baseElbowFront = guard["arm-front-lower"].rotate ?? -45;
  const baseGrip = guard["weapon-grip"].rotate ?? 50;
  const baseShoulderBack = guard["shoulder-back"].rotate ?? 10;
  const baseElbowBack = guard["arm-back-lower"].rotate ?? -25;
  return times.map((time) => {
    const half = time % 1 < 0.5 ? 0 : 1;
    const phase = (time % 0.5) * 2;
    const front = half === 0;
    const base = crouched ? -48 : style === "rogue" ? -18 : -6;
    // Linear travel of the planted foot, rather than linear angular travel.
    const swing = Math.sin((stride * Math.PI) / 180);
    const supportUpper = (Math.asin(-swing + 2 * swing * phase) * 180) / Math.PI + base;
    const supportLower = -2 * base;
    const swingUpper = stride - 2 * stride * phase + base;
    const swingLower = -2 * base + (running ? 95 : 55) * Math.sin(Math.PI * phase);
    const swingCycle = Math.cos(2 * Math.PI * time);
    const doubleCycle = Math.cos(4 * Math.PI * time);
    const torsoLean = running ? 10 : crouched ? 10 : 3;
    const torsoBob = (running ? 2 : 1.5) * doubleCycle;
    const backAmp = running ? 34 : crouched ? 10 : 18;
    const frontAmp = running ? 11 : crouched ? 4 : 7;
    const bones: BonePose = {
      ...guard,
      torso: { rotate: baseTorso + torsoLean + torsoBob },
      head: { rotate: baseHead - (running ? 6 : crouched ? 6 : 2) - torsoBob },
      "shoulder-back": { rotate: baseShoulderBack - backAmp * swingCycle },
      "arm-back-lower": {
        rotate:
          (running ? -55 : crouched ? -35 : baseElbowBack - 3) +
          (running ? 12 : crouched ? 6 : 10) * swingCycle,
      },
      "shoulder-front": {
        rotate: baseShoulderFront + (running ? 12 : crouched ? 5 : 0) + frontAmp * swingCycle,
      },
      "arm-front-lower": {
        rotate:
          baseElbowFront -
          (running ? 12 : crouched ? 8 : 0) -
          (running ? 8 : crouched ? 4 : 5) * swingCycle +
          2 * doubleCycle,
      },
      "weapon-grip": {
        rotate:
          baseGrip +
          (running ? 8 : crouched ? 4 : 0) -
          (running ? 6 : 4) * swingCycle -
          3 * doubleCycle,
      },
    };
    for (const side of ["front", "back"]) {
      const supporting = (side === "front") === front;
      bones[`leg-${side}-upper`] = {
        rotate: supporting ? supportUpper : swingUpper,
        translate: { x: side === "front" ? 2 : -2, y: 0 },
      };
      bones[`leg-${side}-lower`] = { rotate: supporting ? supportLower : swingLower };
    }
    return {
      time,
      bones,
      easing: "linear",
      clearance: running ? 2.5 * Math.sin(Math.PI * phase) ** 2 : 0,
    };
  });
}

export function gaitReferenceSpeed(
  duration: number,
  stride: number,
  style = "player",
  crouched = false,
): number {
  const bend = crouched ? 48 : style === "rogue" ? 18 : 6;
  // Two plants per cycle, each traveling between the extreme ankle positions.
  return (
    (96 * Math.sin((stride * Math.PI) / 180) * Math.cos((bend * Math.PI) / 180)) / (duration / 1000)
  );
}
