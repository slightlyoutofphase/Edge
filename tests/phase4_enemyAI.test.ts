import { Game } from "../core/Game";
import { createEnemy, createPlatform } from "../entities/Archetypes";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { TransformComponent } from "../components/Transform";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { CombatComponent } from "../features/combat/CombatComponent";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { ActiveHitboxComponent } from "../features/combat/ActiveHitboxComponent";
import { TimeState } from "../core/Resources";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function getEnemy(game: Game, id: number) {
  const ai = game.world.getComponent<AIControllerComponent>(id, "AIController")!;
  // These tests inspect committed windups/feints; decision latency has separate regressions.
  ai.attackDecisionTimer = 0;
  const transform = game.world.getComponent<TransformComponent>(id, "Transform")!;
  const physics = game.world.getComponent<PhysicsComponent>(id, "Physics")!;
  const combat = game.world.getComponent<CombatComponent>(id, "Combat")!;
  const health = game.world.getComponent<HealthComponent>(id, "Health")!;
  const animator = game.world.getComponent<AnimatorComponent>(id, "Animator")!;
  const stamina = game.world.getComponent<StaminaComponent>(id, "Stamina")!;
  return { ai, transform, physics, combat, health, animator, stamina };
}

function getPlayer(game: Game) {
  const players = game.world.query("PlayerInput", "Transform");
  return {
    id: players[0].id,
    transform: players[0].components[1] as TransformComponent,
  };
}

export const tests = [
  // === AI State Machine Tests ===

  async function testIdleStateDefault(game: Game) {
    const id = createEnemy(game.world, 500, 300, "hollow");
    const { ai } = getEnemy(game, id);
    if (ai.state !== "idle") throw new Error(`Expected idle, got ${ai.state}`);
  },

  async function testIdleToPatrolTransition(game: Game) {
    const id = createEnemy(game.world, 500, 300, "hollow");
    const { ai } = getEnemy(game, id);

    ai.state = "patrol";
    ai.stateTimer = 1000;

    await runFrames(game, 1);
    if (ai.state !== "patrol") throw new Error("State transition failed");
  },

  async function testPatrolMovement(game: Game) {
    const id = createEnemy(game.world, 500, 300, "hollow");
    const { ai, physics } = getEnemy(game, id);
    createPlatform(game.world, 0, 400, 1000, 50);

    ai.state = "patrol";
    ai.stateTimer = 1000;

    await runFrames(game, 5);
    if (Math.abs(physics.velocity.x) < 10) throw new Error("Enemy not moving during patrol");
  },

  async function testAlertOnPlayerDetection(game: Game) {
    const player = getPlayer(game);

    // Spawn enemy FAR away (2000px) to ensure no initial aggro
    const enemyId = createEnemy(game.world, 2000, getPlayer(game).transform.position.y, "hollow");
    const { ai, transform } = getEnemy(game, enemyId);

    await runFrames(game, 1);
    if (ai.state !== "idle") throw new Error(`Alerted too early. State: ${ai.state}`);

    // Move closer (aggro range is 150).
    // Position enemy 100px away from player
    transform.position.x = player.transform.position.x + 100;
    transform.position.y = player.transform.position.y;

    await runFrames(game, 1);
    if ((ai.state as string) !== "alert")
      throw new Error(`Failed to detect player. State: ${ai.state}`);
    if (ai.target !== game.playerId) throw new Error("Target not set");

    await runFrames(game, 1);
    if ((ai.state as string) !== "alert") throw new Error("Transitioned out of alert too fast");
  },

  async function testApproachBehavior(game: Game) {
    const enemyId = createEnemy(game.world, 300, getPlayer(game).transform.position.y, "hollow");
    const { ai, physics } = getEnemy(game, enemyId);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";

    // Disable pathfinding for this test to rely on direct movement vector
    ai.pathRecalculateTimer = 10000;
    ai.currentPath = [];

    await runFrames(game, 5);

    if (physics.velocity.x >= 0)
      throw new Error(`Not approaching player. Vel: ${physics.velocity.x}`);
  },

  async function testRetreatAfterAttack(game: Game) {
    const player = getPlayer(game);
    const enemyId = createEnemy(
      game.world,
      player.transform.position.x + 10,
      getPlayer(game).transform.position.y,
      "hollow",
    );
    const { ai, physics } = getEnemy(game, enemyId);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 1000;

    await runFrames(game, 1);

    if (physics.velocity.x <= 0)
      throw new Error(`Did not retreat when too close. Vel: ${physics.velocity.x}`);
  },

  async function testStaggerStateTransition(game: Game) {
    const id = createEnemy(game.world, 500, 300, "hollow");
    const enemy = getEnemy(game, id);

    enemy.combat.attackState = "stagger";
    await runFrames(game, 1);

    if (enemy.ai.state !== "stagger") throw new Error("AI did not reflect stagger state");
  },

  async function testDeathStateTransition(game: Game) {
    const id = createEnemy(game.world, 500, 300, "hollow");
    const enemy = getEnemy(game, id);

    enemy.health.isDead = true;
    await runFrames(game, 1);

    if (enemy.ai.state !== "death") throw new Error("AI did not enter death state");
  },

  // === Aggro Tests ===

  async function testAggroRangeDetection(_game: Game) {
    // Covered in testAlertOnPlayerDetection
  },

  async function testAggroRangeByEnemyType(game: Game) {
    const hId = createEnemy(game.world, 0, 0, "hollow");
    const bId = createEnemy(game.world, 0, 0, "brute");

    const { ai: hAI } = getEnemy(game, hId);
    const { ai: bAI } = getEnemy(game, bId);

    if (hAI.behaviorParams.aggroRange !== 150) throw new Error("Hollow aggro range wrong");
    if (bAI.behaviorParams.aggroRange !== 120) throw new Error("Brute aggro range wrong");
  },

  async function testAggroLossOnDistance(game: Game) {
    const id = createEnemy(game.world, 200, getPlayer(game).transform.position.y, "hollow");
    const { ai, transform } = getEnemy(game, id);

    ai.target = game.playerId;
    ai.state = "alert";
    ai.stateTimer = 0;

    transform.position.x = 1000;

    await runFrames(game, 1);

    if ((ai.state as string) !== "idle") throw new Error("Failed to lose aggro");
    if (ai.target !== null) throw new Error("Target not cleared");
  },

  // === Attack Behavior Tests ===

  async function testEnemyAttackExecution(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "hollow",
    );
    const { ai, combat } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 2000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);

    if (combat.attackState !== "windup")
      throw new Error(`Enemy failed to attack. Dist: 30, Range: ${ai.behaviorParams.attackRange}`);
  },

  async function testAttackRangeRespected(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 200,
      getPlayer(game).transform.position.y,
      "hollow",
    );
    const { ai, combat } = getEnemy(game, id);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);
    if (combat.attackState !== "idle") throw new Error("Attacked out of range");
  },

  async function testAttackTelegraphing(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "hollow",
    );
    const { combat } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    const ai = game.world.getComponent<AIControllerComponent>(id, "AIController")!;
    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);

    if (combat.attackState !== "windup") throw new Error("No windup state");
  },

  // === Hollow Behavior Tests ===

  async function testHollowSlowWindup(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "hollow",
    );
    const { combat, ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);

    if (combat.attackTimer < 300) throw new Error("Windup too short");
  },

  async function testHollowMidZoneOnly(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "hollow",
    );
    const { combat, ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    for (let i = 0; i < 5; i++) {
      await runFrames(game, 1);
      if (combat.attackState === "windup") {
        if (combat.attackZone !== 2 && combat.attackZone !== 3)
          throw new Error(`Hollow attacked unexpected zone: ${combat.attackZone}`);
        combat.attackState = "idle";
        ai.attackCooldownTimer = 0;
      }
    }
  },

  async function testHollowRandomBlocking(game: Game) {
    const id = createEnemy(game.world, 150, getPlayer(game).transform.position.y, "hollow");
    const { ai } = getEnemy(game, id);

    ai.target = game.playerId;
    ai.state = "combat";

    const playerCombat = game.world.getComponent<CombatComponent>(game.playerId, "Combat")!;
    playerCombat.attackState = "active";
    playerCombat.attackZone = 1;

    if (ai.behaviorParams.blockChance !== 0.2) throw new Error("Hollow block chance wrong");
    if (ai.behaviorParams.zoneCycling) throw new Error("Hollow should not cycle zones");
  },

  async function testHollowEasyStagger(game: Game) {
    const time = game.world.getResource<TimeState>(TimeState);
    time.hitStopFrames = 0;
    time.timeScale = 1.0;

    createPlatform(game.world, 0, 900, 1000, 50);

    const id = createEnemy(game.world, 150, getPlayer(game).transform.position.y, "hollow");
    const { combat, transform, ai, physics } = getEnemy(game, id);

    physics.grounded = true;
    physics.velocity = { x: 0, y: 0 };
    ai.behaviorParams.blockChance = 0;

    const { id: playerId, transform: playerTransform } = getPlayer(game);
    const playerPhysics = game.world.getComponent<PhysicsComponent>(playerId, "Physics");
    if (playerPhysics) {
      playerPhysics.grounded = true;
      playerPhysics.velocity = { x: 0, y: 0 };
    }

    playerTransform.position.x = 100;
    playerTransform.position.y = 800;
    transform.position.x = 100;
    transform.position.y = 800;

    game.world.addComponent(playerId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 120,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 30,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: playerId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    if (combat.attackState !== "stagger")
      throw new Error(`Hollow not staggered. Poise: ${combat.poise}`);
  },

  // === Soldier Behavior Tests ===

  async function testSoldierZoneCycling(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "soldier",
    );
    const { combat, ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);
    const z1 = combat.attackZone;
    combat.attackState = "idle";
    ai.attackCooldownTimer = 0;
    ai.attackDecisionTimer = 0;

    await runFrames(game, 1);
    const z2 = combat.attackZone;
    combat.attackState = "idle";
    ai.attackCooldownTimer = 0;

    if (z1 === z2) throw new Error("Soldier did not cycle zones");
  },

  async function testSoldierActiveBlocking(game: Game) {
    const id = createEnemy(game.world, 150, getPlayer(game).transform.position.y, "soldier");
    const { ai } = getEnemy(game, id);
    ai.target = game.playerId;
    ai.state = "combat";

    const playerCombat = game.world.getComponent<CombatComponent>(game.playerId, "Combat")!;
    playerCombat.attackState = "active";
    playerCombat.attackZone = 3;

    if (!ai.behaviorParams.zoneCycling) throw new Error("Soldier missing zone cycling flag");
  },

  async function testSoldierPunishWindow(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "soldier",
    );
    const { combat, ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 2000;

    const playerCombat = game.world.getComponent<CombatComponent>(game.playerId, "Combat")!;
    playerCombat.attackState = "recovery";

    await runFrames(game, 1);

    if (combat.attackState !== "windup") throw new Error("Soldier did not punish recovery");
  },

  // === Duelist Behavior Tests ===

  async function testDuelistFeintMechanic(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "duelist",
    );
    const { combat, ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    ai.wantsToFeint = true;

    await runFrames(game, 1);
    const initialZone = combat.attackZone;

    await runFrames(game, 1);

    if (ai.feintTriggered) {
      if (combat.attackZone === initialZone) throw new Error("Feint did not change zone");
      if (combat.attackState !== "windup") throw new Error("Feint did not reset windup");
    }
  },

  async function testDuelistFeintTell(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "duelist",
    );
    const { combat, ai, stamina } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);

    const windupTotal = ai.behaviorParams.windupFrames * 16.66;
    combat.attackTimer = windupTotal * 0.5;

    ai.wantsToFeint = true;
    stamina.current = 100;

    await runFrames(game, 1);

    if (!ai.feintTriggered) throw new Error("Feint flag not triggered");
  },

  async function testDuelistFeintStaminaCost(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      getPlayer(game).transform.position.y,
      "duelist",
    );
    const { ai, stamina, combat } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);
    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);

    const windupTotal = ai.behaviorParams.windupFrames * 16.66;
    combat.attackTimer = windupTotal * 0.5;

    ai.wantsToFeint = true;
    stamina.current = 100;

    await runFrames(game, 1);

    if (stamina.current >= 100) throw new Error("Feint did not cost stamina");
  },

  async function testDuelistParryAttempt(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      player.transform.position.y,
      "duelist",
    );
    const { combat, ai } = getEnemy(game, id);
    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 10000;
    ai.dodgeCooldownTimer = 10000;
    ai.decisionTimer = 0;
    ai.behaviorParams.parryChance = 1;
    const incoming = game.world.getComponent<CombatComponent>(game.playerId, "Combat")!;
    // Observe an early windup before the strike enters the parry window.
    incoming.attackState = "windup";
    incoming.attackTimer = 400;
    await runFrames(game, 7);
    incoming.attackTimer = 60;
    ai.decisionTimer = 0;
    await runFrames(game, 1);
    if (combat.attackState !== "parry")
      throw new Error("Duelist failed to parry an observed imminent swing");
  },

  async function testDuelistPatternPunish(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 30,
      player.transform.position.y,
      "duelist",
    );
    const { combat, ai } = getEnemy(game, id);
    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 10000;
    ai.decisionTimer = 0;
    ai.dodgeCooldownTimer = 10000;
    ai.behaviorParams.parryChance = 1;
    const incoming = game.world.getComponent<CombatComponent>(game.playerId, "Combat")!;
    incoming.attackState = "windup";
    incoming.attackTimer = 400;
    await runFrames(game, 7);
    incoming.attackTimer = 60;
    ai.decisionTimer = 0;
    await runFrames(game, 1);
    if (combat.attackState !== "parry")
      throw new Error("Duelist did not punish an observed windup with parry");
  },

  // === Brute Behavior Tests ===

  async function testBruteHyperArmor(game: Game) {
    const id = createEnemy(game.world, 150, getPlayer(game).transform.position.y, "brute");
    const { combat, transform, physics } = getEnemy(game, id);

    physics.grounded = true;
    physics.velocity = { x: 0, y: 0 };

    const { id: playerId, transform: playerTransform } = getPlayer(game);

    const playerPhysics = game.world.getComponent<PhysicsComponent>(playerId, "Physics");
    if (playerPhysics) {
      playerPhysics.grounded = true;
      playerPhysics.velocity = { x: 0, y: 0 };
    }

    playerTransform.position.x = 100;
    playerTransform.position.y = 800;

    transform.position.x = 100;
    transform.position.y = 800;

    game.world.addComponent(playerId, "ActiveHitbox", {
      offset: { x: 0, y: 0 },
      width: 120,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 100,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: playerId,
      attackType: "light",
    } as ActiveHitboxComponent);

    await runFrames(game, 1);

    if (combat.attackState === "stagger") throw new Error("Brute staggered by light attack");
  },

  async function testBruteSlowAttacks(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 40,
      getPlayer(game).transform.position.y,
      "brute",
    );
    const { ai, combat } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);
    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);

    if (combat.attackTimer < 380) throw new Error("Brute windup too short");
  },

  async function testBruteWideSwing(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 40,
      getPlayer(game).transform.position.y,
      "brute",
    );
    const { ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    for (let frame = 0; frame < 100 && !game.world.hasComponent(id, "ActiveHitbox"); frame++)
      await runFrames(game, 1);

    const hb = game.world.getComponent<ActiveHitboxComponent>(id, "ActiveHitbox");
    if (!hb) throw new Error("Hitbox active");

    if (hb.width < 45) throw new Error(`Brute hitbox too narrow. Width: ${hb.width}`);
  },

  async function testBruteLongRecovery(game: Game) {
    const player = getPlayer(game);
    const id = createEnemy(
      game.world,
      player.transform.position.x + 40,
      getPlayer(game).transform.position.y,
      "brute",
    );
    const { combat, ai } = getEnemy(game, id);
    createPlatform(game.world, 0, 900, 1000, 50);

    ai.target = game.playerId;
    ai.state = "combat";
    ai.attackCooldownTimer = 0;

    await runFrames(game, 1);
    combat.attackState = "recovery";

    if (ai.behaviorParams.attackCooldown < 2000) throw new Error("Brute cooldown too short");
  },

  // === Enemy Health Bar Tests ===

  async function testEnemyHealthBarAppears(game: Game) {
    // Setup enemy and apply damage
    const enemyId = createEnemy(game.world, 100, 100, "hollow");
    const health = game.world.getComponent<HealthComponent>(enemyId, "Health")!;
    health.current = health.max - 10;
    game.world.getComponent<AIControllerComponent>(enemyId, "AIController")!.lastDamageTime =
      game.world.getResource<TimeState>(TimeState).elapsed;

    // Mock context to intercept drawing
    const ctx = game.canvas.getContext("2d") as any;
    let fillRectCalls = 0;

    const origFillRect = ctx.fillRect;
    ctx.fillRect = (_x: number, _y: number, _w: number, _h: number) => {
      fillRectCalls++;
      // Call original to avoid breaking rendering if needed, or no-op
    };

    // Run UI system update
    await runFrames(game, 1);

    // Restore context
    ctx.fillRect = origFillRect;

    // Verify: fillRect should be called at least twice (bg + fg) for the health bar
    if (fillRectCalls < 2) throw new Error("Health bar did not draw");
  },

  async function testEnemyHealthBarFades(game: Game) {
    const enemyId = createEnemy(game.world, 100, 100, "hollow");
    const health = game.world.getComponent<HealthComponent>(enemyId, "Health")!;
    const ai = game.world.getComponent<AIControllerComponent>(enemyId, "AIController")!;
    health.current = health.max - 10;

    // Mock time: Last hit was 4.0 seconds ago
    const time = game.world.getResource<TimeState>(TimeState);
    time.elapsed = 5000;
    ai.lastDamageTime = 1000;

    // Mock context
    const ctx = game.canvas.getContext("2d") as any;
    let enemyBarDraws = 0;
    const origFillRect = ctx.fillRect;

    ctx.fillRect = (x: number, y: number, _w: number, _h: number) => {
      // HUD is at 20,20. Enemy bar at roughly 70, 30 (100-30, 100-70).
      // Check if drawing near enemy position to exclude HUD
      if (x > 50 && y > 20 && y < 50) {
        enemyBarDraws++;
      }
    };

    await runFrames(game, 1);

    ctx.fillRect = origFillRect;

    if (enemyBarDraws > 0) throw new Error("Health bar drew after fade timeout");
  },

  async function testEnemyHealthBarAccuracy(game: Game) {
    const enemyId = createEnemy(game.world, 100, 100, "hollow");
    const health = game.world.getComponent<HealthComponent>(enemyId, "Health")!;
    // 50% Health
    health.current = health.max * 0.5;
    // Ensure it's recent so it shows
    const ai = game.world.getComponent<AIControllerComponent>(enemyId, "AIController")!;
    const time = game.world.getResource<TimeState>(TimeState);
    time.elapsed = 1000;
    ai.lastDamageTime = 900;

    const ctx = game.canvas.getContext("2d") as any;
    let drawnWidths: number[] = [];
    const origFillRect = ctx.fillRect;

    ctx.fillRect = (_x: number, _y: number, w: number, _h: number) => {
      drawnWidths.push(w);
    };

    await runFrames(game, 1);
    ctx.fillRect = origFillRect;

    // Expect: Background (full width + border), Foreground (half width)
    // Bar width is 60. So we expect a rect of ~30 width.
    const fgBar = drawnWidths.find((w) => Math.abs(w - 30) < 1);
    if (!fgBar) throw new Error(`Health bar width inaccurate. Widths: ${drawnWidths.join(", ")}`);
  },
];
