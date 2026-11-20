import { Vec2 } from "../utils/Vec2";
import { InputAction, ActiveKeybindings } from "./InputDefinitions";
import { HitEvent } from "../features/combat/HitEvent";
import { EntityId } from "./World";
import { SpatialHashGrid } from "../utils/SpatialHashGrid";

export class InputState {
  keysDown: Set<string> = new Set();
  keysPressed: Set<string> = new Set();
  keysReleased: Set<string> = new Set();
  mousePosition: Vec2 = { x: 0, y: 0 };
  mouseWorldPosition: Vec2 = { x: 0, y: 0 };
  mouseButtons: Set<number> = new Set();
  mouseButtonsPressed: Set<number> = new Set();
  mouseButtonsReleased: Set<number> = new Set();

  // Check Action Helper
  isActionDown(action: InputAction): boolean {
    const binding = ActiveKeybindings[action];
    if (binding.keys.some((k) => this.keysDown.has(k))) return true;
    if (binding.mouseButtons?.some((b) => this.mouseButtons.has(b))) return true;
    return false;
  }

  isActionPressed(action: InputAction): boolean {
    const binding = ActiveKeybindings[action];
    if (binding.keys.some((k) => this.keysPressed.has(k))) return true;
    if (binding.mouseButtons?.some((b) => this.mouseButtonsPressed.has(b))) return true;
    return false;
  }
}

export class CameraState {
  position: Vec2 = { x: 0, y: 0 };
  targetPosition: Vec2 = { x: 0, y: 0 };
  zoom: number = 2.5;
  shake: { amplitude: number; duration: number; elapsed: number } = {
    amplitude: 0,
    duration: 0,
    elapsed: 0,
  };
  bounds: { min: Vec2; max: Vec2 } | null = null;
  viewport: Vec2 = { x: 0, y: 0 };
  lookAhead: Vec2 = { x: 0, y: 0 };
  pointOfInterest: Vec2 | null = null; // New: Secondary target for framing
  isManual: boolean = false; // For Level Editor
}

export class TimeState {
  delta: number = 0;
  elapsed: number = 0;
  private _hitStopRemainingMs: number = 0;
  get hitStopFrames(): number {
    return this._hitStopRemainingMs > 0
      ? Math.ceil((this._hitStopRemainingMs * 60) / 1000 - 1e-6)
      : 0;
  }
  set hitStopFrames(frames: number) {
    this._hitStopRemainingMs = frames > 0 ? (frames * 1000) / 60 : 0;
  }
  get hitStopRemainingMs(): number {
    return this._hitStopRemainingMs;
  }
  set hitStopRemainingMs(ms: number) {
    this._hitStopRemainingMs = Math.max(0, ms);
  }
  timeScale: number = 1.0;
  timeScaleDuration: number = 0;
}

export interface PlayerStats {
  health: number;
  stamina: number;
  // Add inventory or other persistent data here later
}

export class PlayerProgress {
  currentLevelId: string = "level1";
  lastCheckpointId: string | null = null;
  lastCheckpointLevelId: string | null = null;
  inventory: { currentWeapon: string; unlockedWeapons: string[] } | null = null;
  interactedObjects: Set<string> = new Set();
  isVictory: boolean = false;
  unlockedShortcuts: Set<string> = new Set();
  isDead: boolean = false;
  deathTimer: number = 0;

  // Persistence
  savedStats: PlayerStats | null = null;

  // Transition State
  transitionState: "none" | "fade-out" | "loading" | "fade-in" = "none";
  transitionTimer: number = 0;
  nextLevelId: string | null = null;
}

export class CombatEventQueue {
  events: HitEvent[] = [];
}

export class CombatDirectorState {
  maxTokens: number = 2;
  activeTokens: Set<EntityId> = new Set();

  requestToken(id: EntityId): boolean {
    if (this.activeTokens.has(id)) return true;
    if (this.activeTokens.size < this.maxTokens) {
      this.activeTokens.add(id);
      return true;
    }
    return false;
  }

  releaseToken(id: EntityId) {
    this.activeTokens.delete(id);
  }

  hasToken(id: EntityId): boolean {
    return this.activeTokens.has(id);
  }
}

export class BattleState {
  isActive: boolean = false;
  showTeamMarkers: boolean = false;
  winner: string | null = null;
  redCount: number = 0;
  blueCount: number = 0;
}

export class GlobalLight {
  ambientColor: string = "#222233"; // Dark blue-ish ambient
  ambientIntensity: number = 0.4;
  sources: { position: Vec2; radius: number; intensity: number; color: string }[] = [];
}

export class SpatialGridState {
  dynamicGrid: SpatialHashGrid = new SpatialHashGrid(128);
  staticGrid: SpatialHashGrid = new SpatialHashGrid(128);
  needsStaticRebuild: boolean = true;
}

export class InteractionState {
  activePrompt: string | null = null;
  activeEntityId: EntityId | null = null;
  interactionTimer: number = 0;
}

export class EditorState {
  enabled: boolean = false;
  showGrid: boolean = true;
  hideBackground: boolean = false;
  gridSize: number = 32; // Default to 32 to match assets
  selection: { x: number; y: number; width: number; height: number } | null = null;
  ghost: {
    x: number;
    y: number;
    width: number;
    height: number;
    type: string;
    asset?: string;
  } | null = null;
}
