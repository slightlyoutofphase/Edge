import { WeaponDef } from "../../data/WeaponDefinitions";

export interface AttackTiming {
  animation: string;
  elapsed: number;
  windup: number;
  active: number;
  recovery: number;
  hitStart: number;
  hitEnd: number;
  duration: number;
  phase: "windup" | "active" | "recovery";
  weapon?: WeaponDef;
  baseHitDamage: number;
  motionStarted?: boolean;
}

export interface CombatComponent {
  attackState: "idle" | "windup" | "active" | "recovery" | "stagger" | "parry";
  attackType: "light" | "heavy" | "jump" | "slide" | null;
  attackZone: 0 | 1 | 2 | 3;
  attackTimer: number;
  attackSerial?: number; // Identifies a committed swing for one-shot AI reactions.
  attackTiming?: AttackTiming;
  animationDelta?: number;
  impact?: {
    remaining: number;
    duration: number;
    direction: number;
    guard: boolean;
    recoil?: boolean;
    strength?: number;
  };
  isHeavyAttack?: boolean;

  blockZone: 0 | 1 | 2 | 3;
  isBlocking: boolean;

  poise: number;
  maxPoise: number;
  poiseRegenTimer: number;
  staggerTimer: number;
  staggerType: "light" | "heavy" | null;

  counterWindowActive: boolean;
  counterWindowTimer: number;

  lastZoneChangeTime: number; // For hysteresis
}
