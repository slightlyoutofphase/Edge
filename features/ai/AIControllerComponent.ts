import { EntityId } from "../../core/World";
import { Vec2 } from "../../utils/Vec2";
import { NavStep } from "../navigation/NavigationGraph";
import { AIParams } from "../../data/EnemyStats";

export interface AIControllerComponent {
  state:
    | "idle"
    | "patrol"
    | "alert"
    | "approach"
    | "attack"
    | "block"
    | "retreat"
    | "stagger"
    | "death"
    | "combat"
    | "search";
  target: EntityId | null;
  behaviorParams: AIParams;
  stateTimer: number;
  patrolOrigin: Vec2;
  patrolDirection: -1 | 1;

  // Logic
  attackCooldownTimer: number;
  currentComboIndex: number;
  bossSpecialReadyAt?: number; // Minimum spacing between Boss specials, in elapsed ms.
  lastHellhoundSpecial?: "maul" | "slam";
  hellhoundDecisionTimer?: number;
  lastHellhoundAttackZone?: 1 | 2 | 3;
  hellhoundSpecialResponse?: {
    attacker: EntityId;
    serial: number;
    mode: "punish" | "withdraw" | "wait";
    retreatX?: number;
  };
  wantsToFeint: boolean;
  feintTriggered: boolean;
  pendingAttack?: { target: EntityId; animation: string; zone: 0 | 1 | 2 | 3; range: number };

  decisionTimer: number;
  turnTimer: number;
  lastKnownTargetPos: Vec2 | null;
  currentPhase: number;
  staminaRetreatThreshold: number;

  consecutiveHits: number;
  lastHitTime: number;
  lastDamageTime?: number;

  // Token
  hasAttackToken: boolean;

  // Navigation
  currentPath: NavStep[];
  lastPathTarget?: Vec2;
  pathProgressTimer?: number;
  lastPathDistance?: number;
  pathTargetIndex: number;
  pathRecalculateTimer: number;

  // Flanking
  flankTimer: number;
  isFlanking: boolean;
  flankLanding?: Vec2;
  flankObstruction?: {
    blocker: EntityId;
    blockerX: number;
    target: EntityId;
    targetX: number;
    targetY: number;
  };
  approachBlocked?: boolean;
  attackDecisionTimer?: number;
  clashResponse?: {
    target: EntityId;
    expiresAt: number;
    repeats: number;
    zone: 1 | 2 | 3;
    delay: number;
    step: number;
    pending: boolean;
  };

  // Evasion & Neutral Variety
  dodgeCooldownTimer: number;
  guardTimer?: number;
  neutralTempo?: { mode: "press" | "hold" | "pace_back"; until: number };
  heavyThreatChecked?: { attacker: EntityId; serial: number };
}
