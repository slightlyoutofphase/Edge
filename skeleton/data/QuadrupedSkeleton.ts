import { BoneDef, SkeletonDef } from "../../features/animation/SkeletonTypes";
import { SkeletonKey } from "../../core/AssetKeys";

const bone = (
  id: string,
  x: number,
  y: number,
  order: number,
  children: BoneDef[] = [],
): BoneDef => ({ id, pivot: { x, y }, renderOrder: order, children });

// Facing right in local space; root remains the physics feet origin. Near/far
// identify depth, and fore/hind identify the two independent pairs of legs.
export const QUADRUPED_LEGS = ["hind-far", "fore-far", "hind-near", "fore-near"] as const;
export type QuadrupedLeg = (typeof QUADRUPED_LEGS)[number];
function leg(name: QuadrupedLeg, x: number, y: number, order: number) {
  const hind = name.startsWith("hind");
  return bone(`${name}-upper`, x, y, order, [
    bone(`${name}-lower`, hind ? 7 : 0, hind ? 12 : 13, order, [
      bone(`${name}-paw`, hind ? -8 : 1, hind ? 9 : 12, order),
    ]),
  ]);
}

const root = bone("root", 0, 0, 0, [
  bone("body-pivot", 0, 0, 0, [
    bone("pelvis", -13, -22, 3, [
      leg("hind-far", 3, 0, 1),
      leg("hind-near", -2, 0, 6),
      bone("tail-base", -4, -3, 2, [bone("tail-mid", -10, 4, 2, [bone("tail-tip", -9, 7, 2)])]),
      bone("torso", 0, 0, 4, [
        bone("chest", 26, -2, 5, [
          leg("fore-far", 5, 0, 1),
          leg("fore-near", -3, 0, 7),
          bone("neck", 3, -4, 8, [
            bone("head", 4, -7, 9, [
              bone("ear-far", -1, -4, 8),
              bone("ear-near", -4, -4, 10),
              bone("jaw", 2, 1, 9.5),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]),
]);
const bones = new Map<string, BoneDef>();
function flatten(def: BoneDef) {
  bones.set(def.id, def);
  def.children.forEach(flatten);
}
flatten(root);

export const QuadrupedSkeleton: SkeletonDef = {
  id: SkeletonKey.QUADRUPED,
  root,
  bones,
  bindPose: {},
};

// These are rig units. World size is selected by the archetype, not by new rigs.
export const QUADRUPED_HURTBOX = { x: -25, y: -50, width: 50, height: 50 };
export const HELLHOUND_SCALE = 0.46;
export const ALPHA_HELLHOUND_SCALE = 2;
