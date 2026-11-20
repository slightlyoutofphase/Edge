import { World } from "../core/World";
import { TransformComponent } from "../components/Transform";
import { ColliderComponent, CollisionLayer } from "../components/Collider";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { PlatformComponent } from "../components/Platform";
import { HealthComponent } from "../components/Health";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { aabbIntersects, getOverlap, AABB } from "../utils/AABB";
import { TimeState, SpatialGridState } from "../core/Resources";
import { Vec2 } from "../utils/Vec2";
import { applyHealthDamage } from "../features/combat/HealthDamage";
import { bodySeparationBounds } from "../features/combat/BodySeparation";
import { actorInertia } from "../features/combat/ImpactResponse";
import { SpatialHashGrid } from "../utils/SpatialHashGrid";

export class CollisionSystem {
  // Persistent buffers to reduce GC
  private queryBuffer: number[] = [];
  private separationTerrainBuffer: number[] = [];
  private contactTimes = new Map<number, number>();
  private rectCache: { x: number; y: number; width: number; height: number } = {
    x: 0,
    y: 0,
    width: 0,
    height: 0,
  };

  // Scratch AABBs
  private entityAABB: AABB = { x: 0, y: 0, width: 0, height: 0 };
  private platAABB: AABB = { x: 0, y: 0, width: 0, height: 0 };
  private contactAABB: AABB = { x: 0, y: 0, width: 0, height: 0 };
  private groundCheckAABB: AABB = { x: 0, y: 0, width: 0, height: 0 };
  private bodyGrid = new SpatialHashGrid(128);
  private separationRect2: AABB = { x: 0, y: 0, width: 0, height: 0 };
  private separationRect1: AABB = { x: 0, y: 0, width: 0, height: 0 };

  private overlap: Vec2 = { x: 0, y: 0 };
  private hazardCooldowns = new Map<number, Map<number, number>>();
  private moversBuffer: number[] = [];

  constructor(private world: World) {
    this.world.onEntityDestroy((id) => {
      this.hazardCooldowns.delete(id);
      for (const inner of this.hazardCooldowns.values()) {
        inner.delete(id);
      }
      this.contactTimes.delete(id);
    });
  }

  reset() {
    this.hazardCooldowns.clear();
    this.contactTimes.clear();
    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);
    if (grids) {
      grids.dynamicGrid.clear();
      grids.staticGrid.clear();
      grids.needsStaticRebuild = true;
    }
  }

  update(resolve = true) {
    const time = this.world.getResource<TimeState>(TimeState);
    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);

    // Fallback to 16ms if delta is 0 to ensure logic runs even in first frame or edge cases
    const dt = time.delta || 16;

    // Query all collidables. We separate them into static (Platform) and dynamic (Everything else)
    const allCollidables = this.world.query("Transform", "Collider");

    // Populate Static Grid (Once per level load / reset)
    if (grids.needsStaticRebuild) {
      grids.staticGrid.clear();
      for (const {
        id,
        components: [t, c],
      } of allCollidables) {
        // If it has a Platform component, it goes into static grid
        if (this.world.hasComponent(id, "Platform")) {
          const transform = t as TransformComponent;
          const collider = c as ColliderComponent;
          if (collider.hurtboxes.length > 0) {
            const box = collider.hurtboxes[0];
            const scaleX = Math.abs(transform.scale.x);
            const scaleY = transform.scale.y;

            this.rectCache.x = transform.position.x + box.x * scaleX;
            this.rectCache.y = transform.position.y + box.y * scaleY;
            this.rectCache.width = box.width * scaleX;
            this.rectCache.height = box.height * scaleY;

            grids.staticGrid.insert(id, this.rectCache);
          }
        }
      }
      grids.needsStaticRebuild = false;
    }

    // Populate Dynamic Grid with everything ELSE (Players, Enemies, Objects)
    grids.dynamicGrid.clear();
    const movers = this.moversBuffer;
    movers.length = 0;

    for (const {
      id,
      components: [t, c],
    } of allCollidables) {
      // Skip Platforms (already in static)
      if (this.world.hasComponent(id, "Platform")) continue;

      const transform = t as TransformComponent;
      const collider = c as ColliderComponent;

      if (collider.hurtboxes.length > 0) {
        const box = collider.hurtboxes[0];
        const scaleX = Math.abs(transform.scale.x);
        const scaleY = transform.scale.y;

        this.rectCache.x = transform.position.x + box.x * scaleX;
        this.rectCache.y = transform.position.y + box.y * scaleY;
        this.rectCache.width = box.width * scaleX;
        this.rectCache.height = box.height * scaleY;

        grids.dynamicGrid.insert(id, this.rectCache);
      }

      // If it has physics/movement, we'll process environmental collision for it
      if (this.world.hasComponent(id, "Physics") && this.world.hasComponent(id, "MovementState")) {
        movers.push(id);
      }
    }

    if (!resolve) return;
    for (const [platformId, occupants] of this.hazardCooldowns) {
      if (!this.world.hasComponent(platformId, "Platform")) {
        this.hazardCooldowns.delete(platformId);
        continue;
      }
      for (const [id, remaining] of occupants) {
        if (!this.world.hasComponent(id, "Health") || remaining <= dt) occupants.delete(id);
        else occupants.set(id, remaining - dt);
      }
    }

    let dynamicPositionsChanged = false;
    // --- Pass 1: Entity Separation ---
    // Run BEFORE environment collision

    // A few bounded passes resolve chains of bodies without changing terrain
    // colliders. Rebuild this broadphase after corrections, since a large head
    // can cross a cell boundary even when the movement box does not.
    for (let pass = 0; pass < 4; pass++) {
      this.bodyGrid.clear();
      for (const id of movers) {
        const health = this.world.getComponent<HealthComponent>(id, "Health");
        const collider = this.world.getComponent<ColliderComponent>(id, "Collider")!;
        if (
          (health && (health.isDead || health.current <= 0)) ||
          !collider.hurtboxes.length ||
          ![CollisionLayer.PLAYER, CollisionLayer.ENEMY].includes(collider.layer)
        )
          continue;
        this.bodyGrid.insert(id, bodySeparationBounds(this.world, id, this.rectCache));
      }
      let moved = false;
      for (const id1 of movers) {
        const health1 = this.world.getComponent<HealthComponent>(id1, "Health");
        const col1 = this.world.getComponent<ColliderComponent>(id1, "Collider")!;
        if (
          (health1 && (health1.isDead || health1.current <= 0)) ||
          !col1.hurtboxes.length ||
          ![CollisionLayer.PLAYER, CollisionLayer.ENEMY].includes(col1.layer)
        )
          continue;
        const trans1 = this.world.getComponent<TransformComponent>(id1, "Transform")!;
        const physics1 = this.world.getComponent<PhysicsComponent>(id1, "Physics")!;
        const frozen1 = this.world.hasComponent(id1, "HitStop");
        bodySeparationBounds(this.world, id1, this.separationRect1);
        for (const id2 of this.bodyGrid.query(this.separationRect1, this.queryBuffer)) {
          if (id2 <= id1) continue;
          const frozen2 = this.world.hasComponent(id2, "HitStop");
          if (frozen1 && frozen2) continue;
          const trans2 = this.world.getComponent<TransformComponent>(id2, "Transform")!;
          const physics2 = this.world.getComponent<PhysicsComponent>(id2, "Physics")!;
          const r1 = bodySeparationBounds(this.world, id1, this.separationRect1);
          const r2 = bodySeparationBounds(this.world, id2, this.separationRect2);
          if (!aabbIntersects(r1, r2)) continue;
          const direction = trans1.position.x <= trans2.position.x ? -1 : 1;
          const depth = (direction < 0 ? r1.x + r1.width - r2.x : r2.x + r2.width - r1.x) + 0.01;
          const mass1 = actorInertia(this.world, id1),
            mass2 = actorInertia(this.world, id2);
          const share1 = frozen1 ? 0 : frozen2 ? 1 : mass2 / (mass1 + mass2),
            share2 = 1 - share1;
          let push1 = frozen1 ? 0 : this.horizontalRoom(r1, direction * depth * share1);
          let push2 = frozen2 ? 0 : this.horizontalRoom(r2, -direction * depth * share2);
          let remaining = Math.max(0, depth - Math.abs(push1) - Math.abs(push2));
          if (!frozen1) push1 = this.horizontalRoom(r1, push1 + direction * remaining);
          remaining = Math.max(0, depth - Math.abs(push1) - Math.abs(push2));
          if (!frozen2) push2 = this.horizontalRoom(r2, push2 - direction * remaining);
          trans1.position.x += push1;
          trans2.position.x += push2;
          moved ||= push1 !== 0 || push2 !== 0;
          const v1 = frozen1 ? 0 : physics1.velocity.x,
            v2 = frozen2 ? 0 : physics2.velocity.x;
          const closingSpeed = (v1 - v2) * direction;
          if (closingSpeed < 0) {
            // Body pressure stops inward locomotion; it is not a damaging
            // impulse. Transferring it could put an idle recipient into a
            // friction-free walk indefinitely. Preserve motion away instead.
            if (!frozen1) physics1.velocity.x = direction * Math.max(0, v1 * direction);
            if (!frozen2) physics2.velocity.x = -direction * Math.max(0, -v2 * direction);
          }
        }
      }
      dynamicPositionsChanged ||= moved;
      if (!moved) break;
    }

    // --- Pass 2: Environment Collision ---

    for (const moverId of movers) {
      // Check HitStop
      if (this.world.hasComponent(moverId, "HitStop")) continue;

      const transform = this.world.getComponent<TransformComponent>(moverId, "Transform")!;
      const gridX = transform.position.x,
        gridY = transform.position.y;
      const collider = this.world.getComponent<ColliderComponent>(moverId, "Collider")!;
      const physics = this.world.getComponent<PhysicsComponent>(moverId, "Physics")!;
      const state = this.world.getComponent<MovementStateComponent>(moverId, "MovementState")!;
      const health = this.world.getComponent<HealthComponent>(moverId, "Health");

      if (collider.hurtboxes.length === 0) continue;

      const hurtbox = collider.hurtboxes[0];
      const mScaleX = Math.abs(transform.scale.x);
      const mScaleY = transform.scale.y;

      this.entityAABB.x = transform.position.x + hurtbox.x * mScaleX;
      this.entityAABB.y = transform.position.y + hurtbox.y * mScaleY;
      this.entityAABB.width = hurtbox.width * mScaleX;
      this.entityAABB.height = hurtbox.height * mScaleY;

      const previous = physics.previousPosition ?? transform.position;
      const previousBox = {
        ...this.entityAABB,
        x: previous.x + hurtbox.x * mScaleX,
        y: previous.y + hurtbox.y * mScaleY,
      };
      const sweptBox = {
        x: Math.min(previousBox.x, this.entityAABB.x) - 2,
        y: Math.min(previousBox.y, this.entityAABB.y) - 2,
        width: this.entityAABB.width + Math.abs(this.entityAABB.x - previousBox.x) + 4,
        height: this.entityAABB.height + Math.abs(this.entityAABB.y - previousBox.y) + 4,
      };
      // Include surfaces crossed between frames, not just the final overlap.
      const platformIds = grids.staticGrid.query(sweptBox, this.queryBuffer);
      const contactTime = (id: number) => {
        const t = this.world.getComponent<TransformComponent>(id, "Transform");
        const c = this.world.getComponent<ColliderComponent>(id, "Collider");
        const p = this.world.getComponent<PlatformComponent>(id, "Platform");
        if (!t || !c?.hurtboxes[0] || !p || p.collidable === false || p.type === "ladder")
          return Infinity;
        const b = c.hurtboxes[0];
        const box = {
          x: t.position.x + b.x * Math.abs(t.scale.x),
          y: t.position.y + b.y * t.scale.y,
          width: b.width * Math.abs(t.scale.x),
          height: b.height * t.scale.y,
        };
        if (aabbIntersects(previousBox, box)) return 0;
        return this.sweepContact(previousBox, this.entityAABB, box)?.time ?? Infinity;
      };
      // Resolve the first crossed surface before surfaces behind it.
      // Cache only sorting keys: resolution still checks the corrected position.
      if (platformIds.length > 1) {
        this.contactTimes.clear();
        for (const id of platformIds) this.contactTimes.set(id, contactTime(id));
        platformIds.sort((a, b) => this.contactTimes.get(a)! - this.contactTimes.get(b)!);
      }

      for (const platId of platformIds) {
        if (moverId === platId) continue;

        const platTransform = this.world.getComponent<TransformComponent>(platId, "Transform");
        const platCollider = this.world.getComponent<ColliderComponent>(platId, "Collider");
        const platform = this.world.getComponent<PlatformComponent>(platId, "Platform");

        if (!platTransform || !platCollider || !platform || platform.collidable === false) continue;

        const platBox = platCollider.hurtboxes[0];

        const pScaleX = Math.abs(platTransform.scale.x);
        const pScaleY = platTransform.scale.y;

        this.platAABB.x = platTransform.position.x + platBox.x * pScaleX;
        this.platAABB.y = platTransform.position.y + platBox.y * pScaleY;
        this.platAABB.width = platBox.width * pScaleX;
        this.platAABB.height = platBox.height * pScaleY;

        const oldBottom = previousBox.y + previousBox.height;
        const bottom = this.entityAABB.y + this.entityAABB.height;
        const dy = bottom - oldBottom;
        const crossingTime = dy > 0 ? (this.platAABB.y - oldBottom) / dy : -1;
        const crossingX = previousBox.x + (this.entityAABB.x - previousBox.x) * crossingTime;
        if (
          platform.type === "semisolid" &&
          physics.velocity.y >= 0 &&
          !(platform.type === "semisolid" && state.dropThroughTimer > 0) &&
          crossingTime >= 0 &&
          crossingTime <= 1 &&
          crossingX + previousBox.width > this.platAABB.x &&
          crossingX < this.platAABB.x + this.platAABB.width
        ) {
          transform.position.y += this.platAABB.y - bottom;
          this.entityAABB.y = transform.position.y + hurtbox.y * mScaleY;
          physics.velocity.y = 0;
        }
        if (platform.type === "solid" || platform.type === "hazard") {
          this.resolveSweep(previousBox, this.entityAABB, this.platAABB, transform, physics);
        }

        if (aabbIntersects(this.entityAABB, this.platAABB)) {
          if (platform.type === "ladder") continue;

          if (platform.type === "semisolid") {
            if (state.dropThroughTimer > 0) continue;
            if (physics.velocity.y < 0) continue;
            const entityBottom = this.entityAABB.y + this.entityAABB.height;
            const platformTop = this.platAABB.y;
            if (oldBottom > platformTop + 0.01 || entityBottom < platformTop) continue;
          }

          getOverlap(this.entityAABB, this.platAABB, this.overlap);

          const isFalling = physics.velocity.y >= 0;
          const isAbove =
            this.entityAABB.y + this.entityAABB.height - this.overlap.y <= this.platAABB.y + 2;

          if (isAbove && isFalling) {
            transform.position.y -= this.overlap.y;
            physics.velocity.y = 0;
          } else if (platform.type !== "semisolid") {
            if (this.overlap.x < this.overlap.y) {
              if (this.entityAABB.x < this.platAABB.x) {
                transform.position.x -= this.overlap.x;
              } else {
                transform.position.x += this.overlap.x;
              }
              physics.velocity.x = 0;
            } else {
              if (this.entityAABB.y < this.platAABB.y) {
                transform.position.y -= this.overlap.y;
                physics.velocity.y = 0;
              } else {
                transform.position.y += this.overlap.y;
                physics.velocity.y = 0;
              }
            }
          }

          // Update entity AABB for next iteration
          this.entityAABB.x = transform.position.x + hurtbox.x * mScaleX;
          this.entityAABB.y = transform.position.y + hurtbox.y * mScaleY;
        }

        // Check for hazard contact
        if (platform.type === "hazard" && health) {
          // Increase the hazard contact margin slightly to avoid missed overlap
          // during tight solid collision resolution in edge-case setups.
          this.contactAABB.x = this.entityAABB.x - 2;
          this.contactAABB.y = this.entityAABB.y - 2;
          this.contactAABB.width = this.entityAABB.width + 4;
          this.contactAABB.height = this.entityAABB.height + 4;

          if (
            aabbIntersects(this.contactAABB, this.platAABB) &&
            !health.isDead &&
            health.invulnTimer <= 0
          ) {
            let occupants = this.hazardCooldowns.get(platId);
            if (!occupants) this.hazardCooldowns.set(platId, (occupants = new Map()));
            if (!occupants.has(moverId)) {
              applyHealthDamage(this.world, moverId, platform.damage);
              occupants.set(moverId, platform.damageInterval);
            }
          }
        }
      }

      // --- Pass 3: Ground Check ---
      let onGround = false;

      if (physics.velocity.y >= 0 && state.current !== "climb") {
        this.groundCheckAABB.x = this.entityAABB.x + 2;
        this.groundCheckAABB.y = this.entityAABB.y + this.entityAABB.height;
        this.groundCheckAABB.width = this.entityAABB.width - 4;
        this.groundCheckAABB.height = 4;

        const groundCandidates = grids.staticGrid.query(this.groundCheckAABB, this.queryBuffer);

        for (const platId of groundCandidates) {
          if (moverId === platId) continue;

          const platform = this.world.getComponent<PlatformComponent>(platId, "Platform");
          if (!platform || platform.collidable === false) continue;
          if (platform.type === "ladder") continue;
          if (platform.type === "semisolid" && state.dropThroughTimer > 0) continue;

          const platTransform = this.world.getComponent<TransformComponent>(platId, "Transform")!;
          const platCollider = this.world.getComponent<ColliderComponent>(platId, "Collider")!;
          const platBox = platCollider.hurtboxes[0];
          const pScaleX = Math.abs(platTransform.scale.x);
          const pScaleY = platTransform.scale.y;

          this.platAABB.x = platTransform.position.x + platBox.x * pScaleX;
          this.platAABB.y = platTransform.position.y + platBox.y * pScaleY;
          this.platAABB.width = platBox.width * pScaleX;
          this.platAABB.height = platBox.height * pScaleY;

          const dist = this.platAABB.y - (this.entityAABB.y + this.entityAABB.height);
          if (dist >= -0.01 && dist < 4 && aabbIntersects(this.groundCheckAABB, this.platAABB)) {
            onGround = true;
            physics.velocity.y = 0;
            if (Math.abs(dist) < 4.0) {
              transform.position.y += dist;
            }
            break;
          }
        }
      }

      physics.grounded = onGround;
      dynamicPositionsChanged ||= gridX !== transform.position.x || gridY !== transform.position.y;
      const resolvedPosition = (physics.previousPosition ??= { x: 0, y: 0 });
      resolvedPosition.x = transform.position.x;
      resolvedPosition.y = transform.position.y;
    }
    // Separation/terrain resolution can move actors beyond their old cells.
    // Hit detection runs next and must query the corrected positions.
    if (dynamicPositionsChanged) {
      grids.dynamicGrid.clear();
      for (const {
        id,
        components: [t, c],
      } of allCollidables) {
        if (this.world.hasComponent(id, "Platform")) continue;
        const transform = t as TransformComponent,
          collider = c as ColliderComponent;
        const box = collider.hurtboxes[0];
        if (!box) continue;
        const sx = Math.abs(transform.scale.x),
          sy = transform.scale.y;
        this.rectCache.x = transform.position.x + box.x * sx;
        this.rectCache.y = transform.position.y + box.y * sy;
        this.rectCache.width = box.width * sx;
        this.rectCache.height = box.height * sy;
        grids.dynamicGrid.insert(id, this.rectCache);
      }
    }
  }

  private horizontalRoom(body: AABB, movement: number): number {
    if (movement === 0) return 0;
    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);
    const probe = {
      x: body.x + Math.min(0, movement),
      y: body.y + 0.01,
      width: body.width + Math.abs(movement),
      height: Math.max(0, body.height - 0.02),
    };
    let room = Math.abs(movement);
    for (const id of grids.staticGrid.query(probe, this.separationTerrainBuffer)) {
      const platform = this.world.getComponent<PlatformComponent>(id, "Platform");
      const t = this.world.getComponent<TransformComponent>(id, "Transform");
      const b = this.world.getComponent<ColliderComponent>(id, "Collider")?.hurtboxes[0];
      if (
        !platform ||
        platform.collidable === false ||
        (platform.type !== "solid" && platform.type !== "hazard") ||
        !t ||
        !b
      )
        continue;
      const left = t.position.x + b.x * Math.abs(t.scale.x),
        right = left + b.width * Math.abs(t.scale.x);
      const top = t.position.y + b.y * t.scale.y,
        bottom = top + b.height * t.scale.y;
      if (probe.y >= bottom || probe.y + probe.height <= top) continue;
      const distance = movement > 0 ? left - body.x - body.width : body.x - right;
      if (distance >= -0.01) room = Math.min(room, Math.max(0, distance));
    }
    return Math.sign(movement) * room;
  }

  private resolveSweep(
    old: AABB,
    box: AABB,
    platform: AABB,
    transform: TransformComponent,
    physics: PhysicsComponent,
  ) {
    const contact = this.sweepContact(old, box, platform);
    if (!contact) return;
    const dx = box.x - old.x;
    const dy = box.y - old.y;
    if (contact.axis === "x") {
      const x = old.x + dx * contact.time;
      transform.position.x += x - box.x;
      box.x = x;
      physics.velocity.x = 0;
    } else {
      const y = old.y + dy * contact.time;
      transform.position.y += y - box.y;
      box.y = y;
      physics.velocity.y = 0;
    }
  }

  private sweepContact(
    old: AABB,
    box: AABB,
    platform: AABB,
  ): { time: number; axis: "x" | "y" } | null {
    if (aabbIntersects(old, platform)) return null;
    const dx = box.x - old.x;
    const dy = box.y - old.y;
    const entryX =
      dx > 0
        ? (platform.x - old.x - old.width) / dx
        : dx < 0
          ? (platform.x + platform.width - old.x) / dx
          : -Infinity;
    const exitX =
      dx > 0
        ? (platform.x + platform.width - old.x) / dx
        : dx < 0
          ? (platform.x - old.x - old.width) / dx
          : Infinity;
    const entryY =
      dy > 0
        ? (platform.y - old.y - old.height) / dy
        : dy < 0
          ? (platform.y + platform.height - old.y) / dy
          : -Infinity;
    const exitY =
      dy > 0
        ? (platform.y + platform.height - old.y) / dy
        : dy < 0
          ? (platform.y - old.y - old.height) / dy
          : Infinity;
    if (dx === 0 && (old.x + old.width <= platform.x || old.x >= platform.x + platform.width))
      return null;
    if (dy === 0 && (old.y + old.height <= platform.y || old.y >= platform.y + platform.height))
      return null;
    const entry = Math.max(entryX, entryY);
    if (entry < 0 || entry > 1 || entry > Math.min(exitX, exitY)) return null;
    return { time: entry, axis: entryX > entryY ? "x" : "y" };
  }
}
