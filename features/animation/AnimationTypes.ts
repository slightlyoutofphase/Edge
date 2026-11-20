export type EasingType = "linear" | "ease-in" | "ease-out" | "ease-in-out";

export type BonePose = Record<
  string,
  {
    rotate?: number; // Degrees
    translate?: { x: number; y: number };
    scale?: { x: number; y: number };
  }
>;

export interface Keyframe {
  time: number; // 0.0 to 1.0 normalized
  bones: BonePose;
  easing?: EasingType; // Easing to NEXT keyframe
  clearance?: number; // Visual support clearance above the feet origin, in rig units.
}

export interface AnimationEvent {
  time: number; // 0.0 to 1.0 normalized
  type:
    | "hitbox-start"
    | "hitbox-end"
    | "sound"
    | "effect"
    | "branch"
    | "counter-window-start"
    | "counter-window-end";
  data?: any;
}

export interface Animation {
  name: string;
  duration: number; // ms
  loop: boolean;
  keyframes: Keyframe[];
  events?: AnimationEvent[];
  zone?: 1 | 2 | 3; // For directional attacks
  grounded?: boolean; // Compensate bent legs after interpolation; never moves physics.
  bodyContact?: boolean; // Roll/corpse envelope rather than standing-foot contact.
  gaitSpeed?: number; // Reference local units/s for movement-driven playback.
  offHandGrip?: { x: number; y: number }; // Support wrist, in weapon-local coordinates.
  windupMs?: number; // An authored enemy windup override, shared with the preview.
  engagementRange?: number; // Optional local engagement cap for a compact strike.
  skeletonId?: string; // Explicit rig for non-humanoid clips and support solving.
  motion?: { start: number; end: number; speed: number; lift?: number }; // Clip-normalized physical attack movement.
  bodyHeight?: number; // Local hurtbox height while a creature rears up.
}

export interface AnimationLayer {
  name: string;
  boneMask: Set<string>;
  animation: Animation | null;
  time: number;
  weight: number;
  blendMode: "override" | "additive";
  priority: number;
}
