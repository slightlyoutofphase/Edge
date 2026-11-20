import { EntityId } from "../../core/World";
import { Vec2 } from "../../utils/Vec2";

export interface HitEvent {
  attackerId: EntityId;
  targetId: EntityId;
  damage: number;
  poiseDamage: number;
  zone: 1 | 2 | 3;
  attackType: "light" | "heavy" | "jump" | "slide";
  knockback: Vec2;
  impactPoint: Vec2;
  isBlockable: boolean;
  contactType?: "body" | "guard" | "clash" | "terrain";
  contactTime?: number;
  attackSerial?: number;
  targetAttackSerial?: number;
  targetBone?: string;
  impactNormal?: Vec2; // Surface normal pointing out of terrain, for recoil.
}
