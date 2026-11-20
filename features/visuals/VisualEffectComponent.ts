import { Vec2 } from "../../utils/Vec2";

export interface VisualEffectComponent {
  type:
    | "spark"
    | "flesh_hit"
    | "block_spark"
    | "clash_spark"
    | "parry_burst"
    | "dust"
    | "ghost"
    | "hellhound-shockwave";
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  rotationSpeed: number;
  scale: number;
  alpha: number;
  life: number;
  maxLife: number;

  // For Ghost effect
  spritePath?: string;
  spriteTransform?: { scaleX: number; scaleY: number };
}

export interface HitFlashComponent {
  frames: number;
  color?: string;
  bone?: string;
  remainingMs?: number;
  durationMs?: number;
  opacity?: number;
}
