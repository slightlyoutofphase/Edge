import { World, EntityId } from "../core/World";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PlayerInputComponent } from "../components/PlayerInput";
import { ColliderComponent, CollisionLayer } from "../components/Collider";
import { StaminaComponent } from "../components/Stamina";
import { HealthComponent } from "../components/Health";
import { CombatComponent } from "../features/combat/CombatComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { PLAYER_STATS } from "../core/Constants";
import { PlayerSkeleton } from "../skeleton/data/PlayerSkeleton";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { EnemyTagComponent } from "../components/EnemyTag";
import { PlatformComponent } from "../components/Platform";
import { CheckpointComponent } from "../components/Checkpoint";
import { TriggerComponent } from "../components/Trigger";
import { ENEMY_STATS } from "../data/EnemyStats";
import { FactionComponent } from "../components/Faction";
import { AnimationKey, SkeletonKey } from "../core/AssetKeys";
import { InventoryComponent } from "../components/Inventory";
import { InteractableComponent, InteractionType } from "../components/Interactable";
import { SpatialGridState } from "../core/Resources";
import { EnemyType, isQuadruped, isBossEnemy } from "../data/EnemyTypes";
import {
  QuadrupedSkeleton,
  QUADRUPED_HURTBOX,
  HELLHOUND_SCALE,
  ALPHA_HELLHOUND_SCALE,
} from "../skeleton/data/QuadrupedSkeleton";

export function createPlayer(world: World, x: number, y: number): EntityId {
  const id = world.createEntity();

  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  } as TransformComponent);
  world.addComponent(id, "Physics", {
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    grounded: false,
    friction: 1.0,
  } as PhysicsComponent);
  world.addComponent(id, "MovementState", {
    current: AnimationKey.IDLE,
    previousGrounded: false,
    coyoteTimer: 0,
    slideTimer: 0,
    slideCooldown: 0,
    rollTimer: 0,
    backstepTimer: 0,
    jumpBufferTimer: 0,
    dropThroughTimer: 0,
  } as MovementStateComponent);
  world.addComponent(id, "PlayerInput", { buffer: null } as PlayerInputComponent);

  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [{ x: -7, y: -64, width: 14, height: 64 }],
    layer: CollisionLayer.PLAYER,
  } as ColliderComponent);

  world.addComponent(id, "Stamina", {
    current: PLAYER_STATS.staminaMax,
    max: PLAYER_STATS.staminaMax,
    regenRate: PLAYER_STATS.staminaRegen,
    regenPaused: false,
    isExhausted: false,
  } as StaminaComponent);

  world.addComponent(id, "Health", {
    current: 100,
    max: 100,
    invulnTimer: 0,
    isDead: false,
  } as HealthComponent);

  world.addComponent(id, "Combat", {
    attackState: "idle",
    attackType: null,
    attackZone: 0,
    attackTimer: 0,
    blockZone: 0,
    isBlocking: false,
    poise: 40,
    maxPoise: 40,
    poiseRegenTimer: 0,
    staggerTimer: 0,
    staggerType: null,
    counterWindowActive: false,
    counterWindowTimer: 0,
    lastZoneChangeTime: -1000,
  } as CombatComponent);

  world.addComponent(id, "Skeleton", {
    definitionId: SkeletonKey.PLAYER,
    definition: PlayerSkeleton,
    currentPose: {},
    worldTransforms: new Map(),
  } as SkeletonComponent);

  world.addComponent(id, "Animator", {
    layers: [],
    currentAnim: AnimationKey.IDLE,
    time: 0,
    blendFrom: null,
    blendFromTime: 0,
    blendDuration: 0,
    blendElapsed: 0,
    pendingEvents: [],
    eventState: new Map(),
  } as AnimatorComponent);

  world.addComponent(id, "Faction", { team: 1 } as FactionComponent);

  world.addComponent(id, "Inventory", {
    currentWeapon: "longsword",
    unlockedWeapons: new Set(["longsword", "rapier", "greatsword", "dagger"]),
  } as InventoryComponent);

  return id;
}

export function createEnemy(world: World, x: number, y: number, type: EnemyType): EntityId {
  const statsRef = ENEMY_STATS[type] || ENEMY_STATS["hollow"];
  // Clone stats to prevent test pollution
  const stats = { ...statsRef };

  const id = world.createEntity();

  const quadruped = isQuadruped(type);
  const size =
    type === "boss"
      ? 1.5
      : type === "alpha_hellhound"
        ? ALPHA_HELLHOUND_SCALE
        : type === "hellhound"
          ? HELLHOUND_SCALE
          : 1;
  const scale = { x: size, y: size };

  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale,
    facing: -1,
  } as TransformComponent);
  world.addComponent(id, "Physics", {
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    grounded: false,
    friction: 1.0,
  } as PhysicsComponent);
  world.addComponent(id, "MovementState", {
    current: AnimationKey.IDLE,
    previousGrounded: false,
    coyoteTimer: 0,
    slideTimer: 0,
    slideCooldown: 0,
    rollTimer: 0,
    backstepTimer: 0,
    jumpBufferTimer: 0,
    dropThroughTimer: 0,
  } as MovementStateComponent);

  world.addComponent(id, "Health", {
    current: stats.health,
    max: stats.health,
    invulnTimer: 0,
    isDead: false,
  } as HealthComponent);
  world.addComponent(id, "Stamina", {
    current: 100,
    max: 100,
    regenRate: 25,
    regenPaused: false,
    isExhausted: false,
  } as StaminaComponent);

  world.addComponent(id, "Combat", {
    attackState: "idle",
    attackType: null,
    attackZone: 2,
    attackTimer: 0,
    blockZone: 2,
    isBlocking: false,
    poise: stats.poise,
    maxPoise: stats.poise,
    poiseRegenTimer: 0,
    staggerTimer: 0,
    staggerType: null,
    counterWindowActive: false,
    counterWindowTimer: 0,
    lastZoneChangeTime: -1000,
  } as CombatComponent);

  world.addComponent(id, "Skeleton", {
    definitionId: quadruped ? SkeletonKey.QUADRUPED : SkeletonKey.PLAYER,
    definition: quadruped ? QuadrupedSkeleton : PlayerSkeleton,
    currentPose: {},
    worldTransforms: new Map(),
  } as SkeletonComponent);

  world.addComponent(id, "Animator", {
    layers: [],
    currentAnim: AnimationKey.IDLE,
    time: 0,
    blendFrom: null,
    blendFromTime: 0,
    blendDuration: 0,
    blendElapsed: 0,
    pendingEvents: [],
    eventState: new Map(),
  } as AnimatorComponent);

  world.addComponent(id, "AIController", {
    state: "idle",
    target: null,
    behaviorParams: stats,
    stateTimer: 0,
    patrolOrigin: { x, y },
    patrolDirection: 1,
    attackCooldownTimer: 0,
    currentComboIndex: 0,
    wantsToFeint: false,
    feintTriggered: false,

    decisionTimer: 1000,
    turnTimer: 0,
    lastKnownTargetPos: null,
    currentPhase: 0,
    staminaRetreatThreshold: isBossEnemy(type) ? -10 : 20,

    currentPath: [],
    pathTargetIndex: 0,
    pathRecalculateTimer: 0,

    flankTimer: 0,
    isFlanking: false,
    dodgeCooldownTimer: 0,
    consecutiveHits: 0,
    lastHitTime: 0,
    hasAttackToken: false,
  } as AIControllerComponent);

  world.addComponent(id, "EnemyTag", { enemyType: type } as EnemyTagComponent);

  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [quadruped ? { ...QUADRUPED_HURTBOX } : { x: -7, y: -64, width: 14, height: 64 }],
    standingHeight: quadruped ? QUADRUPED_HURTBOX.height : 64,
    layer: CollisionLayer.ENEMY,
  } as ColliderComponent);

  world.addComponent(id, "Faction", { team: 2 } as FactionComponent);

  return id;
}

export function createDummy(world: World, x: number, y: number): EntityId {
  const id = world.createEntity();
  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: -1,
  } as TransformComponent);
  world.addComponent(id, "Physics", {
    velocity: { x: 0, y: 0 },
    acceleration: { x: 0, y: 0 },
    grounded: true,
    friction: 1.0,
  } as PhysicsComponent);
  world.addComponent(id, "MovementState", {
    current: AnimationKey.IDLE,
    previousGrounded: false,
    coyoteTimer: 0,
    slideTimer: 0,
    slideCooldown: 0,
    rollTimer: 0,
    backstepTimer: 0,
    jumpBufferTimer: 0,
    dropThroughTimer: 0,
  } as MovementStateComponent);
  world.addComponent(id, "Health", {
    current: 100,
    max: 100,
    invulnTimer: 0,
    isDead: false,
  } as HealthComponent);
  world.addComponent(id, "Stamina", {
    current: 100,
    max: 100,
    regenRate: 25,
    regenPaused: false,
    isExhausted: false,
  } as StaminaComponent);
  world.addComponent(id, "Combat", {
    attackState: "idle",
    attackType: null,
    attackZone: 2,
    attackTimer: 0,
    blockZone: 2,
    isBlocking: false,
    poise: 40,
    maxPoise: 40,
    poiseRegenTimer: 0,
    staggerTimer: 0,
    staggerType: null,
    counterWindowActive: false,
    counterWindowTimer: 0,
    lastZoneChangeTime: -1000,
  } as CombatComponent);
  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [{ x: -7, y: -64, width: 14, height: 64 }],
    layer: CollisionLayer.ENEMY,
  } as ColliderComponent);
  world.addComponent(id, "Faction", { team: 2 } as FactionComponent);
  return id;
}

export function createPlatform(
  world: World,
  x: number,
  y: number,
  width: number,
  height: number,
  type: "solid" | "semisolid" | "hazard" | "ladder" = "solid",
  damage: number = 0,
  asset?: string,
): EntityId {
  const id = world.createEntity();
  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  } as TransformComponent);
  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [{ x: 0, y: 0, width, height }],
    layer: CollisionLayer.ENVIRONMENT,
  } as ColliderComponent);
  world.addComponent(id, "Platform", {
    type,
    friction: 1.0,
    damage,
    damageInterval: 1000,
    damageTimer: -1, // Ensure it's ready to damage immediately
    asset,
  } as PlatformComponent);

  const grids = world.getResource<SpatialGridState>(SpatialGridState);
  if (grids) {
    grids.needsStaticRebuild = true;
  }

  return id;
}

export function createCheckpoint(
  world: World,
  idStr: string,
  x: number,
  y: number,
  facing: -1 | 1,
): EntityId {
  const id = world.createEntity();
  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing,
  } as TransformComponent);
  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [{ x: -20, y: -60, width: 40, height: 60 }],
    layer: CollisionLayer.TRIGGER,
  } as ColliderComponent);
  world.addComponent(id, "Checkpoint", {
    id: idStr,
    respawnPosition: { x, y },
    respawnFacing: facing,
    isActive: false,
  } as CheckpointComponent);
  return id;
}

export function createTrigger(
  world: World,
  x: number,
  y: number,
  width: number,
  height: number,
  type: any,
  data: any = {},
): EntityId {
  const id = world.createEntity();
  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  } as TransformComponent);
  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [{ x: 0, y: 0, width, height }],
    layer: CollisionLayer.TRIGGER,
  } as ColliderComponent);
  world.addComponent(id, "Trigger", {
    type,
    targetId: data.target,
    bounds: data.bounds,
    isActive: true,
    oneshot: true,
    triggered: false,
  } as TriggerComponent);
  return id;
}

export function createInteractable(
  world: World,
  x: number,
  y: number,
  type: InteractionType,
  prompt: string,
  data: any = {},
): EntityId {
  const id = world.createEntity();
  world.addComponent(id, "Transform", {
    position: { x, y },
    rotation: 0,
    scale: { x: 1, y: 1 },
    facing: 1,
  } as TransformComponent);

  // Collider for static grid (Platform) so we can see/render it if needed, or query it
  // Note: Interactable uses visual system for rendering, so we give it a platform component for drawing
  // asset logic in RenderSystem, OR we handle it via a new system.
  // For now, let's use Platform component with type 'solid' (or semisolid) but small so it doesn't block much?
  // Actually, RenderSystem uses Platform component to pick asset.
  // Let's use a dummy Collider for visibility.
  world.addComponent(id, "Collider", {
    hitboxes: [],
    hurtboxes: [{ x: -16, y: -32, width: 32, height: 32 }],
    layer: CollisionLayer.ENVIRONMENT,
  } as ColliderComponent);

  world.addComponent(id, "Platform", {
    type: "semisolid",
    collidable: false, // Rendering an interactable must not create an invisible support.
    friction: 1.0,
    damage: 0,
    damageInterval: 0,
    damageTimer: 0,
    asset: type, // Matches SVG key (bonfire, chest)
  } as PlatformComponent);

  world.addComponent(id, "Interactable", {
    type,
    prompt,
    range: 60,
    isInteracted: false,
    data,
    cooldown: 0,
  } as InteractableComponent);

  const grids = world.getResource<SpatialGridState>(SpatialGridState);
  if (grids) grids.needsStaticRebuild = true;
  return id;
}
