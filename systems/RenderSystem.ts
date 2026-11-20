import { World } from "../core/World";
import {
  CameraState,
  GlobalLight,
  SpatialGridState,
  EditorState,
  BattleState,
} from "../core/Resources";
import { TransformComponent } from "../components/Transform";
import { ColliderComponent } from "../components/Collider";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { PlayerBonePaths } from "../assets/svg/PlayerSVG";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";
import { EffectPaths } from "../assets/svg/EffectSVGs";
import { TilePaths } from "../assets/svg/EnvironmentSVGs";
import { WeaponPaths } from "../assets/svg/WeaponSVGs";
import {
  VisualEffectComponent,
  HitFlashComponent,
} from "../features/visuals/VisualEffectComponent";
import { HealthComponent } from "../components/Health";
import { EnemyTagComponent } from "../components/EnemyTag";
import { PlatformComponent } from "../components/Platform";
import { DEBUG } from "../debug/DebugFlags";
import { drawSkeleton, drawHitboxes, drawPoseInspector } from "../debug/DebugDraw";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";
import { SpriteCache } from "../utils/SpriteCache";
import { InventoryComponent } from "../components/Inventory";
import { WEAPONS } from "../data/WeaponDefinitions";
import { InteractableComponent } from "../components/Interactable";
import { CheckpointComponent } from "../components/Checkpoint";
import { TriggerComponent } from "../components/Trigger";
import { FactionComponent } from "../components/Faction";
import { BoneDrawing, DrawingLayer } from "../assets/svg/BoneDrawing";

export class RenderSystem {
  private ctx: CanvasRenderingContext2D;
  private pathCache: Map<string, Path2D> = new Map();
  private lightCanvas: HTMLCanvasElement;
  private lightCtx: CanvasRenderingContext2D;
  private lightStampCache = new Map<number, HTMLCanvasElement>();
  private queryBuffer: number[] = [];
  private animatedEntities: {
    id: number;
    transform: TransformComponent;
    skeleton: SkeletonComponent;
  }[] = [];
  private animatedEntryPool: {
    id: number;
    transform: TransformComponent;
    skeleton: SkeletonComponent;
  }[] = [];
  private boneOrderCache = new WeakMap<
    SkeletonComponent,
    {
      definition: SkeletonComponent["definition"];
      transforms: SkeletonComponent["worldTransforms"];
      size: number;
      normal: string[];
      gripped: string[];
    }
  >();
  private layerCache = new WeakMap<
    BoneDrawing,
    { source: DrawingLayer[] | undefined; count: number; layers: DrawingLayer[] }
  >();

  constructor(
    private world: World,
    canvas: HTMLCanvasElement,
    private vectorPreview = false,
  ) {
    this.ctx = canvas.getContext("2d")!;
    this.lightCanvas = document.createElement("canvas");
    this.lightCanvas.width = canvas.width;
    this.lightCanvas.height = canvas.height;
    this.lightCtx = this.lightCanvas.getContext("2d")!;
  }

  private getPath(d: string): Path2D {
    let p = this.pathCache.get(d);
    if (!p) {
      p = new Path2D(d);
      this.pathCache.set(d, p);
    }
    return p;
  }

  private getBoneOrder(s: SkeletonComponent): string[] {
    let cached = this.boneOrderCache.get(s);
    if (
      !cached ||
      cached.definition !== s.definition ||
      cached.transforms !== s.worldTransforms ||
      cached.size !== s.worldTransforms.size
    ) {
      const ids = [...s.worldTransforms.keys()].filter((id) => s.definition!.bones.has(id));
      const order = (id: string, gripped: boolean) =>
        gripped && id === "hand-back"
          ? 9
          : gripped && id === "hand-front"
            ? 9.1
            : gripped && id.startsWith("arm-back-")
              ? 6.5
              : s.definition!.bones.get(id)!.renderOrder;
      cached = {
        definition: s.definition,
        transforms: s.worldTransforms,
        size: s.worldTransforms.size,
        normal: ids.slice().sort((a, b) => order(a, false) - order(b, false)),
        gripped: ids.sort((a, b) => order(a, true) - order(b, true)),
      };
      this.boneOrderCache.set(s, cached);
    }
    return s.offHandGripActive ? cached.gripped : cached.normal;
  }

  private getLayers(drawing: BoneDrawing): DrawingLayer[] {
    let cached = this.layerCache.get(drawing);
    if (
      !cached ||
      cached.source !== drawing.layers ||
      cached.count !== (drawing.layers?.length ?? 0)
    ) {
      cached = {
        source: drawing.layers,
        count: drawing.layers?.length ?? 0,
        layers: [drawing, ...(drawing.layers ?? [])],
      };
      this.layerCache.set(drawing, cached);
    }
    return cached.layers;
  }

  private getLightStamp(radius: number): HTMLCanvasElement | null {
    const r = Math.max(1, Math.round(radius));
    const cached = this.lightStampCache.get(r);
    if (cached) return cached;
    if (typeof document === "undefined") return null;

    const stamp = document.createElement("canvas");
    stamp.width = r * 2;
    stamp.height = r * 2;
    const sctx = stamp.getContext("2d");
    if (!sctx) return null;

    const grad = sctx.createRadialGradient(r, r, 0, r, r, r);
    grad.addColorStop(0, "rgba(0,0,0,1)");
    grad.addColorStop(1, "rgba(0,0,0,0)");
    sctx.fillStyle = grad;
    sctx.fillRect(0, 0, stamp.width, stamp.height);
    this.lightStampCache.set(r, stamp);
    return stamp;
  }

  update() {
    const camera = this.world.getResource<CameraState>(CameraState);
    const lighting = this.world.getResource<GlobalLight>(GlobalLight);
    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);
    const editor = this.world.getResource<EditorState>(EditorState);
    const showTeamMarkers =
      this.world.getResource<BattleState>(BattleState)?.showTeamMarkers ?? false;

    // Clear screen
    this.ctx.fillStyle = "#0a0a10"; // Dark sky color
    this.ctx.fillRect(0, 0, this.ctx.canvas.width, this.ctx.canvas.height);

    this.ctx.save();

    // Apply Camera
    this.ctx.translate(this.ctx.canvas.width / 2, this.ctx.canvas.height / 2);

    // Shake
    let shakeX = 0,
      shakeY = 0;
    if (camera.shake.duration > 0) {
      shakeX = (Math.random() - 0.5) * camera.shake.amplitude * 2;
      shakeY = (Math.random() - 0.5) * camera.shake.amplitude * 2;
      this.ctx.translate(shakeX, shakeY);
    }

    this.ctx.scale(camera.zoom, camera.zoom);
    this.ctx.translate(-camera.position.x, -camera.position.y);

    // Calculate Camera AABB for Culling
    const viewW = this.ctx.canvas.width / camera.zoom;
    const viewH = this.ctx.canvas.height / camera.zoom;
    const viewRect = {
      x: camera.position.x - viewW / 2 - 100, // Padding
      y: camera.position.y - viewH / 2 - 100,
      width: viewW + 200,
      height: viewH + 200,
    };

    // --- Render Background (Parallax) ---
    // In Editor, default to hidden to reduce clutter, unless explicitly enabled
    if (!editor.enabled || !editor.hideBackground) {
      this.drawBackground(camera);
    }

    // --- Render Environment (Foreground) ---
    // Query Static Grid for visible tiles
    const visiblePlatformIds = grids.staticGrid.query(viewRect, this.queryBuffer);

    for (const id of visiblePlatformIds) {
      const t = this.world.getComponent<TransformComponent>(id, "Transform");
      const c = this.world.getComponent<ColliderComponent>(id, "Collider");
      if (!t || !c) continue;

      const plat = this.world.getComponent<PlatformComponent>(id, "Platform");
      const assetName = plat?.asset || "stone-block";

      const tileData = TilePaths[assetName] || TilePaths["stone-block"];
      const box = c.hurtboxes[0];

      if (this.world.hasComponent(id, "Interactable")) {
        this.ctx.save();
        this.ctx.translate(t.position.x, t.position.y);
        const path = this.getPath(tileData.path);
        this.ctx.fillStyle = tileData.fill;
        this.ctx.fill(path);
        if (tileData.stroke) {
          this.ctx.strokeStyle = tileData.stroke;
          this.ctx.lineWidth = tileData.strokeWidth ?? 1;
          this.ctx.stroke(path);
        }
        this.ctx.restore();
        continue;
      }
      if (box && tileData) {
        const cols = Math.ceil(box.width / 32);
        const rows = Math.ceil(box.height / 32);

        // Use object ref for caching
        const cachedSprite = SpriteCache.get(
          tileData,
          tileData.path,
          tileData.fill,
          tileData.stroke,
          tileData.strokeWidth,
        );

        // Fallback fillers
        const fillerData = assetName === "stone-floor" ? TilePaths["stone-block"] : tileData;
        const cachedFiller =
          assetName === "stone-floor"
            ? SpriteCache.get(
                fillerData,
                fillerData.path,
                fillerData.fill,
                fillerData.stroke,
                fillerData.strokeWidth,
              )
            : cachedSprite;

        // Cull individual cells using the padded artwork bounds, including shake.
        const mainBounds = cachedSprite
          ? {
              x: (cachedSprite as any).offsetX || 0,
              y: (cachedSprite as any).offsetY || 0,
              width: cachedSprite.width,
              height: cachedSprite.height,
            }
          : SpriteCache.getBounds(tileData.path);
        const fillerBounds = cachedFiller
          ? {
              x: (cachedFiller as any).offsetX || 0,
              y: (cachedFiller as any).offsetY || 0,
              width: cachedFiller.width,
              height: cachedFiller.height,
            }
          : SpriteCache.getBounds(fillerData.path);
        const minX = Math.min(mainBounds.x, fillerBounds.x),
          minY = Math.min(mainBounds.y, fillerBounds.y);
        const maxX = Math.max(mainBounds.x + mainBounds.width, fillerBounds.x + fillerBounds.width);
        const maxY = Math.max(
          mainBounds.y + mainBounds.height,
          fillerBounds.y + fillerBounds.height,
        );
        const left = viewRect.x - shakeX / camera.zoom - t.position.x - box.x;
        const top = viewRect.y - shakeY / camera.zoom - t.position.y - box.y;
        const firstCol = Math.max(0, Math.ceil((left - maxX) / 32));
        const lastCol = Math.min(cols - 1, Math.floor((left + viewRect.width - minX) / 32));
        const firstRow = Math.max(0, Math.ceil((top - maxY) / 32));
        const lastRow = Math.min(rows - 1, Math.floor((top + viewRect.height - minY) / 32));

        for (let r = firstRow; r <= lastRow; r++) {
          for (let c = firstCol; c <= lastCol; c++) {
            this.ctx.save();
            this.ctx.translate(t.position.x + box.x + c * 32, t.position.y + box.y + r * 32);

            let sprite = cachedSprite;

            if (assetName === "stone-floor" && r > 0) {
              sprite = cachedFiller;
            }

            if (sprite) {
              // SpriteCache canvases have offsets attached
              this.ctx.drawImage(
                sprite,
                (sprite as any).offsetX || 0,
                (sprite as any).offsetY || 0,
              );
            } else {
              // Fallback to path
              const p = this.getPath(r === 0 ? tileData.path : fillerData.path);
              this.ctx.fillStyle = tileData.fill;
              this.ctx.fill(p);
            }
            this.ctx.restore();
          }
        }
      } else {
        this.ctx.fillStyle = "#444";
        for (const box of c.hurtboxes) {
          this.ctx.fillRect(t.position.x + box.x, t.position.y + box.y, box.width, box.height);
        }
      }
    }

    // Draw Weapon Trails (Global Query - usually few)
    const trails = this.world.query("WeaponTrail");
    for (const { components } of trails) {
      const trail = components[0] as WeaponTrailComponent;
      if (trail.history.length < 2) continue;

      this.ctx.save();
      this.ctx.fillStyle = trail.color;
      this.ctx.globalAlpha = 0.5;

      this.ctx.beginPath();
      const len = trail.history.length;
      for (let i = 0; i < len - 1; i++) {
        const p1 = trail.history[i];
        const p2 = trail.history[i + 1];

        this.ctx.moveTo(p1.base.x, p1.base.y);
        this.ctx.lineTo(p1.tip.x, p1.tip.y);
        this.ctx.lineTo(p2.tip.x, p2.tip.y);
        this.ctx.lineTo(p2.base.x, p2.base.y);
      }
      this.ctx.fill();
      this.ctx.restore();
    }

    // --- Draw Entities with Skeletons ---
    // Query Dynamic Grid for visible entities
    const visibleEntityIds = grids.dynamicGrid.query(viewRect, this.queryBuffer);

    const animatedEntities = this.animatedEntities;
    let animatedCount = 0;

    for (const id of visibleEntityIds) {
      const transform = this.world.getComponent<TransformComponent>(id, "Transform");
      const skeleton = this.world.getComponent<SkeletonComponent>(id, "Skeleton");
      if (transform && skeleton) {
        let entry = this.animatedEntryPool[animatedCount];
        if (!entry) {
          entry = { id, transform, skeleton };
          this.animatedEntryPool.push(entry);
        } else {
          entry.id = id;
          entry.transform = transform;
          entry.skeleton = skeleton;
        }
        animatedEntities[animatedCount++] = entry;
      }
    }
    animatedEntities.length = animatedCount;

    animatedEntities.sort((a, b) => {
      const diff = a.transform.position.y - b.transform.position.y;
      if (Math.abs(diff) < 0.1) {
        const deadA = this.world.getComponent<HealthComponent>(a.id, "Health")?.isDead ?? false;
        const deadB = this.world.getComponent<HealthComponent>(b.id, "Health")?.isDead ?? false;
        if (deadA !== deadB) return deadA ? -1 : 1;
        return a.id - b.id;
      }
      return diff;
    });

    for (const { id, transform, skeleton: s } of animatedEntities) {
      const health = this.world.getComponent<HealthComponent>(id, "Health");
      const flash = this.world.getComponent<HitFlashComponent>(id, "HitFlash");
      const enemyTag = this.world.getComponent<EnemyTagComponent>(id, "EnemyTag");
      const inventory = this.world.getComponent<InventoryComponent>(id, "Inventory");
      const playerInput = this.world.getComponent<any>(id, "PlayerInput");
      const team = this.world.getComponent<FactionComponent>(id, "Faction")?.team;
      const teamColor = showTeamMarkers
        ? team === 3
          ? "#ff8888"
          : team === 4
            ? "#88bbff"
            : null
        : null;

      // Editor: Highlight player start
      if (editor.enabled && playerInput) {
        this.ctx.save();
        this.ctx.translate(transform.position.x, transform.position.y);

        // Draw the exact selection rect logic used in LevelEditor
        // px - 20, py - 70, w 40, h 70
        // Relative to transform (px, py), this is x: -20, y: -70
        this.ctx.strokeStyle = "#ffff00";
        this.ctx.lineWidth = 2 / camera.zoom;
        this.ctx.strokeRect(-20, -70, 40, 70);

        this.ctx.fillStyle = "white";
        this.ctx.font = `bold ${12 / camera.zoom}px monospace`;
        this.ctx.textAlign = "center";
        this.ctx.fillText("PLAYER START", 0, -80);

        // Draw origin point
        this.ctx.fillStyle = "#ff00ff";
        this.ctx.fillRect(-2, -2, 4, 4);

        this.ctx.restore();
      }

      if (s.definition && s.worldTransforms.size > 0) {
        // Optimization: Apply lighting/effects ONCE per entity context
        this.ctx.save();

        // NPC hit/guard/recoil feedback is local to the contacted body part.
        // Damage protection remains intact; preserve the player's readable
        // evasion/protection blink without fading every enemy's whole body.
        if (playerInput && health && health.invulnTimer > 0) {
          if (Math.floor(health.invulnTimer / 64) % 2 === 0) {
            this.ctx.globalAlpha = 0.3;
          }
        }

        let bonePaths: Record<string, BoneDrawing> = PlayerBonePaths;
        if (enemyTag) {
          bonePaths = (EnemyBonePaths[enemyTag.enemyType] || EnemyBonePaths["hollow"]) as any;
        }

        const bonesToRender = this.getBoneOrder(s);

        // Precompute Scale factors for stroke width once per entity
        const scaleFactor = Math.abs(camera.zoom * transform.scale.x);

        if (!flash || flash.bone) {
          for (const boneId of bonesToRender) {
            let pathData = bonePaths[boneId];

            // DYNAMIC WEAPON OVERRIDE
            if (boneId === "weapon" && inventory) {
              const weaponDef = WEAPONS[inventory.currentWeapon];
              if (weaponDef && WeaponPaths[weaponDef.svgAsset]) {
                pathData = WeaponPaths[weaponDef.svgAsset];
              }
            }

            if (pathData) {
              this.ctx.save();
              const m = s.worldTransforms.get(boneId)!;
              this.ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);

              for (const layer of this.getLayers(pathData)) {
                // Use Cached Sprite with Object Ref key
                const sprite =
                  this.vectorPreview || pathData.vector
                    ? null
                    : SpriteCache.get(
                        layer,
                        layer.path,
                        layer.fill,
                        layer.stroke,
                        layer.strokeWidth,
                      );

                if (sprite) {
                  this.ctx.drawImage(
                    sprite,
                    (sprite as any).offsetX || 0,
                    (sprite as any).offsetY || 0,
                  );
                } else {
                  // Fallback
                  this.ctx.fillStyle = layer.fill;
                  const p = this.getPath(layer.path);
                  this.ctx.fill(p);
                  if (layer.stroke) {
                    this.ctx.strokeStyle = layer.stroke;
                    this.ctx.lineWidth = (layer.strokeWidth || 1) / scaleFactor;
                    this.ctx.stroke(p);
                  }
                }
              }

              if (teamColor && !health?.isDead) {
                this.ctx.strokeStyle = teamColor;
                this.ctx.lineWidth = 0.75 / scaleFactor;
                this.ctx.stroke(this.getPath(pathData.path));
              }
              if (flash?.bone === boneId) {
                this.ctx.globalAlpha *=
                  (flash.opacity ?? 0.4) *
                  Math.max(0, Math.min(1, (flash.remainingMs ?? 80) / (flash.durationMs ?? 80)));
                this.ctx.fillStyle = flash.color || "#ffd0ac";
                this.ctx.fill(this.getPath(pathData.path));
              }

              this.ctx.restore();
            }
          }
        } else {
          for (const boneId of bonesToRender) {
            let pathData = bonePaths[boneId];

            // DYNAMIC WEAPON OVERRIDE (For Flash pass too)
            if (boneId === "weapon" && inventory) {
              const weaponDef = WEAPONS[inventory.currentWeapon];
              if (weaponDef && WeaponPaths[weaponDef.svgAsset]) {
                pathData = WeaponPaths[weaponDef.svgAsset];
              }
            }

            if (pathData) {
              this.ctx.save();
              const m = s.worldTransforms.get(boneId)!;
              this.ctx.transform(m.a, m.b, m.c, m.d, m.tx, m.ty);
              this.ctx.fillStyle = flash.color || "white";
              const p = this.getPath(pathData.path);
              this.ctx.fill(p);
              this.ctx.restore();
            }
          }
        }

        this.ctx.restore(); // Restores alpha, filter
        if (teamColor && !health?.isDead) {
          const torso = s.worldTransforms.get("torso");
          if (torso) {
            const radius = 3 / camera.zoom;
            this.ctx.save();
            this.ctx.fillStyle = teamColor;
            this.ctx.strokeStyle = "#ffffff";
            this.ctx.lineWidth = 1 / camera.zoom;
            this.ctx.beginPath();
            this.ctx.arc(torso.tx, torso.ty, radius, 0, Math.PI * 2);
            this.ctx.fill();
            this.ctx.stroke();
            this.ctx.restore();
          }
        }
      }
    }

    // Draw Visual Effects (Global query for now, effects are transient)
    const effects = this.world.query("VisualEffect");
    for (const { components } of effects) {
      const effect = components[0] as VisualEffectComponent;
      const data = EffectPaths[effect.type] || EffectPaths["spark"];

      this.ctx.save();
      this.ctx.translate(effect.position.x, effect.position.y);
      this.ctx.rotate((effect.rotation * Math.PI) / 180);
      this.ctx.scale(effect.scale, effect.scale);

      this.ctx.globalAlpha = effect.alpha;

      // EffectPaths are also static consts, use ref
      const sprite = SpriteCache.get(data, data.path, data.fill!, data.stroke, data.strokeWidth);

      if (sprite) {
        this.ctx.drawImage(sprite, (sprite as any).offsetX || 0, (sprite as any).offsetY || 0);
      } else {
        this.ctx.fillStyle = data.fill || "white";
        const p = this.getPath(data.path);
        this.ctx.fill(p);
      }

      this.ctx.restore();
    }

    // Lighting Overlay (Darkness)
    if (lighting.sources.length > 0 && !editor.enabled) {
      // Ensure light buffer matches screen size
      if (
        this.lightCanvas.width !== this.ctx.canvas.width ||
        this.lightCanvas.height !== this.ctx.canvas.height
      ) {
        this.lightCanvas.width = this.ctx.canvas.width;
        this.lightCanvas.height = this.ctx.canvas.height;
      }

      // 1. Clear offscreen canvas
      this.lightCtx.clearRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);

      // 2. Fill with darkness
      this.lightCtx.globalCompositeOperation = "source-over";
      this.lightCtx.fillStyle = `rgba(0, 0, 10, ${1 - lighting.ambientIntensity})`;
      this.lightCtx.fillRect(0, 0, this.lightCanvas.width, this.lightCanvas.height);

      // 3. Cut holes for lights
      this.lightCtx.globalCompositeOperation = "destination-out";

      for (const src of lighting.sources) {
        // Convert World to Screen
        const screenX =
          (src.position.x - camera.position.x) * camera.zoom + this.ctx.canvas.width / 2;
        const screenY =
          (src.position.y - camera.position.y) * camera.zoom + this.ctx.canvas.height / 2;
        const radius = src.radius * camera.zoom;

        const stamp = radius > 0 ? this.getLightStamp(radius) : null;
        if (stamp) {
          this.lightCtx.drawImage(stamp, screenX - stamp.width / 2, screenY - stamp.height / 2);
        } else {
          const grad = this.lightCtx.createRadialGradient(
            screenX,
            screenY,
            0,
            screenX,
            screenY,
            radius,
          );
          grad.addColorStop(0, "rgba(0,0,0,1)"); // Removes darkness
          grad.addColorStop(1, "rgba(0,0,0,0)"); // Keeps darkness

          this.lightCtx.fillStyle = grad;
          this.lightCtx.beginPath();
          this.lightCtx.arc(screenX, screenY, radius, 0, Math.PI * 2);
          this.lightCtx.fill();
        }
      }

      // 4. Draw overlay onto main canvas
      this.ctx.save();
      this.ctx.setTransform(1, 0, 0, 1, 0, 0); // Reset transform to screen space
      this.ctx.globalCompositeOperation = "source-over";
      this.ctx.drawImage(this.lightCanvas, 0, 0);
      this.ctx.restore();
    }

    // === EDITOR DRAWING ===
    if (editor.enabled) {
      // 1. Triggers
      const triggers = this.world.query("Trigger", "Transform", "Collider");
      this.ctx.fillStyle = "rgba(255, 255, 0, 0.3)";
      this.ctx.strokeStyle = "rgba(255, 255, 0, 0.8)";
      this.ctx.lineWidth = 2 / camera.zoom;

      for (const { components } of triggers) {
        const trig = components[0] as TriggerComponent;
        const t = components[1] as TransformComponent;
        const c = components[2] as ColliderComponent;
        const box = c.hurtboxes[0];

        this.ctx.save();
        this.ctx.translate(t.position.x, t.position.y);
        this.ctx.fillRect(box.x, box.y, box.width, box.height);
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);

        // Label
        this.ctx.fillStyle = "white";
        this.ctx.font = `${10 / camera.zoom}px monospace`;
        this.ctx.fillText(trig.type, box.x, box.y - 5);
        this.ctx.restore();
      }

      // 2. Checkpoints
      const checkpoints = this.world.query("Checkpoint", "Transform", "Collider");
      this.ctx.fillStyle = "rgba(0, 255, 0, 0.3)";
      this.ctx.strokeStyle = "rgba(0, 255, 0, 0.8)";

      for (const { components } of checkpoints) {
        const cp = components[0] as CheckpointComponent;
        const t = components[1] as TransformComponent;
        const c = components[2] as ColliderComponent;
        const box = c.hurtboxes[0];

        this.ctx.save();
        this.ctx.translate(t.position.x, t.position.y);
        this.ctx.fillRect(box.x, box.y, box.width, box.height);
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);

        // Checkpoint Flag visual
        this.ctx.beginPath();
        this.ctx.moveTo(box.x + box.width / 2, box.y + box.height);
        this.ctx.lineTo(box.x + box.width / 2, box.y);
        this.ctx.lineTo(box.x + box.width, box.y + 10);
        this.ctx.lineTo(box.x + box.width / 2, box.y + 20);
        this.ctx.strokeStyle = "white";
        this.ctx.stroke();

        this.ctx.fillStyle = "white";
        this.ctx.font = `${10 / camera.zoom}px monospace`;
        this.ctx.fillText(cp.id, box.x, box.y - 5);
        this.ctx.restore();
      }

      // 3. Interactables
      const interactables = this.world.query("Interactable", "Transform", "Collider");
      this.ctx.fillStyle = "rgba(0, 255, 255, 0.3)";
      this.ctx.strokeStyle = "rgba(0, 255, 255, 0.8)";

      for (const { components } of interactables) {
        const i = components[0] as InteractableComponent;
        const t = components[1] as TransformComponent;
        const c = components[2] as ColliderComponent;
        const box = c.hurtboxes[0];

        this.ctx.save();
        this.ctx.translate(t.position.x, t.position.y);
        this.ctx.fillRect(box.x, box.y, box.width, box.height);
        this.ctx.strokeRect(box.x, box.y, box.width, box.height);

        this.ctx.fillStyle = "white";
        this.ctx.font = `${10 / camera.zoom}px monospace`;
        this.ctx.fillText(i.type, box.x, box.y - 5);
        this.ctx.restore();
      }
    }

    // === DEBUG DRAW (World Space) ===
    if (DEBUG.DRAW_SKELETONS || DEBUG.DRAW_PIVOTS) {
      const skeletons = this.world.query("Skeleton", "Transform");
      for (const { components } of skeletons) {
        drawSkeleton(
          this.ctx,
          components[0] as SkeletonComponent,
          components[1] as TransformComponent,
        );
      }
    }

    if (
      DEBUG.DRAW_HITBOXES ||
      DEBUG.DRAW_HURTBOXES ||
      DEBUG.DRAW_COLLISION ||
      DEBUG.SHOW_STATE_INFO
    ) {
      drawHitboxes(this.ctx, this.world);
    }

    // === EDITOR OVERLAYS ===
    if (editor.enabled) {
      this.ctx.lineWidth = 1 / camera.zoom;

      // Draw Grid
      if (editor.showGrid) {
        const gridSize =
          Number.isFinite(editor.gridSize) && editor.gridSize >= 1 && editor.gridSize <= 256
            ? editor.gridSize
            : 32;
        this.ctx.save();
        this.ctx.strokeStyle = "rgba(255, 255, 255, 0.1)";
        this.ctx.beginPath();

        // Calculate grid range visible
        const startX = Math.floor(viewRect.x / gridSize) * gridSize;
        const startY = Math.floor(viewRect.y / gridSize) * gridSize;
        const endX = viewRect.x + viewRect.width;
        const endY = viewRect.y + viewRect.height;

        for (let x = startX; x < endX; x += gridSize) {
          this.ctx.moveTo(x, viewRect.y);
          this.ctx.lineTo(x, endY);
        }
        for (let y = startY; y < endY; y += gridSize) {
          this.ctx.moveTo(viewRect.x, y);
          this.ctx.lineTo(endX, y);
        }
        this.ctx.stroke();
        this.ctx.restore();
      }

      // Draw Selection Highlight
      if (editor.selection) {
        this.ctx.save();
        this.ctx.strokeStyle = "#00ff00";
        this.ctx.lineWidth = 2 / camera.zoom;
        this.ctx.setLineDash([4 / camera.zoom, 4 / camera.zoom]);
        this.ctx.strokeRect(
          editor.selection.x,
          editor.selection.y,
          editor.selection.width,
          editor.selection.height,
        );
        // Draw crosshair at center
        this.ctx.beginPath();
        const cx = editor.selection.x + editor.selection.width / 2;
        const cy = editor.selection.y + editor.selection.height / 2;
        this.ctx.moveTo(cx - 5, cy);
        this.ctx.lineTo(cx + 5, cy);
        this.ctx.moveTo(cx, cy - 5);
        this.ctx.lineTo(cx, cy + 5);
        this.ctx.stroke();
        this.ctx.restore();
      }

      // Draw Ghost (Preview)
      if (editor.ghost) {
        this.ctx.save();
        this.ctx.globalAlpha = 0.5;
        this.ctx.fillStyle = "rgba(100, 100, 255, 0.5)";
        this.ctx.fillRect(editor.ghost.x, editor.ghost.y, editor.ghost.width, editor.ghost.height);
        this.ctx.strokeStyle = "#ffffff";
        this.ctx.strokeRect(
          editor.ghost.x,
          editor.ghost.y,
          editor.ghost.width,
          editor.ghost.height,
        );
        this.ctx.restore();
      }
    }

    this.ctx.restore();

    if (DEBUG.SHOW_POSE_VALUES) {
      const players = this.world.query("PlayerInput", "Skeleton");
      if (players.length > 0) {
        drawPoseInspector(this.ctx, players[0].components[1] as SkeletonComponent, 10, 100);
      }
    }
  }

  private drawBackground(camera: CameraState) {
    // Draw Mountains Far (Parallax 0.2)
    const parallaxFar = 0.2;
    const offsetFarX = (camera.position.x * parallaxFar) % 1000;
    const camYFar = camera.position.y * parallaxFar * 0.5;

    this.ctx.save();
    this.ctx.translate(-offsetFarX, -camYFar + 200);
    this.ctx.fillStyle = "#151515";

    for (let i = -1; i <= 1; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * 1000 + 0, 500);
      this.ctx.lineTo(i * 1000 + 200, 100);
      this.ctx.lineTo(i * 1000 + 500, 400);
      this.ctx.lineTo(i * 1000 + 800, 150);
      this.ctx.lineTo(i * 1000 + 1000, 500);
      this.ctx.fill();
    }
    this.ctx.restore();

    // Draw Mountains Near (Parallax 0.5)
    const parallaxNear = 0.5;
    const offsetNearX = (camera.position.x * parallaxNear) % 1200;
    const camYNear = camera.position.y * parallaxNear * 0.5;

    this.ctx.save();
    this.ctx.translate(-offsetNearX, -camYNear + 400);
    this.ctx.fillStyle = "#1f1f1f";

    for (let i = -1; i <= 1; i++) {
      this.ctx.beginPath();
      this.ctx.moveTo(i * 1200 + 0, 600);
      this.ctx.lineTo(i * 1200 + 150, 400);
      this.ctx.lineTo(i * 1200 + 400, 600);
      this.ctx.lineTo(i * 1200 + 600, 350);
      this.ctx.lineTo(i * 1200 + 900, 600);
      this.ctx.lineTo(i * 1200 + 1200, 600);
      this.ctx.fill();
    }
    this.ctx.restore();
  }
}
