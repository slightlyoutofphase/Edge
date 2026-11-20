import { Game } from "../core/Game";
import { createPlayer, createDummy, createEnemy } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { Matrix2D } from "../utils/Matrix2D";
import { WEAPONS } from "../data/WeaponDefinitions";
import { ENEMY_STATS } from "../data/EnemyStats";
import { HealthComponent } from "../components/Health";
import { TimeState, InputState } from "../core/Resources";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}
function releaseKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keyup", { code }));
}

export const tests = [
  // === Entity Separation Tests ===
  async function testEntitySeparation(game: Game) {
    // Create two entities at identical positions
    const id1 = createPlayer(game.world, 100, 100);
    const id2 = createPlayer(game.world, 100, 100);

    // Remove gravity/movement input so only separation force acts
    const phys1 = game.world.getComponent<any>(id1, "Physics");
    const phys2 = game.world.getComponent<any>(id2, "Physics");
    phys1.velocity = { x: 0, y: 0 };
    phys2.velocity = { x: 0, y: 0 };

    // Disable movement state friction/gravity
    const state1 = game.world.getComponent<any>(id1, "MovementState");
    state1.current = "idle"; // Friction applies in idle, but separation is forced pos change

    await runFrames(game, 5);

    const t1 = game.world.getComponent<TransformComponent>(id1, "Transform")!;
    const t2 = game.world.getComponent<TransformComponent>(id2, "Transform")!;

    // They should have pushed apart horizontally
    const dist = Math.abs(t1.position.x - t2.position.x);

    // Separation speed 200px/s * 0.016s * 5 frames = ~16px total separation (split between two)
    if (dist < 1.0) throw new Error(`Entities did not separate. Dist: ${dist}`);
  },

  // === Bone Attached Hitbox Tests ===
  async function testBoneAttachedHitbox(game: Game) {
    const playerId = createPlayer(game.world, 0, 0);
    const skeleton = game.world.getComponent<SkeletonComponent>(playerId, "Skeleton")!;

    // Manually inject a world transform for the 'weapon' bone to simulate animation
    // Translate to (100, 0) in world space
    const weaponMatrix = new Matrix2D().translate(100, 0);
    skeleton.worldTransforms.set("weapon", weaponMatrix);

    // Add a hitbox attached to this bone
    // Offset 0 relative to bone -> World 100,0
    game.world.addComponent(playerId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 20,
      height: 20,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: playerId,
      attackType: "light",
      attachedToBone: "weapon",
    } as ActiveHitboxComponent);

    // Create a dummy target at the expected world location (100, 0)
    const dummyId = createDummy(game.world, 100, 0);
    const health = game.world.getComponent<HealthComponent>(dummyId, "Health")!;
    const startHp = health.current;

    // FIX: Ensure TimeState.delta is non-zero so HitDetectionSystem runs
    const time = game.world.getResource<TimeState>(TimeState);
    time.delta = 16;

    // 3. Manually invoke systems
    // Need to run CollisionSystem (to populate grid), HitDetection (to push event) AND DamageSystem (to process event)
    const colSys = game.systems.find((s) => s.constructor.name === "CollisionSystem");
    const hitSys = game.systems.find((s) => s.constructor.name === "HitDetectionSystem");
    const dmgSys = game.systems.find((s) => s.constructor.name === "DamageSystem");

    if (colSys && hitSys && dmgSys) {
      (colSys as any).update();
      (hitSys as any).update();
      (dmgSys as any).update();
    } else {
      throw new Error("Systems not found");
    }

    if (health.current >= startHp)
      throw new Error("Bone-attached hitbox failed to hit target at bone position");
  },

  // === Data Integrity Tests ===
  async function testWeaponReachMetadata(_game: Game) {
    // Verify visual shortening is reflected in metadata
    if (WEAPONS["longsword"].reach > 30)
      throw new Error(
        `Longsword reach not updated. Got ${WEAPONS["longsword"].reach}, expected <= 30`,
      );
    if (WEAPONS["rapier"].reach > 40)
      throw new Error(`Rapier reach not updated. Got ${WEAPONS["rapier"].reach}, expected <= 40`);
  },

  async function testEnemyAttackRanges(_game: Game) {
    // Verify AI behavior stats match shorter weapons
    if (ENEMY_STATS["hollow"].attackRange > 50)
      throw new Error(`Hollow range too long. Got ${ENEMY_STATS["hollow"].attackRange}`);
    if (ENEMY_STATS["soldier"].attackRange > 60)
      throw new Error(`Soldier range too long. Got ${ENEMY_STATS["soldier"].attackRange}`);
  },

  // === New Bug Fix Tests ===

  // Test for: "Enemies no longer die when out of health"
  async function testEnemyDeathStateOverride(game: Game) {
    const enemyId = createEnemy(game.world, 0, 0, "hollow");
    const health = game.world.getComponent<HealthComponent>(enemyId, "Health")!;
    const ai = game.world.getComponent<AIControllerComponent>(enemyId, "AIController")!;
    const animator = game.world.getComponent<AnimatorComponent>(enemyId, "Animator")!;

    // 1. Kill the enemy
    health.current = 0;
    health.isDead = true;

    // 2. Run one frame (AI System should set state to 'death')
    await runFrames(game, 1);

    if (ai.state !== "death") throw new Error(`AI state not death after health=0. Got ${ai.state}`);
    if (animator.currentAnim !== "death")
      throw new Error(`Animator state not death after AI update. Got ${animator.currentAnim}`);

    // 3. Simulate movement (which shouldn't happen if dead, but just in case physics drifting)
    // Also verify AnimationSystem doesn't override it with 'idle'
    await runFrames(game, 1);

    if (animator.currentAnim !== "death")
      throw new Error(`AnimationSystem overrode death animation. Got ${animator.currentAnim}`);
  },

  // Test for: "Character wouldn't stop walking when no keys were pressed"
  async function testPlayerMovementStop(game: Game) {
    const playerId = createPlayer(game.world, 0, 0);
    const physics = game.world.getComponent<PhysicsComponent>(playerId, "Physics")!;

    // 1. Start moving
    pressKey("KeyD");
    await runFrames(game, 10);

    if (physics.velocity.x <= 0) throw new Error("Player failed to start moving");

    // 2. Stop input
    releaseKey("KeyD");
    const input = game.world.getResource<InputState>(InputState);
    input.keysDown.clear(); // Ensure input is clear manually for test robustness

    // 3. Run one frame. Velocity should zero out instantly (snappy movement)
    await runFrames(game, 1);

    if (Math.abs(physics.velocity.x) > 1)
      throw new Error(`Player velocity did not stop. Got ${physics.velocity.x}`);
  },
];
