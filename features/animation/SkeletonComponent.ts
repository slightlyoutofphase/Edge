import { BonePose } from "./AnimationTypes";
import { Matrix2D } from "../../utils/Matrix2D";
import { SkeletonDef } from "./SkeletonTypes";

export interface SkeletonComponent {
  offHandGripActive?: boolean; // Draw the supporting arm and hands over the handle.
  definitionId: string;
  definition?: SkeletonDef; // Runtime reference
  currentPose: BonePose;
  worldTransforms: Map<string, Matrix2D>;
  worldPosition?: { x: number; y: number };
  worldFacing?: 1 | -1;
}
