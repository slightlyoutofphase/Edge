import { World, EntityId } from "./World";
import { InputManager } from "./Input";
import {
  InputState,
  TimeState,
  CameraState,
  PlayerProgress,
  CombatEventQueue,
  CombatDirectorState,
  GlobalLight,
  BattleState,
  SpatialGridState,
  InteractionState,
  EditorState,
} from "./Resources";
import { AssetLoader } from "../assets/AssetLoader";
import { InputSystem } from "../systems/InputSystem";
import { MovementSystem } from "../features/movement/MovementSystem";
import { PhysicsSystem } from "../features/movement/PhysicsSystem";
import { CollisionSystem } from "../systems/CollisionSystem";
import { RenderSystem } from "../systems/RenderSystem";
import { CameraSystem } from "../systems/CameraSystem";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { AudioSystem } from "../systems/AudioSystem";
import { CombatSystem } from "../features/combat/CombatSystem";
import { HitDetectionSystem } from "../features/combat/HitDetectionSystem";
import { DamageSystem } from "../features/combat/DamageSystem";
import { CombatDirectorSystem } from "../features/ai/CombatDirectorSystem";
import { UISystem } from "../systems/UISystem";
import { AISystem } from "../features/ai/AISystem";
import { EffectSystem } from "../systems/EffectSystem";
import { TriggerSystem } from "../systems/TriggerSystem";
import { GameModeSystem } from "../systems/GameModeSystem";
import { InventorySystem } from "../systems/InventorySystem";
import { InteractionSystem } from "../systems/InteractionSystem";
import {
  createPlayer,
  createPlatform,
  createEnemy,
  createCheckpoint,
  createTrigger,
  createInteractable,
} from "../entities/Archetypes";
import { LEVELS, LevelData } from "../data/Levels";
import { CheckpointComponent } from "../components/Checkpoint";
import { TransformComponent } from "../components/Transform";
import { aabbIntersects } from "../utils/AABB";
import { HealthComponent } from "../components/Health";
import { FactionComponent } from "../components/Faction";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { HitStopComponent } from "../components/HitStop";
import { WeaponTrailSystem } from "../systems/WeaponTrailSystem";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";
import { NavigationGraph } from "../features/navigation/NavigationGraph";

import { InventoryComponent } from "../components/Inventory";
import { InteractableComponent } from "../components/Interactable";
import { validateLevelData } from "../data/LevelValidation";
import { StaminaComponent } from "../components/Stamina";
import { actorBounds } from "../features/ai/CombatReach";

export class Game {
  world: World;
  canvas: HTMLCanvasElement;
  inputManager: InputManager;
  systems: any[];
  running: boolean = false;
  lastTime: number = 0;
  playerId: EntityId = 0;

  testMode: boolean = false;
  battleMode: boolean = false;
  editorMode: boolean = false;

  // Callback for React UI
  onUIUpdate: ((data: any) => void) | null = null;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.world = new World();

    // Resources
    this.world.setResource(InputState, new InputState());
    this.world.setResource(TimeState, new TimeState());
    this.world.setResource(CameraState, new CameraState());
    this.world.setResource(PlayerProgress, new PlayerProgress());
    this.world.setResource(CombatEventQueue, new CombatEventQueue());
    this.world.setResource(CombatDirectorState, new CombatDirectorState());
    this.world.setResource(NavigationGraph, new NavigationGraph());
    this.world.setResource(GlobalLight, new GlobalLight());
    this.world.setResource(BattleState, new BattleState());
    this.world.setResource(SpatialGridState, new SpatialGridState());
    this.world.setResource(InteractionState, new InteractionState());
    this.world.setResource(EditorState, new EditorState());

    this.inputManager = new InputManager(this.world.getResource(InputState), canvas);

    // Systems (Order Matters!)
    this.systems = [
      new InputSystem(this.world),
      new InventorySystem(this.world), // Check inputs for swaps
      new InteractionSystem(this.world), // Check inputs for interactions
      new GameModeSystem(this.world), // Logic before physics
      new CombatDirectorSystem(this.world), // AI Decision making
      new AISystem(this.world),
      new CombatSystem(this.world),
      new MovementSystem(this.world),
      new PhysicsSystem(this.world),
      new CollisionSystem(this.world), // Builds/Updates SpatialHash

      new AnimationSystem(this.world),
      new SkeletonSystem(this.world),
      new WeaponTrailSystem(this.world), // After Skeleton, before Render

      new HitDetectionSystem(this.world), // Uses SpatialHash
      new DamageSystem(this.world), // Resolves events (damage/effects)

      new EffectSystem(this.world),
      new AudioSystem(this.world),
      new CameraSystem(this.world),
      new TriggerSystem(this.world),

      new RenderSystem(this.world, canvas), // Uses SpatialHash
      new UISystem(this.world),
    ];

    const uiSystem = this.systems.find((s) => s instanceof UISystem) as UISystem;
    if (uiSystem) uiSystem.setCanvas(canvas);
  }

  async init() {
    await AssetLoader.loadAll();
    this.running = true;
    this.lastTime = performance.now();
    requestAnimationFrame(this.loop.bind(this));
  }

  destroy() {
    this.running = false;
    if (this.inputManager) {
      this.inputManager.dispose();
    }
    const audioSys = this.systems.find((s) => s instanceof AudioSystem) as AudioSystem;
    if (audioSys) audioSys.dispose();
  }

  resetLevel() {
    this.world.setResource(PlayerProgress, new PlayerProgress());
    this.playerId = 0;
    this.loadLevel("level1", false);
  }

  startBattle(typeA1: string, typeA2: string, typeB1: string, typeB2: string) {
    this.battleMode = true;
    this.loadLevel("arena");

    const battle = this.world.getResource<BattleState>(BattleState);
    battle.isActive = true;

    const existing = this.world.query("Health");
    for (const e of existing) {
      this.world.destroyEntity(e.id);
    }

    const teamRedIds: number[] = [];
    const teamBlueIds: number[] = [];

    if (typeA1 !== "none") teamRedIds.push(this.spawnCombatant(typeA1, 250, 700, 3, 1));
    if (typeA2 !== "none") teamRedIds.push(this.spawnCombatant(typeA2, 100, 700, 3, 1));

    if (typeB1 !== "none") teamBlueIds.push(this.spawnCombatant(typeB1, 950, 700, 4, -1));
    if (typeB2 !== "none") teamBlueIds.push(this.spawnCombatant(typeB2, 1100, 700, 4, -1));

    this.assignBattleTargets(teamRedIds, teamBlueIds);
    this.assignBattleTargets(teamBlueIds, teamRedIds);

    const camera = this.world.getResource<CameraState>(CameraState);
    camera.bounds = { min: { x: 0, y: 0 }, max: { x: 1200, y: 800 } };
    camera.position = { x: 600, y: 600 };
    camera.targetPosition = { x: 600, y: 600 };
    camera.zoom = 1.3;
  }

  private spawnCombatant(type: string, x: number, y: number, team: number, facing: 1 | -1): number {
    const id = createEnemy(this.world, x, y, type as any);

    const fac = this.world.getComponent<FactionComponent>(id, "Faction");
    if (fac) fac.team = team;

    const trans = this.world.getComponent<TransformComponent>(id, "Transform");
    if (trans) trans.facing = facing;

    this.world.addComponent(id, "WeaponTrail", {
      boneId: "weapon",
      tipOffset: { x: 40, y: 0 },
      baseOffset: { x: 0, y: 0 },
      history: [],
      maxLength: 10,
      active: false,
      color: team === 3 ? "rgba(255, 100, 100, 0.5)" : "rgba(100, 160, 255, 0.5)",
    } as WeaponTrailComponent);

    return id;
  }

  private assignBattleTargets(sources: number[], targets: number[]) {
    if (targets.length === 0) return;

    sources.forEach((sourceId, index) => {
      const ai = this.world.getComponent<AIControllerComponent>(sourceId, "AIController");
      if (ai) {
        const targetId = targets[index % targets.length];
        ai.target = targetId;
        ai.state = "combat";
      }
    });
  }

  // New method for direct data loading
  loadLevelFromData(data: LevelData) {
    data = validateLevelData(data);
    this.battleMode = data.id === "arena";
    this.inputManager.reset();
    this.resetLevelState();

    // Cleanup old entities
    const allEntities = this.world.getAllEntities();
    for (const id of allEntities) {
      this.world.destroyEntity(id);
    }

    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);
    if (grids) {
      grids.staticGrid.clear();
      grids.dynamicGrid.clear();
      grids.needsStaticRebuild = true;
    }

    // Populate from data
    for (const tile of data.tiles) {
      createPlatform(
        this.world,
        tile.x,
        tile.y,
        tile.width,
        tile.height,
        tile.type,
        tile.damage || 0,
        tile.asset,
      );
    }

    for (const spawn of data.enemies) {
      createEnemy(this.world, spawn.x, spawn.y, spawn.type);
    }

    for (const cp of data.checkpoints) {
      createCheckpoint(this.world, cp.id, cp.x, cp.y, cp.facing);
    }

    for (const trig of data.triggers) {
      createTrigger(this.world, trig.x, trig.y, trig.width, trig.height, trig.type, trig);
    }

    if (data.interactables) {
      for (const i of data.interactables) {
        const id = createInteractable(this.world, i.x, i.y, i.type, i.prompt, i.data);
        const interactable = this.world.getComponent<InteractableComponent>(id, "Interactable")!;
        interactable.persistenceId = `${data.id}:${i.type}:${i.x}:${i.y}`;
        interactable.isInteracted = this.world
          .getResource<PlayerProgress>(PlayerProgress)
          .interactedObjects.has(interactable.persistenceId);
        if (interactable.isInteracted && i.type === "chest") {
          this.world.getComponent<any>(id, "Platform").asset = "chest-open";
        }
      }
    }

    // Spawn player if starting pos is present (useful for scaling context)
    // In Editor, we might not want control, but we want the visual.
    this.playerId = createPlayer(this.world, data.startPos.x, data.startPos.y);
    this.world.getResource<PlayerProgress>(PlayerProgress).currentLevelId = data.id;
    if (!this.editorMode) {
      this.world.getResource<NavigationGraph>(NavigationGraph).build(this.world);
    }
  }

  loadLevel(levelId: string, saveCurrentStats: boolean = true) {
    const data = LEVELS[levelId];
    if (!Object.hasOwn(LEVELS, levelId)) throw new Error(`Unknown level: ${levelId}`);
    validateLevelData(data);
    const previousLevel = this.world.getResource<PlayerProgress>(PlayerProgress).currentLevelId;
    this.inputManager.reset();
    this.battleMode = levelId === "arena";

    // Handle Persistence: Save Stats
    const progress = this.world.getResource<PlayerProgress>(PlayerProgress);
    if (saveCurrentStats && this.playerId > 0 && this.world.hasComponent(this.playerId, "Health")) {
      const health = this.world.getComponent<HealthComponent>(this.playerId, "Health");
      const stamina = this.world.getComponent<StaminaComponent>(this.playerId, "Stamina");
      if (health && stamina) {
        progress.savedStats = {
          health: health.current,
          stamina: stamina.current,
        };
      }
    }

    if (this.playerId > 0) {
      const inventory = this.world.getComponent<InventoryComponent>(this.playerId, "Inventory");
      if (inventory)
        progress.inventory = {
          currentWeapon: inventory.currentWeapon,
          unlockedWeapons: [...inventory.unlockedWeapons],
        };
    }

    // Use shared logic for population
    this.loadLevelFromData(data);

    // Additional Setup for Gameplay Mode (vs Editor)
    // Override Player creation from loadLevelFromData to ensure proper ID tracking and persistence
    // Actually, loadLevelFromData creates a generic player. We need to grab its ID or recreate it.
    // Let's refine: loadLevelFromData spawns entities. We can find the player ID after.

    // Find player to set ID and restore stats
    const players = this.world.query("PlayerInput");
    if (players.length > 0) {
      this.playerId = players[0].id;
      // Re-add trail (cosmetic)
      this.world.addComponent(this.playerId, "WeaponTrail", {
        boneId: "weapon",
        tipOffset: { x: 40, y: 0 },
        baseOffset: { x: 0, y: 0 },
        history: [],
        maxLength: 10,
        active: false,
        color: "rgba(255, 255, 255, 0.5)",
      } as WeaponTrailComponent);

      if (levelId !== "arena") {
        if (
          progress.lastCheckpointId &&
          (progress.lastCheckpointLevelId ?? previousLevel) === levelId
        ) {
          const cps = this.world.query("Checkpoint", "Transform");
          const cpEntity = cps.find(
            (e) => (e.components[0] as CheckpointComponent).id === progress.lastCheckpointId,
          );
          if (cpEntity) {
            const comp = cpEntity.components[0] as CheckpointComponent;
            const trans = this.world.getComponent<TransformComponent>(this.playerId, "Transform");
            if (trans) {
              trans.position.x = comp.respawnPosition.x;
              trans.position.y = comp.respawnPosition.y;
              trans.facing = comp.respawnFacing;
            }
          }
        }

        const inventory = this.world.getComponent<InventoryComponent>(this.playerId, "Inventory");
        if (inventory && progress.inventory) {
          inventory.currentWeapon = progress.inventory.currentWeapon;
          inventory.unlockedWeapons = new Set(progress.inventory.unlockedWeapons);
        }
        // Restore Stats
        if (progress.savedStats) {
          const health = this.world.getComponent<HealthComponent>(this.playerId, "Health");
          const stamina = this.world.getComponent<StaminaComponent>(this.playerId, "Stamina");
          if (health) health.current = progress.savedStats.health;
          if (stamina) stamina.current = progress.savedStats.stamina;
        }
      }
    }

    // Add trails to enemies
    const enemies = this.world.query("EnemyTag");
    for (const e of enemies) {
      this.world.addComponent(e.id, "WeaponTrail", {
        boneId: "weapon",
        tipOffset: { x: 40, y: 0 },
        baseOffset: { x: 0, y: 0 },
        history: [],
        maxLength: 10,
        active: false,
        color: "rgba(255, 100, 100, 0.5)",
      } as WeaponTrailComponent);
    }
  }

  private resetLevelState() {
    const time = this.world.getResource<TimeState>(TimeState);
    time.elapsed = 0;
    time.delta = 0;
    time.hitStopFrames = 0;
    time.timeScale = 1.0;
    time.timeScaleDuration = 0;

    const camera = this.world.getResource<CameraState>(CameraState);
    if (!this.editorMode) {
      camera.position = { x: 0, y: 0 };
      camera.targetPosition = { x: 0, y: 0 };
      camera.zoom = 2.5;
      camera.shake = { amplitude: 0, duration: 0, elapsed: 0 };
      camera.bounds = null;
      camera.pointOfInterest = null;
      camera.isManual = false;
    }

    // Reset queues
    const combatEvents = this.world.getResource<CombatEventQueue>(CombatEventQueue);
    combatEvents.events = [];
    const director = this.world.getResource<CombatDirectorState>(CombatDirectorState);
    director.activeTokens.clear();

    const battle = this.world.getResource<BattleState>(BattleState);
    battle.isActive = false;
    battle.winner = null;

    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);
    if (grids) {
      grids.staticGrid.clear();
      grids.dynamicGrid.clear();
      grids.needsStaticRebuild = true;
    }

    const interactionState = this.world.getResource<InteractionState>(InteractionState);
    interactionState.activePrompt = null;
    interactionState.activeEntityId = null;
    interactionState.interactionTimer = 0;

    this.world.getResource<PlayerProgress>(PlayerProgress).isVictory = false;
    for (const system of this.systems) {
      if ((system as any).reset) (system as any).reset();
    }
  }

  update(dt: number, present = true) {
    if (this.editorMode) {
      // In Editor Mode, run minimal systems for visualization
      const cameraSystem = this.systems.find((s) => s instanceof CameraSystem);
      const renderSystem = this.systems.find((s) => s instanceof RenderSystem);
      const animationSystem = this.systems.find((s) => s instanceof AnimationSystem);
      const skeletonSystem = this.systems.find((s) => s instanceof SkeletonSystem);
      const collisionSystem = this.systems.find((s) => s instanceof CollisionSystem);

      // Still need time state for animations
      const time = this.world.getResource<TimeState>(TimeState);
      time.delta = dt;
      time.elapsed += dt;

      // Update collisions to populate spatial grid for rendering/selection
      if (collisionSystem) collisionSystem.update(false);

      if (animationSystem) animationSystem.update();
      if (skeletonSystem) skeletonSystem.update();
      if (cameraSystem) cameraSystem.update();
      if (present && renderSystem) renderSystem.update();
      return;
    }

    const time = this.world.getResource<TimeState>(TimeState);
    const camera = this.world.getResource<CameraState>(CameraState);
    const progress = this.world.getResource<PlayerProgress>(PlayerProgress);

    if (progress.isVictory) {
      this.inputManager.update();
      if (present) {
        this.systems.find((system) => system instanceof RenderSystem)?.update();
        this.systems.find((system) => system instanceof UISystem)?.update();
      }
      return;
    }

    // Update Transition State
    if (progress.transitionState === "fade-out") {
      progress.transitionTimer -= dt;
      if (this.onUIUpdate)
        this.onUIUpdate({ fade: Math.max(0, 1.0 - progress.transitionTimer / 1000) });

      if (progress.transitionTimer <= 0) {
        progress.transitionState = "loading";
      }
    } else if (progress.transitionState === "loading") {
      if (progress.nextLevelId) {
        const nextLevel = progress.nextLevelId;
        this.loadLevel(nextLevel);
        progress.nextLevelId = null;
        progress.currentLevelId = nextLevel;
        progress.transitionState = "fade-in";
        progress.transitionTimer = 1000;
      }
    } else if (progress.transitionState === "fade-in") {
      progress.transitionTimer -= dt;
      if (this.onUIUpdate) this.onUIUpdate({ fade: Math.max(0, progress.transitionTimer / 1000) });

      if (progress.transitionTimer <= 0) {
        progress.transitionState = "none";
        if (this.onUIUpdate) this.onUIUpdate({ fade: 0 });
      }
    }

    camera.viewport.x = this.canvas.width;
    camera.viewport.y = this.canvas.height;

    if (time.hitStopRemainingMs > 0) {
      time.hitStopRemainingMs -= dt;
    }

    // Decrement per-entity hitstop
    const hitStoppedEntities = this.world.query("HitStop");
    for (const { id, components } of hitStoppedEntities) {
      const hs = components[0] as HitStopComponent;
      hs.remainingMs = (hs.remainingMs ?? (hs.frames * 1000) / 60) - dt;
      hs.frames = Math.max(0, Math.ceil((hs.remainingMs * 60) / 1000));
      if (hs.remainingMs <= 0) {
        this.world.removeComponent(id, "HitStop");
      }
    }

    time.delta = dt * time.timeScale;
    time.elapsed += time.delta;
    this.inputManager.update();

    // Global Light Update (e.g. flickers)
    const light = this.world.getResource<GlobalLight>(GlobalLight);
    light.sources = []; // Clear and rebuild frame

    // Add Player Light
    if (this.playerId && this.world.hasComponent(this.playerId, "Transform")) {
      const pt = this.world.getComponent<TransformComponent>(this.playerId, "Transform")!;
      light.sources.push({
        position: { x: pt.position.x, y: pt.position.y - 40 },
        radius: 400,
        intensity: 0.6,
        color: "#ffaa77",
      });
    }

    if (!this.battleMode) {
      const players = this.world.query("Health", "Transform", "Collider", "PlayerInput");

      if (players.length > 0) {
        const health = players[0].components[0] as HealthComponent;
        const checkpoints = this.world.query("Checkpoint", "Transform", "Collider");
        const pRect = actorBounds(this.world, players[0].id);

        if (pRect) {
          for (const { id: cpId, components } of checkpoints) {
            const cp = components[0] as CheckpointComponent;
            const cRect = actorBounds(this.world, cpId);
            if (!cRect) continue;

            if (aabbIntersects(pRect, cRect)) {
              if (!cp.isActive) {
                progress.lastCheckpointId = cp.id;
                progress.lastCheckpointLevelId = progress.currentLevelId;
                cp.isActive = true;
                // Add save notification?
              }
            }
          }
        }

        if (health.isDead) {
          if (!progress.isDead) {
            progress.isDead = true;
            progress.deathTimer = 0;
          }

          progress.deathTimer += dt;

          if (progress.deathTimer > 2000) {
            const input = this.world.getResource<InputState>(InputState);
            if (input.keysPressed.size > 0 || input.mouseButtonsPressed.size > 0) {
              this.respawn();
            }
          }
        } else {
          progress.isDead = false;
        }
      }
    }

    for (const system of this.systems) {
      if (!present && (system instanceof RenderSystem || system instanceof UISystem)) continue;
      if (system.update) system.update();
    }
  }

  respawn() {
    const progress = this.world.getResource<PlayerProgress>(PlayerProgress);
    progress.isDead = false;
    progress.deathTimer = 0;
    // Reset saved stats so respawn is fresh health
    progress.savedStats = null;

    // Pass false to prevent saving the currently dead state
    this.loadLevel(progress.currentLevelId, false);

    const player = this.world.getComponent<HealthComponent>(this.playerId, "Health");
    if (player) {
      player.invulnTimer = 1000;
    }
  }

  loop(timestamp: number) {
    if (!this.running) return;

    let dt = timestamp - this.lastTime;
    if (dt > 100) dt = 100;

    this.lastTime = timestamp;

    // Keep small simulation steps, but present only the final state. Redrawing
    // every catch-up step makes a render hitch multiply its own rendering cost.
    // A step count also avoids an extra update for floating-point remainders.
    const steps = dt > 0 ? Math.max(1, Math.ceil(dt / (1000 / 60) - 1e-9)) : 0;
    for (let i = 0; i < steps; i++) {
      const final = i === steps - 1;
      const step = final ? dt : 1000 / 60;
      this.update(step, final);
      dt -= step;
    }

    requestAnimationFrame(this.loop.bind(this));
  }
}
