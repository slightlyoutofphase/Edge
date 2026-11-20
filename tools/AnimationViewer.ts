import { Game } from "../core/Game";
import { World } from "../core/World";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { RenderSystem } from "../systems/RenderSystem";
import { createPlayer, createEnemy } from "../entities/Archetypes";
import { AssetLoader } from "../assets/AssetLoader";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { TransformComponent } from "../components/Transform";
import { CameraState } from "../core/Resources";
import { EffectSystem } from "../systems/EffectSystem";
import { AudioSystem } from "../systems/AudioSystem";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { CollisionSystem } from "../systems/CollisionSystem";
import { AnimationEvent } from "../features/animation/AnimationTypes";
import { AttackTiming } from "../features/combat/CombatComponent";
import {
  createAttackTiming,
  sampleAttackTiming,
  attackElapsedAtClipTime,
} from "../features/combat/AttackTiming";
import { InventoryComponent } from "../components/Inventory";
import { WEAPONS } from "../data/WeaponDefinitions";
import { ENEMY_STATS } from "../data/EnemyStats";
import { ENEMY_TYPES, isQuadruped } from "../data/EnemyTypes";
import { attackMotionOffset } from "../features/combat/AttackTiming";
import { resolveAttackHitbox } from "../features/combat/HitboxGeometry";
import { SkeletonKey } from "../core/AssetKeys";

const enemyTypes = ENEMY_TYPES;

export function getAnimationGroups(entityType: string, showAll = false) {
  const rig = isQuadruped(entityType) ? SkeletonKey.QUADRUPED : SkeletonKey.PLAYER;
  const names = Array.from(AssetLoader.animations.keys())
    .filter((name) => (AssetLoader.getAnimation(name)?.skeletonId ?? SkeletonKey.PLAYER) === rig)
    .sort();
  const owner = (name: string) =>
    enemyTypes.find((type) => name.startsWith(`${type}_`)) ??
    (name.includes("attack") ? "player" : "shared");
  return ["shared", "player", ...enemyTypes]
    .filter(
      (type) => showAll || type === entityType || (type === "shared" && !isQuadruped(entityType)),
    )
    .map((type) => ({
      label: type.replaceAll("_", " ").toUpperCase(),
      names: names.filter((name) => owner(name) === type),
    }))
    .filter((group) => group.names.length > 0);
}

export class AnimationViewer {
  game: Game;
  world: World;
  currentEntityId: number | null = null;
  currentAnimName: string = "idle";
  isPlaying: boolean = true;
  loop: boolean = true;
  playbackSpeed: number = 1.0;
  playbackMode: "clip" | "combat" = "clip";
  zoom = 6;
  facing: 1 | -1 = 1;
  weapon = "longsword";
  showHitboxes = true;
  private playhead = 0;
  private attackTiming?: AttackTiming;
  private animationSystem: AnimationSystem;
  private viewportInsets = { left: 0, top: 0, bottom: 0 };
  private sortedEventCache?: {
    source: AnimationEvent[] | undefined;
    count: number;
    events: AnimationEvent[];
  };
  private hitWindowCache?: {
    events: AnimationEvent[];
    mode: "clip" | "combat";
    timing?: AttackTiming;
    clipDuration: number;
    duration: number;
    windows: { start: number; end: number }[];
  };

  // Editor State
  public previewHitbox: any = null; // HitboxDef

  // UI State getters
  get duration() {
    const attack = this.playbackMode === "combat" ? this.attackTiming : undefined;
    return attack ? attack.windup + attack.active + attack.recovery : this.clipDuration;
  }

  get clipDuration() {
    return AssetLoader.getAnimation(this.currentAnimName)?.duration ?? 0;
  }
  get currentTime() {
    return this.playhead;
  }
  get currentClipTime() {
    return this.clipTimeAt(this.playhead);
  }
  get hasCombatTiming() {
    return !!this.attackTiming;
  }
  get playbackPhase() {
    return this.playbackMode === "combat" && this.attackTiming
      ? sampleAttackTiming(this.attackTiming, this.playhead).phase
      : "raw clip";
  }

  eventTime(event: AnimationEvent) {
    const time = event.time * this.clipDuration;
    return this.playbackMode === "combat" && this.attackTiming
      ? attackElapsedAtClipTime(this.attackTiming, time)
      : time;
  }

  private sortedEvents() {
    const source = AssetLoader.getAnimation(this.currentAnimName)?.events;
    if (
      !this.sortedEventCache ||
      this.sortedEventCache.source !== source ||
      this.sortedEventCache.count !== (source?.length ?? 0)
    ) {
      this.sortedEventCache = {
        source,
        count: source?.length ?? 0,
        events: [...(source ?? [])].sort((a, b) => a.time - b.time),
      };
    }
    return this.sortedEventCache.events;
  }

  get hitWindows() {
    const events = this.sortedEvents();
    const cached = this.hitWindowCache;
    if (
      cached &&
      cached.events === events &&
      cached.mode === this.playbackMode &&
      cached.timing === this.attackTiming &&
      cached.clipDuration === this.clipDuration &&
      cached.duration === this.duration
    )
      return cached.windows;
    const windows: { start: number; end: number }[] = [];
    let start: number | undefined;
    for (const event of events) {
      if (event.type === "hitbox-start") {
        if (start !== undefined) windows.push({ start, end: this.eventTime(event) });
        start = this.eventTime(event);
      } else if (event.type === "hitbox-end" && start !== undefined) {
        windows.push({ start, end: this.eventTime(event) });
        start = undefined;
      }
    }
    if (start !== undefined) windows.push({ start, end: this.duration });
    this.hitWindowCache = {
      events,
      mode: this.playbackMode,
      timing: this.attackTiming,
      clipDuration: this.clipDuration,
      duration: this.duration,
      windows,
    };
    return windows;
  }

  private clipTimeAt(time: number) {
    return this.playbackMode === "combat" && this.attackTiming
      ? sampleAttackTiming(this.attackTiming, time).time
      : time;
  }

  constructor(canvas: HTMLCanvasElement) {
    this.game = new Game(canvas);
    this.world = this.game.world;
    this.animationSystem = new AnimationSystem(this.world);
  }

  async init() {
    await AssetLoader.loadAll();

    // Reset world and setup minimal systems
    // We only want to render and animate, not simulate physics or AI
    // CRITICAL: CollisionSystem is required to populate the SpatialHashGrid,
    // which RenderSystem uses to determine what to draw.
    const audio = this.game.systems.find((system) => system instanceof AudioSystem);
    this.game.systems = [
      new CollisionSystem(this.world),
      this.animationSystem,
      new SkeletonSystem(this.world),
      new EffectSystem(this.world),
      audio,
      new RenderSystem(this.world, this.game.canvas, true),
    ];

    const camera = this.world.getResource<CameraState>(CameraState);
    camera.zoom = this.zoom;
    camera.position = { x: 0, y: -30 };

    // Initial spawn
    this.spawnEntity("player");
  }

  spawnEntity(type: string) {
    // Clear existing
    const entities = this.world.getAllEntities();
    for (const id of entities) {
      this.world.destroyEntity(id);
    }

    let id: number;
    if (type === "player") {
      id = createPlayer(this.world, 0, 0);
    } else {
      // Valid types: hollow, soldier, duelist, brute, boss
      id = createEnemy(this.world, 0, 0, type as any);
    }

    // Strip components that might interfere with manual animation control
    this.world.removeComponent(id, "MovementState");
    this.world.removeComponent(id, "Combat");
    this.world.removeComponent(id, "Physics");
    this.world.removeComponent(id, "AIController");
    this.world.removeComponent(id, "PlayerInput");

    this.currentEntityId = id;
    this.world.getComponent<TransformComponent>(id, "Transform")!.facing = this.facing;
    const inventory = this.world.getComponent<InventoryComponent>(id, "Inventory");
    if (inventory) inventory.currentWeapon = this.weapon;
    this.setAnimation(isQuadruped(type) ? `${type}_idle` : "idle");
  }

  setAnimation(name: string) {
    const animation = AssetLoader.getAnimation(name);
    if (!animation) return;
    const skeleton =
      this.currentEntityId === null
        ? undefined
        : this.world.getComponent<SkeletonComponent>(this.currentEntityId, "Skeleton");
    if (skeleton && skeleton.definitionId !== (animation.skeletonId ?? SkeletonKey.PLAYER)) return;
    this.currentAnimName = name;
    this.playhead = 0;
    this.previewHitbox = null;
    this.refreshAttackTiming();
    this.clearTransientEvents();
    if (this.currentEntityId !== null) {
      const animator = this.world.getComponent<AnimatorComponent>(this.currentEntityId, "Animator");
      if (animator) {
        animator.currentAnim = name;
        animator.time = 0;
        animator.blendFrom = null; // Snap to anim

        // Fix: Reset events so if we re-select the same animation, events fire again
        animator.eventState.clear();
        animator.pendingEvents.length = 0;
      }
    }
  }

  setPlaybackTime(time: number) {
    if (!Number.isFinite(time)) return;
    this.playhead = Math.max(0, Math.min(this.duration, time));
    this.previewHitbox = null;
    this.clearTransientEvents();
    if (this.currentEntityId !== null) {
      const animator = this.world.getComponent<AnimatorComponent>(this.currentEntityId, "Animator");
      if (animator) {
        animator.time = this.currentClipTime;
        animator.pendingEvents.length = 0;
        animator.eventState.clear();
        const anim = AssetLoader.getAnimation(this.currentAnimName);
        if (anim?.events) {
          let index = -1;
          anim.events.forEach((event, i) => {
            if (event.time * anim.duration <= animator.time) index = i;
          });
          if (index >= 0) animator.eventState.set(`main_${anim.name}`, index);
        }
      }
    }
  }

  update(dt: number) {
    const wasPlaying = this.isPlaying;
    dt = wasPlaying && Number.isFinite(dt) ? Math.max(0, dt) * this.playbackSpeed : 0;
    const oldClipTime = this.currentClipTime;
    let cycles = 0;
    if (dt > 0 && this.duration > 0) {
      const next = this.playhead + dt;
      if (this.loop) {
        cycles = Math.floor(next / this.duration);
        this.playhead = next % this.duration;
      } else {
        this.playhead = Math.min(next, this.duration);
        if (this.playhead === this.duration) this.isPlaying = false;
      }
    }
    this.animationSystem.preview = {
      loop: this.loop,
      emitEvents: wasPlaying && dt > 0,
      time: this.currentClipTime,
      delta: cycles * this.clipDuration + this.currentClipTime - oldClipTime,
    };
    this.updateCamera();
    this.game.update(dt);
    if (this.currentEntityId !== null) {
      this.world.getComponent<AnimatorComponent>(this.currentEntityId, "Animator")!.time =
        this.currentClipTime;
    }
    this.drawPreview();
  }

  setPlaybackMode(mode: "clip" | "combat") {
    const clipTime = this.currentClipTime;
    this.playbackMode = mode;
    this.setPlaybackTime(
      mode === "combat" && this.attackTiming
        ? attackElapsedAtClipTime(this.attackTiming, clipTime)
        : clipTime,
    );
  }

  refreshEvents() {
    this.sortedEventCache = undefined;
    this.hitWindowCache = undefined;
    const clipTime = this.currentClipTime;
    this.refreshAttackTiming();
    this.setPlaybackTime(
      this.playbackMode === "combat" && this.attackTiming
        ? attackElapsedAtClipTime(this.attackTiming, clipTime)
        : clipTime,
    );
  }

  setWeapon(weapon: string) {
    if (!WEAPONS[weapon]) return;
    const clipTime = this.currentClipTime;
    this.weapon = weapon;
    if (this.currentEntityId !== null) {
      const inventory = this.world.getComponent<InventoryComponent>(
        this.currentEntityId,
        "Inventory",
      );
      if (inventory) inventory.currentWeapon = weapon;
    }
    this.refreshAttackTiming();
    this.setPlaybackTime(
      this.playbackMode === "combat" && this.attackTiming
        ? attackElapsedAtClipTime(this.attackTiming, clipTime)
        : clipTime,
    );
  }

  flipFacing() {
    this.facing = this.facing === 1 ? -1 : 1;
    if (this.currentEntityId !== null)
      this.world.getComponent<TransformComponent>(this.currentEntityId, "Transform")!.facing =
        this.facing;
  }

  setPlaying(playing: boolean) {
    if (playing && this.playhead >= this.duration) this.setPlaybackTime(0);
    this.previewHitbox = null;
    this.isPlaying = playing;
  }

  stepFrame(direction: number) {
    this.isPlaying = false;
    this.setPlaybackTime(this.playhead + (direction * 1000) / 60);
  }

  setViewportInsets(insets: { left: number; top: number; bottom: number }) {
    this.viewportInsets = insets;
  }

  private updateCamera() {
    const camera = this.world.getResource<CameraState>(CameraState);
    const transform =
      this.currentEntityId === null
        ? undefined
        : this.world.getComponent<TransformComponent>(this.currentEntityId, "Transform");
    const scale = transform?.scale.y ?? 1;
    const { left, top, bottom } = this.viewportInsets;
    const animation = AssetLoader.getAnimation(this.currentAnimName);
    const travel = animation ? attackMotionOffset(animation, animation.duration).x : 0;
    const lift = animation?.motion?.lift ? animation.motion.lift ** 2 / 3200 : 0;
    camera.zoom = Math.max(
      1,
      Math.min(
        this.zoom,
        Math.max(120, this.game.canvas.width - left) / (150 * scale + travel),
        Math.max(110, this.game.canvas.height - top - bottom) / (110 * scale + lift),
      ),
    );
    camera.position = {
      x: (travel * (transform?.facing ?? 1)) / 2 - left / (2 * camera.zoom),
      y: -30 * scale - lift / 2 + (bottom - top) / (2 * camera.zoom),
    };
  }

  private refreshAttackTiming() {
    const anim = AssetLoader.getAnimation(this.currentAnimName);
    this.attackTiming = undefined;
    if (!anim || !this.currentAnimName.includes("attack")) return;
    const owner = enemyTypes.find((type) => this.currentAnimName.startsWith(type + "_"));
    const stats = owner ? ENEMY_STATS[owner] : undefined;
    const heavy =
      this.currentAnimName.includes("heavy") ||
      anim.events?.find((event) => event.type === "hitbox-start")?.data?.attackType === "heavy";
    if (stats) {
      this.attackTiming = createAttackTiming(
        anim,
        anim.windupMs ??
          (this.currentAnimName.includes("special_attack") ? 200 : stats.windupFrames * 16.66),
        heavy ? "heavy" : "light",
        heavy,
      );
    } else {
      const weapon = WEAPONS[this.weapon];
      const slide = this.currentAnimName.startsWith("slide_attack");
      const frames = slide
        ? heavy
          ? 6
          : 4
        : heavy
          ? weapon.heavyAttack.anticipation
          : weapon.lightAttack.anticipation;
      this.attackTiming = createAttackTiming(
        anim,
        (frames / 60) * 1000,
        slide
          ? "slide"
          : this.currentAnimName.startsWith("jump_attack")
            ? "jump"
            : heavy
              ? "heavy"
              : "light",
        heavy,
        weapon,
      );
    }
  }

  private clearTransientEvents() {
    if (this.currentEntityId !== null) {
      this.world.removeComponent(this.currentEntityId, "ActiveHitbox");
      this.world.removeComponent(this.currentEntityId, "SoundRequest");
    }
    for (const { id } of [...this.world.query("VisualEffect"), ...this.world.query("SpawnEffect")])
      this.world.destroyEntity(id);
  }

  private drawPreview() {
    if (this.currentEntityId === null) return;

    const ctx = this.game.canvas.getContext("2d");
    if (!ctx) return;

    const camera = this.world.getResource<CameraState>(CameraState);
    const transform = this.world.getComponent<TransformComponent>(
      this.currentEntityId,
      "Transform",
    );
    if (!transform) return;

    ctx.save();

    // Apply Camera
    ctx.translate(ctx.canvas.width / 2, ctx.canvas.height / 2);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.translate(-camera.position.x, -camera.position.y);

    // A ground reference makes floating and penetrating feet visible during inspection.
    ctx.strokeStyle = "#555566";
    ctx.lineWidth = 1 / camera.zoom;
    ctx.setLineDash([6 / camera.zoom, 4 / camera.zoom]);
    ctx.beginPath();
    ctx.moveTo(camera.position.x - ctx.canvas.width / camera.zoom, 0);
    ctx.lineTo(camera.position.x + ctx.canvas.width / camera.zoom, 0);
    ctx.stroke();
    ctx.fillStyle = "#9999aa";
    ctx.font = `${12 / camera.zoom}px monospace`;
    ctx.fillText("GROUND", 45, -5 / camera.zoom);

    let activeHitbox: any = null;
    for (const event of this.sortedEvents()) {
      if (event.time * this.clipDuration > this.currentClipTime) break;
      if (event.type === "hitbox-start") activeHitbox = event.data;
      else if (event.type === "hitbox-end") activeHitbox = null;
    }
    const baseHitbox = this.previewHitbox ?? (this.showHitboxes ? activeHitbox : null);
    if (!baseHitbox) {
      ctx.restore();
      return;
    }
    const resolved = resolveAttackHitbox(this.world, this.currentEntityId, baseHitbox);
    const hitbox = {
      ...baseHitbox,
      ...resolved,
    };
    let drewBone = false;

    // Bone Attachment Check
    if (hitbox.attachedToBone) {
      const skeleton = this.world.getComponent<SkeletonComponent>(this.currentEntityId, "Skeleton");
      if (skeleton) {
        const boneMatrix = skeleton.worldTransforms.get(hitbox.attachedToBone);
        if (boneMatrix) {
          // Apply bone transformation directly
          ctx.transform(
            boneMatrix.a,
            boneMatrix.b,
            boneMatrix.c,
            boneMatrix.d,
            boneMatrix.tx,
            boneMatrix.ty,
          );
          // Apply hitbox offset relative to bone
          ctx.translate(hitbox.offset?.x || 0, hitbox.offset?.y || 0);
          // Apply hitbox local rotation
          // Note: HitboxDef rotation is usually relative to bone, so just apply it.
          // AnimationSystem adds bone rotation to it, but since we are IN the bone's coordinate space via transform(), we just rotate.
          ctx.rotate(((hitbox.rotation || 0) * Math.PI) / 180);
          drewBone = true;
        }
      }
    }

    // Entity Relative Fallback
    if (!drewBone) {
      ctx.translate(transform.position.x, transform.position.y);
      ctx.scale(transform.facing, 1);

      ctx.translate(hitbox.offset?.x || 0, hitbox.offset?.y || 0);
      ctx.rotate(((hitbox.rotation || 0) * Math.PI) / 180);
    }

    // Draw Rect
    const w = hitbox.width || 0;
    const h = hitbox.height || 0;

    // Editor Style: Bright Green dashed
    ctx.strokeStyle = "#00ff00";
    ctx.lineWidth = 2 / camera.zoom;
    ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
    ctx.fillStyle = "rgba(0, 255, 0, 0.2)";

    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.strokeRect(-w / 2, -h / 2, w, h);

    // Draw facing indicator
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(w / 2, 0);
    ctx.stroke();

    ctx.restore();
  }

  destroy() {
    this.game.destroy();
  }
}
