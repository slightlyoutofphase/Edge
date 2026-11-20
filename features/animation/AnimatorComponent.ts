import { AnimationLayer, AnimationEvent, BonePose } from "./AnimationTypes";

export interface AnimatorComponent {
  layers: AnimationLayer[];

  // Primary animation state (convenience for single-layer/main layer)
  currentAnim: string;
  time: number;

  // Blending
  blendFrom: string | null;
  blendFromTime: number;
  blendDuration: number;
  blendElapsed: number;
  blendFromPose?: BonePose;
  transitionPending?: boolean;
  sampledAnimation?: string;
  climbPlant?: { halfCycle: number; side: "front" | "back"; y: number };

  // Event flags
  pendingEvents: AnimationEvent[];

  // Map of last fired event indices per animation/layer to avoid double firing
  // Key: layerIndex_animName, Value: last event index processed
  eventState: Map<string, number>;
}
