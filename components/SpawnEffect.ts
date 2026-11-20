import { Vec2 } from "../utils/Vec2";

export interface SpawnEffectComponent {
  type:
    | "spark"
    | "flesh_hit"
    | "block_spark"
    | "clash_spark"
    | "parry_burst"
    | "dust"
    | "flash"
    | "motion_blur"
    | "hellhound-shockwave";
  position: Vec2;
  direction?: Vec2; // For velocity
  scale?: number;
  duration?: number;
  color?: string;
  subtype?: string; // For dust/particles variation
}
