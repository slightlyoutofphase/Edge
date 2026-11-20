import { SkeletonDef, BoneDef } from "../../features/animation/SkeletonTypes";

// Helper to create bone recursively
function createBone(
  id: string,
  pivotX: number,
  pivotY: number,
  renderOrder: number,
  children: BoneDef[] = [],
): BoneDef {
  return {
    id,
    pivot: { x: pivotX, y: pivotY },
    renderOrder,
    children,
  };
}

const root = createBone("root", 0, 0, 0, [
  createBone("body-pivot", 0, 0, 0, [
    // Changed hip Y from -24 to -28 to lift skeleton 4px.
    // Leg lengths (12 + 12) = 24. With hip at -24, ankle is at 0, foot geometry (0..4) is underground.
    // With hip at -28, ankle is at -4. Foot geometry (0..4 relative to ankle) goes from -4 to 0. Perfect ground alignment.
    createBone("hip", 0, -28, 3, [
      // Back Leg
      createBone("leg-back-upper", 0, 0, 1, [
        createBone("leg-back-lower", 0, 12, 1, [createBone("foot-back", 0, 12, 1)]),
      ]),
      // Front Leg
      createBone("leg-front-upper", 0, 0, 5, [
        createBone("leg-front-lower", 0, 12, 5, [createBone("foot-front", 0, 12, 5)]),
      ]),
      // Torso
      createBone("torso", 0, 0, 4, [
        // Back Arm
        createBone("shoulder-back", -6, -10, 2, [
          createBone("arm-back-upper", 0, 0, 2, [
            createBone("arm-back-lower", 0, 10, 2, [
              createBone("hand-back", 0, 8, 2, [createBone("off-hand-item", 2, 0, 2)]),
            ]),
          ]),
        ]),
        // Neck/Head
        createBone("neck", 0, -12, 6, [createBone("head", 0, -4, 6)]),
        // Front Arm
        createBone("shoulder-front", 6, -10, 7, [
          createBone("arm-front-upper", 0, 0, 7, [
            createBone("arm-front-lower", 0, 10, 7, [
              createBone("hand-front", 0, 8, 7, [
                createBone("weapon-grip", 0, 2, 8, [createBone("weapon", -6, 0, 8)]),
              ]),
            ]),
          ]),
        ]),
      ]),
    ]),
  ]),
]);

// Flatten bones for map
function flattenBones(bone: BoneDef, map: Map<string, BoneDef>) {
  map.set(bone.id, bone);
  bone.children.forEach((c) => flattenBones(c, map));
}

const boneMap = new Map<string, BoneDef>();
flattenBones(root, boneMap);

export const PlayerSkeleton: SkeletonDef = {
  id: "player-skeleton",
  root,
  bones: boneMap,
  bindPose: {},
};
