import { Vec2 } from "../../utils/Vec2";
import { BonePose } from "./AnimationTypes";

export interface BoneDef {
  id: string;
  pivot: Vec2; // Offset from parent origin
  children: BoneDef[];
  renderOrder: number;
}

export interface SkeletonDef {
  id: string;
  root: BoneDef;
  bones: Map<string, BoneDef>; // Flat map for lookup
  bindPose: BonePose;
}
