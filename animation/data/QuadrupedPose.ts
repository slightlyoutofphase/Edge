import { BonePose } from "../../features/animation/AnimationTypes";
import {
  QuadrupedSkeleton,
  QuadrupedLeg,
  QUADRUPED_LEGS,
} from "../../skeleton/data/QuadrupedSkeleton";
import { poseMatrices } from "./PoseAuthoring";
import { Matrix2D } from "../../utils/Matrix2D";

const pawMatrices = new Map<string, Matrix2D>();
const feetMatrices = new Map<string, Matrix2D>();

// Solve an individual paw in its parent's space. The two-segment chain keeps
// an anatomical elbow/hock bend; its paw stays level on the supporting surface.
export function placePaw(pose: BonePose, name: QuadrupedLeg, target: { x: number; y: number }) {
  const matrices = poseMatrices(pose, QuadrupedSkeleton, pawMatrices);
  const upperDef = QuadrupedSkeleton.bones.get(`${name}-upper`)!;
  const lowerDef = QuadrupedSkeleton.bones.get(`${name}-lower`)!;
  const pawDef = QuadrupedSkeleton.bones.get(`${name}-paw`)!;
  const parent = matrices.get(name.startsWith("hind") ? "pelvis" : "chest")!;
  const det = parent.a * parent.d - parent.b * parent.c;
  const wx = target.x - parent.tx,
    wy = target.y - parent.ty;
  const dx = (parent.d * wx - parent.c * wy) / det - upperDef.pivot.x;
  const dy = (-parent.b * wx + parent.a * wy) / det - upperDef.pivot.y;
  const l1 = Math.hypot(lowerDef.pivot.x, lowerDef.pivot.y),
    l2 = Math.hypot(pawDef.pivot.x, pawDef.pivot.y);
  const distance = Math.max(0.1, Math.min(l1 + l2 - 0.001, Math.hypot(dx, dy)));
  const bend = name.startsWith("hind") ? -1 : 1;
  const elbow =
    bend *
    Math.acos(Math.max(-1, Math.min(1, (distance * distance - l1 * l1 - l2 * l2) / (2 * l1 * l2))));
  const theta = Math.atan2(dy, dx) - Math.atan2(l2 * Math.sin(elbow), l1 + l2 * Math.cos(elbow));
  const upper = ((theta - Math.atan2(lowerDef.pivot.y, lowerDef.pivot.x)) * 180) / Math.PI;
  const lower =
    ((elbow +
      Math.atan2(lowerDef.pivot.y, lowerDef.pivot.x) -
      Math.atan2(pawDef.pivot.y, pawDef.pivot.x)) *
      180) /
    Math.PI;
  pose[`${name}-upper`] = { rotate: upper };
  pose[`${name}-lower`] = { rotate: lower };
  const parentAngle = (Math.atan2(parent.b, parent.a) * 180) / Math.PI;
  pose[`${name}-paw`] = { rotate: -parentAngle - upper - lower };
}

// Compensate interpolation and torso/rear motion without moving the collider.
// Raised front paws remain free for the rearing swipe; grounded hind paws anchor it.
export function plantQuadrupedFeet(pose: BonePose, clearance = 0) {
  for (const leg of QUADRUPED_LEGS) pose[`${leg}-paw`] = { ...pose[`${leg}-paw`], rotate: 0 };
  let matrices = poseMatrices(pose, QuadrupedSkeleton, feetMatrices);
  for (const leg of QUADRUPED_LEGS) {
    const paw = matrices.get(`${leg}-paw`)!;
    // Solve in the transformed basis, including non-uniform breathing scale.
    const angle = (Math.atan2(-paw.b, paw.d) * 180) / Math.PI;
    pose[`${leg}-paw`] = { ...pose[`${leg}-paw`], rotate: angle };
  }
  matrices = poseMatrices(pose, QuadrupedSkeleton, feetMatrices);
  const lowest = Math.max(
    ...QUADRUPED_LEGS.map((leg) => {
      const paw = matrices.get(`${leg}-paw`)!;
      return paw.ty + 2 * paw.d;
    }),
  );
  const pivot = pose["body-pivot"] ?? {};
  pose["body-pivot"] = {
    ...pivot,
    translate: { x: pivot.translate?.x ?? 0, y: (pivot.translate?.y ?? 0) - lowest - clearance },
  };
}

export function quadrupedPose(overrides: BonePose = {}): BonePose {
  const neutral: BonePose = {};
  for (const id of QuadrupedSkeleton.bones.keys()) neutral[id] = { rotate: 0 };
  for (const leg of QUADRUPED_LEGS) {
    const anchor =
      leg === "fore-near" ? 11 : leg === "fore-far" ? 19 : leg === "hind-near" ? -16 : -11;
    placePaw(neutral, leg, { x: anchor, y: -2 });
  }
  const pose = { ...neutral, ...overrides };
  plantQuadrupedFeet(pose);
  return pose;
}
