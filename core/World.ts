import type {
  ActiveHitboxComponent,
  HitboxSweepComponent,
} from "../features/combat/ActiveHitboxComponent";
import type { AIControllerComponent } from "../features/ai/AIControllerComponent";
import type { AnimatorComponent } from "../features/animation/AnimatorComponent";
import type { CheckpointComponent } from "../components/Checkpoint";
import type { ColliderComponent } from "../components/Collider";
import type { CombatComponent } from "../features/combat/CombatComponent";
import type { EnemyTagComponent } from "../components/EnemyTag";
import type { FactionComponent } from "../components/Faction";
import type { HealthComponent } from "../components/Health";
import type {
  HitFlashComponent,
  VisualEffectComponent,
} from "../features/visuals/VisualEffectComponent";
import type { HitStopComponent } from "../components/HitStop";
import type { InteractableComponent } from "../components/Interactable";
import type { InventoryComponent } from "../components/Inventory";
import type { MovementStateComponent } from "../features/movement/MovementStateComponent";
import type { PhysicsComponent } from "../features/movement/PhysicsComponent";
import type { PlatformComponent } from "../components/Platform";
import type { PlayerInputComponent } from "../components/PlayerInput";
import type { SkeletonComponent } from "../features/animation/SkeletonComponent";
import type { SoundRequestComponent } from "../components/SoundRequest";
import type { SpawnEffectComponent } from "../components/SpawnEffect";
import type { StaminaComponent } from "../components/Stamina";
import type { TransformComponent } from "../components/Transform";
import type { TriggerComponent } from "../components/Trigger";
import type { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";

export type EntityId = number;

export interface ComponentRegistry {
  ActiveHitbox: ActiveHitboxComponent;
  AIController: AIControllerComponent;
  Animator: AnimatorComponent;
  Checkpoint: CheckpointComponent;
  Collider: ColliderComponent;
  Combat: CombatComponent;
  EnemyTag: EnemyTagComponent;
  Faction: FactionComponent;
  Health: HealthComponent;
  HitboxSweep: HitboxSweepComponent;
  HitFlash: HitFlashComponent;
  HitStop: HitStopComponent;
  Interactable: InteractableComponent;
  Inventory: InventoryComponent;
  MovementState: MovementStateComponent;
  Physics: PhysicsComponent;
  Platform: PlatformComponent;
  PlayerInput: PlayerInputComponent;
  Skeleton: SkeletonComponent;
  SoundRequest: SoundRequestComponent;
  SpawnEffect: SpawnEffectComponent;
  Stamina: StaminaComponent;
  Transform: TransformComponent;
  Trigger: TriggerComponent;
  VisualEffect: VisualEffectComponent;
  WeaponTrail: WeaponTrailComponent;
}

type QueryComponents<Names extends readonly string[]> = {
  [K in keyof Names]: Names[K] extends keyof ComponentRegistry ? ComponentRegistry[Names[K]] : any;
};

// Component Maps
// We use a simple map of Map<EntityId, Component> for each component type
export class World {
  private nextEntityId = 1;
  private entities: Set<EntityId> = new Set();
  private components: Map<string, Map<EntityId, any>> = new Map();
  private resources: Map<any, any> = new Map();
  private destroyListeners: Set<(id: EntityId) => void> = new Set();

  // Pool for recycled IDs
  private reclaimedIds: EntityId[] = [];

  // Query Cache
  // Map<Signature, CachedResult>
  private queryCache: Map<string, Array<{ id: EntityId; components: any[] }>> = new Map();
  private queryDependencies = new Map<string, Set<string>>();

  private invalidateQueries(name: string) {
    const signatures = this.queryDependencies.get(name);
    if (signatures) for (const signature of signatures) this.queryCache.delete(signature);
  }

  onEntityDestroy(listener: (id: EntityId) => void): () => void {
    this.destroyListeners.add(listener);
    return () => {
      this.destroyListeners.delete(listener);
    };
  }

  createEntity(): EntityId {
    let id: EntityId;
    if (this.reclaimedIds.length > 0) {
      id = this.reclaimedIds.pop()!;
    } else {
      id = this.nextEntityId++;
    }
    this.entities.add(id);
    // Creating an entity doesn't change query results (no components yet)
    return id;
  }

  destroyEntity(id: EntityId) {
    if (!this.entities.has(id)) return; // Already destroyed

    for (const listener of this.destroyListeners) {
      listener(id);
    }

    this.entities.delete(id);
    for (const [name, map] of this.components) {
      if (map.delete(id)) this.invalidateQueries(name);
    }

    // Recycle ID
    this.reclaimedIds.push(id);
  }

  addComponent<T>(id: EntityId, name: string, data: T) {
    if (!this.components.has(name)) {
      this.components.set(name, new Map());
    }
    const map = this.components.get(name)!;
    if (map.has(id) && map.get(id) === data) return;
    map.set(id, data);
    this.invalidateQueries(name);
  }

  removeComponent(id: EntityId, name: string) {
    if (this.components.get(name)?.delete(id)) this.invalidateQueries(name);
  }

  getComponent<T>(id: EntityId, name: string): T | undefined {
    return this.components.get(name)?.get(id);
  }

  hasComponent(id: EntityId, name: string): boolean {
    return this.components.get(name)?.has(id) ?? false;
  }

  isEmptyEntity(id: EntityId): boolean {
    if (!this.entities.has(id)) return false;
    for (const map of this.components.values()) {
      if (map.has(id)) return false;
    }
    return true;
  }

  // Simple query: returns entities that have ALL specified components
  query<const Names extends readonly string[]>(
    ...names: Names
  ): ReadonlyArray<{ readonly id: EntityId; readonly components: QueryComponents<Names> }> {
    // 1. Generate Signature
    // DO NOT SORT. The order of components in the result must match the order of arguments.
    // Different order = different signature.
    const signature = names.join("|");

    // 2. Check Cache
    if (this.queryCache.has(signature)) {
      return this.queryCache.get(signature)! as ReadonlyArray<{
        readonly id: EntityId;
        readonly components: QueryComponents<Names>;
      }>;
    }

    // Keep argument order and snapshot results; only their dependencies change.
    for (const name of names) {
      let signatures = this.queryDependencies.get(name);
      if (!signatures) this.queryDependencies.set(name, (signatures = new Set()));
      signatures.add(signature);
    }

    // 3. Perform Query (Cache Miss)
    const results: Array<{ id: EntityId; components: any[] }> = [];

    // Find component map with fewest entities to iterate efficiently
    // Note: If any component type is missing from the world, the intersection is empty.
    let smallestMap: Map<EntityId, any> | undefined;
    let smallestSize = Infinity;

    let missingComponent = false;
    for (const name of names) {
      const map = this.components.get(name);
      if (!map) {
        missingComponent = true;
        break;
      }
      if (map.size < smallestSize) {
        smallestSize = map.size;
        smallestMap = map;
      }
    }

    if (missingComponent || !smallestMap) {
      // Cache empty result
      this.queryCache.set(signature, results);
      return results as ReadonlyArray<{
        readonly id: EntityId;
        readonly components: QueryComponents<Names>;
      }>;
    }

    for (const [id, _] of smallestMap) {
      let hasAll = true;
      const entityComponents = [];

      for (const name of names) {
        const comp = this.getComponent(id, name);
        if (!comp) {
          hasAll = false;
          break;
        }
        entityComponents.push(comp);
      }

      if (hasAll) {
        results.push({ id, components: entityComponents });
      }
    }

    // 4. Cache Result
    this.queryCache.set(signature, results);
    return results as ReadonlyArray<{
      readonly id: EntityId;
      readonly components: QueryComponents<Names>;
    }>;
  }

  setResource<T>(key: any, value: T) {
    this.resources.set(key, value);
  }

  getResource<T>(key: any): T {
    return this.resources.get(key);
  }

  // Helper for testing
  getAllEntities(): EntityId[] {
    return Array.from(this.entities);
  }
}
