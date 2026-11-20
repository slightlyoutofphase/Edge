import { Vec2 } from "../../utils/Vec2";
import { EntityId } from "../../core/World";
import type { HitboxShape } from "./HitboxGeometry";

export interface ActiveHitboxComponent {
  // Shape (relative to entity or bone origin)
  offset: Vec2;
  width: number;
  height: number;
  rotation: number; // Degrees

  // Combat data
  damage: number;
  poiseDamage: number;
  knockback: Vec2; // X usually positive (magnitude), direction decided by facing
  zone: 1 | 2 | 3;
  attackType: "light" | "heavy" | "slide" | "jump";

  // State tracking
  alreadyHit: Set<EntityId>; // Prevents multi-hit per swing
  clashedWith?: Set<EntityId>;
  attachedToBone?: string; // If hitbox follows a bone's world transform
  frameSweep?: { from: HitboxShape; start: number; end: number; expires: boolean; reset?: boolean };

  // Source info
  sourceEntityId: EntityId;
}

export interface HitboxSweepComponent {
  hitboxes: ActiveHitboxComponent[]; // Finished windows awaiting this step's contact detection.
}
