import { Game } from "../core/Game";
import { AssetLoader } from "../assets/AssetLoader";
import { BattleState, TimeState } from "../core/Resources";
import { createEnemy, createPlatform } from "../entities/Archetypes";
import { CombatComponent } from "../features/combat/CombatComponent";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { HellhoundStrategy } from "../features/ai/HellhoundStrategy";
import { CombatDirectorSystem } from "../features/ai/CombatDirectorSystem";
import { AISystem } from "../features/ai/AISystem";
import { TransformComponent } from "../components/Transform";
import { HealthComponent } from "../components/Health";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { StaminaComponent } from "../components/Stamina";
import { FactionComponent } from "../components/Faction";
import { ColliderComponent } from "../components/Collider";
import { EnemyTagComponent } from "../components/EnemyTag";
import { beginAnimation } from "../features/animation/AnimationTransition";
import { canAttackTarget } from "../features/ai/CombatReach";
import { EffectSystem } from "../systems/EffectSystem";
import { VisualEffectComponent } from "../features/visuals/VisualEffectComponent";
import { quadrupeds } from "./quadruped_rig.test";

function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function near(a: number, b: number, label: string) {
  expect(Math.abs(a - b) < 0.01, `${label}: ${a} != ${b}`);
}
function withRandom<T>(value: number, action: () => T): T {
  const original = Math.random;
  try {
    Math.random = () => value;
    return action();
  } finally {
    Math.random = original;
  }
}
function battleFixture(
  game: Game,
  skin: (typeof quadrupeds)[number],
  distance = 24,
  facing: 1 | -1 = 1,
) {
  game.startBattle(skin, "none", "soldier", "none");
  const world = game.world;
  const actors = world.query("EnemyTag", "Faction");
  const id = actors.find((e) => (e.components[1] as FactionComponent).team === 3)!.id;
  const target = actors.find((e) => (e.components[1] as FactionComponent).team === 4)!.id;
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  Object.assign(transform, { position: { x: 500, y: 704 }, facing });
  world.getComponent<TransformComponent>(target, "Transform")!.position = {
    x: 500 + distance * facing,
    y: 704,
  };
  for (const actor of [id, target]) {
    world.getComponent<PhysicsComponent>(actor, "Physics")!.grounded = true;
    world.getComponent<PhysicsComponent>(actor, "Physics")!.velocity = { x: 0, y: 0 };
  }
  const ai = world.getComponent<AIControllerComponent>(id, "AIController")!;
  Object.assign(ai, {
    target,
    state: "combat",
    hasAttackToken: true,
    flankTimer: 10000,
    decisionTimer: 10000,
    attackCooldownTimer: 0,
    hellhoundDecisionTimer: 0,
  });
  return {
    world,
    id,
    target,
    transform,
    ai,
    combat: world.getComponent<CombatComponent>(id, "Combat")!,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
    physics: world.getComponent<PhysicsComponent>(id, "Physics")!,
    stamina: world.getComponent<StaminaComponent>(id, "Stamina")!,
    targetHealth: world.getComponent<HealthComponent>(target, "Health")!,
    strategy: new HellhoundStrategy(skin === "alpha_hellhound"),
  };
}
function forceAttack(a: ReturnType<typeof battleFixture>, name: string) {
  for (const id of [a.id, a.target]) a.world.removeComponent(id, "AIController");
  a.targetHealth.current = a.targetHealth.max = 250;
  const clip = AssetLoader.getAnimation(name)!;
  Object.assign(a.combat, {
    attackState: "windup",
    attackType: name.startsWith("alpha") ? "heavy" : "light",
    isHeavyAttack: name.startsWith("alpha"),
    attackTimer: clip.windupMs,
    attackZone: clip.zone,
    isBlocking: false,
    attackTiming: undefined,
  });
  beginAnimation(a.animator, name);
  return clip;
}
const cases = [
  ["hellhound", "hellhound_light_attack_low", 24],
  ["hellhound", "hellhound_light_attack_mid", 28],
  ["hellhound", "hellhound_light_attack_high", 58],
  ["alpha_hellhound", "alpha_hellhound_heavy_attack_low", 84],
  ["alpha_hellhound", "alpha_hellhound_heavy_attack_mid", 95],
  ["alpha_hellhound", "alpha_hellhound_heavy_attack_high", 160],
  ["alpha_hellhound", "alpha_hellhound_special_attack_maul", 168],
  ["alpha_hellhound", "alpha_hellhound_special_attack_slam", 110],
] as const;

function contactsAt(game: Game, fps: number) {
  for (const [skin, name, distance] of cases)
    for (const facing of [1, -1] as const) {
      const a = battleFixture(game, skin, distance, facing);
      forceAttack(a, name);
      let wasAirborne = false,
        minY = 700;
      for (let frame = 0; frame < fps * 4; frame++) {
        game.update(1000 / fps);
        minY = Math.min(minY, a.transform.position.y);
        wasAirborne ||= !a.physics.grounded;
        if (a.combat.attackState === "idle" && frame > 10) break;
      }
      expect(
        a.targetHealth.current < 250,
        `${name} at ${fps}fps facing ${facing} missed at ${distance}; target ${a.world.getComponent<TransformComponent>(a.target, "Transform")!.position.x}, attacker ${a.transform.position.x}`,
      );
      if (name.endsWith("_high"))
        expect(wasAirborne && minY < 685, "High bite never left the floor");
      expect(
        !a.world.hasComponent(a.id, "ActiveHitbox"),
        "Attack leaked its hitbox after recovery",
      );
    }
}

export const tests = [
  async function testAISelectedCreatureAttacksReachAtCloseAndFarDecisionBoundaries(game: Game) {
    for (const skin of quadrupeds)
      for (const distance of skin === "hellhound" ? [24, 32, 34, 62] : [80, 105, 115, 175])
        for (const index of [0, 1, 2]) {
          const a = battleFixture(game, skin, distance);
          a.ai.currentComboIndex = index;
          a.ai.bossSpecialReadyAt = Infinity;
          withRandom([0.1, 0.6, 0.99][index], () => a.strategy.update(0, a.id, a.world));
          a.world.removeComponent(a.target, "AIController");
          a.targetHealth.current = a.targetHealth.max = 250;
          // A selected move may first close a small remaining gap and brake.
          for (let frame = 0; frame < 60 && a.combat.attackState === "idle"; frame++)
            game.update(1000 / 60);
          const name = a.animator.currentAnim;
          expect(
            a.combat.attackState === "windup",
            `Creature never committed its selected move at ${distance}`,
          );
          a.ai.attackCooldownTimer = 10000;
          for (let frame = 0; frame < 210; frame++) game.update(1000 / 60);
          expect(
            a.targetHealth.current < 250,
            `AI chose ${name} outside its usable reach at ${distance}`,
          );
        }
  },
  async function testAlphaShockwaveRemainsAGroundEffectRatherThanBecomingASpark(game: Game) {
    const world = game.world,
      id = world.createEntity();
    world.addComponent(id, "SpawnEffect", {
      type: "hellhound-shockwave",
      position: { x: 400, y: 704 },
      direction: { x: 0, y: 0 },
      scale: 2,
    });
    const time = world.getResource<TimeState>(TimeState);
    time.delta = 16;
    new EffectSystem(world).update();
    const effects = world
      .query("VisualEffect")
      .map((e) => e.components[0] as VisualEffectComponent);
    const ring = effects.find((e) => e.type === "hellhound-shockwave");
    expect(
      !!ring && ring.rotation === 0 && ring.velocity.x === 0 && ring.velocity.y === 0,
      "Slam ring became a drifting particle",
    );
    near(ring!.position.y, 704, "Shockwave ground anchor");
  },
  async function testAllHellhoundAttacksDamageTargetsAt30FpsBothFacings(game: Game) {
    contactsAt(game, 30);
  },
  async function testAllHellhoundAttacksDamageTargetsAt60FpsBothFacings(game: Game) {
    contactsAt(game, 60);
  },
  async function testAllHellhoundAttacksDamageTargetsAt120FpsBothFacings(game: Game) {
    contactsAt(game, 120);
  },
  async function testHellhoundOrdinaryAIUsesAllRequestedAttackZonesWithoutAFixedCycle(game: Game) {
    const a = battleFixture(game, "hellhound", 24);
    for (const [roll, zone] of [
      [0.1, 3],
      [0.6, 2],
      [0.99, 1],
    ] as const) {
      a.ai.currentComboIndex = 0;
      a.ai.attackCooldownTimer = 0;
      a.ai.hellhoundDecisionTimer = 0;
      a.ai.lastHellhoundAttackZone = undefined;
      a.combat.attackState = "idle";
      a.stamina.current = 100;
      withRandom(roll, () => a.strategy.update(0, a.id, a.world));
      expect(
        a.combat.attackZone === zone && (a.combat.attackState as string) === "windup",
        "Hellhound AI skipped a requested category",
      );
      expect(
        a.animator.currentAnim ===
          `hellhound_light_attack_${zone === 3 ? "low" : zone === 2 ? "mid" : "high"}`,
        "AI selected a humanoid attack",
      );
    }
  },
  async function testHellhoundUsesPounceToCloseTheGapRatherThanWhiffingAStationaryBite(game: Game) {
    const a = battleFixture(game, "hellhound", 58);
    a.strategy.update(0, a.id, a.world);
    expect(
      a.animator.currentAnim === "hellhound_light_attack_high",
      "Distant target did not provoke a pounce",
    );
  },
  async function testHellhoundDoesNotStartAnotherAttackWhileAirborne(game: Game) {
    const a = battleFixture(game, "hellhound", 24);
    a.physics.grounded = false;
    a.strategy.update(0, a.id, a.world);
    expect(a.combat.attackState === "idle", "Airborne dog initiated a grounded strike");
  },
  async function testCreatureDecisionsWaitOnceInRangeAndAreIndependentPerInstance(game: Game) {
    for (const skin of quadrupeds) {
      const a = battleFixture(game, skin, 24);
      a.ai.hellhoundDecisionTimer = undefined;
      withRandom(0, () => a.strategy.update(0, a.id, a.world));
      expect(
        a.combat.attackState === "idle" && a.ai.hellhoundDecisionTimer === 80,
        "Creature ignored its initial reaction time",
      );
      withRandom(0.99, () => a.strategy.update(16, a.id, a.world));
      near(a.ai.hellhoundDecisionTimer!, 64, "Decision delay was resampled each frame");
      a.world.getComponent<TransformComponent>(a.target, "Transform")!.position.x = 900;
      a.strategy.update(16, a.id, a.world);
      expect(
        a.ai.hellhoundDecisionTimer === undefined,
        "Reaction time expired during a long approach",
      );
      a.world.getComponent<TransformComponent>(a.target, "Transform")!.position.x = 524;
      withRandom(0.99, () => a.strategy.update(0, a.id, a.world));
      expect(
        a.ai.hellhoundDecisionTimer! > 230 && a.combat.attackState === "idle",
        "Returning to range skipped a fresh decision",
      );
      withRandom(0, () => a.strategy.update(240, a.id, a.world));
      expect(
        (a.combat.attackState as string) === "windup",
        "Reaction delay prevented an otherwise valid attack",
      );
    }
  },
  async function testCreatureCooldownVariesWithoutChangingBaseStatsAndRecentMovesAreLessLikely(
    game: Game,
  ) {
    for (const skin of quadrupeds) {
      const a = battleFixture(game, skin, 24),
        base = a.ai.behaviorParams.attackCooldown;
      a.ai.bossSpecialReadyAt = Infinity;
      withRandom(0.3, () => a.strategy.update(0, a.id, a.world));
      expect(a.combat.attackZone === 3, "Fresh close decision did not allow a bite");
      near(a.ai.behaviorParams.attackCooldown, base, "Random cooldown mutated archetype stats");
      expect(
        a.ai.attackCooldownTimer >= base * 0.75 && a.ai.attackCooldownTimer <= base * 1.25,
        "Cooldown variation exceeds its bounds",
      );
      const first = a.ai.attackCooldownTimer;
      a.combat.attackState = "idle";
      a.ai.attackCooldownTimer = 0;
      a.ai.hellhoundDecisionTimer = 0;
      a.stamina.current = 100;
      withRandom(0.3, () => a.strategy.update(0, a.id, a.world));
      expect(
        (a.combat.attackZone as number) === 2,
        "Recent bite retained its full selection weight",
      );
      a.combat.attackState = "idle";
      a.ai.attackCooldownTimer = 0;
      a.ai.hellhoundDecisionTimer = 0;
      a.stamina.current = 100;
      withRandom(0.9, () => a.strategy.update(0, a.id, a.world));
      expect(a.ai.attackCooldownTimer !== first, "Cooldown remains identical for every decision");
    }
  },
  async function testCreatureLocomotionSelectsRunAtItsOwnBodyScale(game: Game) {
    for (const skin of quadrupeds) {
      const a = battleFixture(game, skin, 24);
      a.ai.state = "idle";
      a.ai.decisionTimer = 10000;
      a.physics.velocity.x = 120;
      a.world.getResource<TimeState>(TimeState).delta = 0;
      new AISystem(a.world).update();
      expect(
        a.world.getComponent<MovementStateComponent>(a.id, "MovementState")!.current ===
          (skin === "hellhound" ? "run" : "walk"),
        "Creature uses humanoid gait thresholds",
      );
      near(a.physics.velocity.x, 120, "Gait selection changed locomotion speed");
    }
  },
  async function testNormalArenaMirrorOpponentsDoNotKeepIdenticalAttackSchedules(game: Game) {
    const original = Math.random;
    try {
      for (const seed of [7, 23, 41, 67, 91])
        for (const skin of quadrupeds) {
          let state = seed;
          Math.random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
          game.startBattle(skin, "none", skin, "none");
          const actors = game.world.query("AIController", "EnemyTag");
          const schedules: { frame: number; name: string }[][] = [[], []],
            previous = [0, 0];
          const battle = game.world.getResource<BattleState>(BattleState);
          for (let frame = 0; frame < 9000 && !battle.winner; frame++) {
            game.update(1000 / 60);
            actors.forEach((e, i) => {
              const serial =
                game.world.getComponent<CombatComponent>(e.id, "Combat")!.attackSerial ?? 0;
              if (serial !== previous[i])
                schedules[i].push({
                  frame,
                  name: game.world.getComponent<AnimatorComponent>(e.id, "Animator")!.currentAnim,
                });
              previous[i] = serial;
            });
          }
          expect(!!battle.winner, `${skin} mirror stalled after adding decision variation`);
          expect(
            schedules.every((s) => s.length > 0),
            `${skin} mirror opponent never attacked (seed ${seed})`,
          );
          expect(
            JSON.stringify(schedules[0]) !== JSON.stringify(schedules[1]),
            `${skin} decisions remained mirrored for seed ${seed}`,
          );
        }
    } finally {
      Math.random = original;
    }
  },
  async function testAlphaAlternatesMaulAndSlamWithIndependentSpecialCooldown(game: Game) {
    const a = battleFixture(game, "alpha_hellhound", 140);
    a.strategy.update(0, a.id, a.world);
    expect(
      a.animator.currentAnim === "alpha_hellhound_special_attack_maul",
      "Alpha lacks its approach special",
    );
    const ready = a.ai.bossSpecialReadyAt!;
    expect(ready > 0, "Special did not establish a cooldown");
    a.world.getComponent<TransformComponent>(a.target, "Transform")!.position.x = 600;
    a.combat.attackState = "idle";
    a.ai.attackCooldownTimer = 0;
    a.ai.hellhoundDecisionTimer = 0;
    a.stamina.current = 100;
    a.ai.currentComboIndex = 2;
    // Pick a reachable ordinary pounce; a short bite can legitimately need
    // to reposition before committing against the new posed hurt geometry.
    withRandom(0.99, () => a.strategy.update(0, a.id, a.world));
    expect(!a.animator.currentAnim.includes("special"), "Alpha ignored its special cooldown");
    expect(
      a.ai.bossSpecialReadyAt === ready,
      "An ordinary attack changed the independent special cooldown",
    );
    a.world.getResource<TimeState>(TimeState).elapsed = ready;
    a.combat.attackState = "idle";
    a.ai.attackCooldownTimer = 0;
    a.ai.hellhoundDecisionTimer = 0;
    a.ai.currentComboIndex = 2;
    a.stamina.current = 100;
    withRandom(0, () => a.strategy.update(0, a.id, a.world));
    expect(
      a.animator.currentAnim === "alpha_hellhound_special_attack_slam",
      "Alpha never selected the distinct close special",
    );
  },
  async function testAlphaRagePhaseOccursOnceAndDoesNotMutateOtherInstances(game: Game) {
    const a = battleFixture(game, "alpha_hellhound", 80),
      other = createEnemy(a.world, 900, 700, "alpha_hellhound");
    const original = a.ai.behaviorParams.attackCooldown;
    a.world.getComponent<HealthComponent>(a.id, "Health")!.current = 300;
    a.strategy.update(0, a.id, a.world);
    expect(
      a.ai.currentPhase === 1 && a.combat.attackState === "stagger",
      "Alpha did not telegraph its phase change",
    );
    near(a.ai.behaviorParams.attackCooldown, original * 0.8, "Phase cooldown");
    near(
      a.world.getComponent<AIControllerComponent>(other, "AIController")!.behaviorParams
        .attackCooldown,
      original,
      "Other Alpha changed",
    );
    a.combat.attackState = "idle";
    a.ai.state = "combat";
    a.strategy.update(0, a.id, a.world);
    near(a.ai.behaviorParams.attackCooldown, original * 0.8, "Repeated phase scaling");
  },
  async function testCreatureRetreatNeverUsesHumanoidGuardAndRecoversStamina(game: Game) {
    const a = battleFixture(game, "hellhound", 24);
    a.stamina.current = 10;
    a.strategy.update(16, a.id, a.world);
    expect(a.ai.state === "retreat", "Tired hellhound did not disengage");
    a.strategy.update(16, a.id, a.world);
    expect(!a.combat.isBlocking, "Creature entered a humanoid guard");
    a.world.removeComponent(a.target, "AIController");
    for (let frame = 0; frame < 360; frame++) game.update(1000 / 60);
    expect(a.stamina.current > 20, "Creature remained stuck in an exhausted retreat");
  },
  async function testDirectorAndCreatureStrategyPermitAClearPounceOverLowCover(game: Game) {
    const a = battleFixture(game, "hellhound", 58);
    createPlatform(a.world, 530, 682, 8, 18, "solid");
    expect(
      canAttackTarget(
        a.world,
        a.transform,
        a.world.getComponent<TransformComponent>(a.target, "Transform")!,
        a.id,
      ),
      "A bite-only probe rejected a physically clear pounce",
    );
    a.ai.hasAttackToken = false;
    new CombatDirectorSystem(a.world).update();
    expect(a.ai.hasAttackToken, "Director rejected the usable arcing attack");
    a.strategy.update(16, a.id, a.world);
    expect(
      a.combat.attackState === "windup" && a.animator.currentAnim.endsWith("_high"),
      "Creature chose a ground bite instead of clearing the cover",
    );
    a.world.removeComponent(a.target, "AIController");
    a.targetHealth.current = a.targetHealth.max = 250;
    for (let frame = 0; frame < 210; frame++) game.update(1000 / 60);
    expect(
      a.targetHealth.current < 250,
      "The permitted pounce failed to clear low cover and reach the opponent",
    );
  },
  async function testChargeUsesWorldCollisionRatherThanPassingThroughAWall(game: Game) {
    const a = battleFixture(game, "alpha_hellhound", 300);
    forceAttack(a, "alpha_hellhound_special_attack_maul");
    createPlatform(a.world, 600, 500, 24, 200, "solid");
    for (let frame = 0; frame < 150; frame++) game.update(1000 / 60);
    const box = a.world.getComponent<ColliderComponent>(a.id, "Collider")!.hurtboxes[0];
    expect(
      a.transform.position.x + (box.x + box.width) * a.transform.scale.x <= 600.1,
      "Charge tunneled through a wall",
    );
    near(a.transform.position.y, 704, "Charge lifted off floor");
  },
  async function testPounceLaunchesOnceAndHitstopFreezesItsMotion(game: Game) {
    const a = battleFixture(game, "hellhound", 58);
    forceAttack(a, "hellhound_light_attack_high");
    for (let frame = 0; frame < 40 && a.physics.grounded; frame++) game.update(1000 / 60);
    expect(!a.physics.grounded, "Pounce did not launch");
    const position = { ...a.transform.position };
    a.world.addComponent(a.id, "HitStop", { frames: 6 });
    game.update(1000 / 60);
    near(a.transform.position.x, position.x, "Hitstop x");
    near(a.transform.position.y, position.y, "Hitstop y");
    let launches = 1,
      wasGrounded = false;
    for (let frame = 0; frame < 130; frame++) {
      game.update(1000 / 60);
      if (wasGrounded && !a.physics.grounded) launches++;
      wasGrounded = a.physics.grounded;
    }
    expect(launches === 1 && a.physics.grounded, "Motion impulse relaunched after landing");
  },
  async function testRearUsesATallerHurtboxAndRestoresItAfterRecovery(game: Game) {
    const a = battleFixture(game, "hellhound", 28);
    forceAttack(a, "hellhound_light_attack_mid");
    const box = a.world.getComponent<ColliderComponent>(a.id, "Collider")!.hurtboxes[0];
    game.update(1000 / 60);
    near(box.height, 80, "Rearing hurtbox");
    for (let frame = 0; frame < 120; frame++) game.update(1000 / 60);
    near(box.height, 50, "Standing hurtbox after swipe");
  },
  async function testAlphaSlamHitsOpponentsOnBothSidesAndLeavesAlliesUnharmed(game: Game) {
    const a = battleFixture(game, "alpha_hellhound", 105);
    forceAttack(a, "alpha_hellhound_special_attack_slam");
    const rear = createEnemy(a.world, 395, 704, "soldier"),
      ally = createEnemy(a.world, 590, 704, "soldier");
    for (const [id, team] of [
      [rear, 4],
      [ally, 3],
    ]) {
      a.world.removeComponent(id, "AIController");
      a.world.getComponent<FactionComponent>(id, "Faction")!.team = team;
      a.world.getComponent<PhysicsComponent>(id, "Physics")!.grounded = true;
    }
    const rearHealth = a.world.getComponent<HealthComponent>(rear, "Health")!,
      allyHealth = a.world.getComponent<HealthComponent>(ally, "Health")!;
    const before = allyHealth.current;
    for (let frame = 0; frame < 150; frame++) game.update(1000 / 60);
    expect(
      a.targetHealth.current < 250 && rearHealth.current < rearHealth.max,
      "Slam failed to threaten both sides",
    );
    near(allyHealth.current, before, "Friendly fire from slam");
  },
  async function testDeadCreatureCannotLeaveAStaleAttackHitboxOrTarget(game: Game) {
    const a = battleFixture(game, "hellhound", 24);
    a.strategy.update(0, a.id, a.world);
    a.world.getComponent<HealthComponent>(a.id, "Health")!.current = 0;
    new AISystem(a.world).update();
    expect(
      a.ai.state === "death" && a.animator.currentAnim === "death",
      "Creature did not enter its own death track",
    );
    expect(
      !a.world.hasComponent(a.id, "ActiveHitbox") && a.physics.velocity.x === 0,
      "Corpse continued attacking",
    );
  },
  async function testHellhoundSurvivorReplacesADeadAssignedArenaTarget(game: Game) {
    game.startBattle("hellhound", "none", "soldier", "rogue");
    const source = game.world
      .query("EnemyTag")
      .find((e) => (e.components[0] as EnemyTagComponent).enemyType === "hellhound")!.id;
    const ai = game.world.getComponent<AIControllerComponent>(source, "AIController")!;
    const old = ai.target!;
    game.world.getComponent<HealthComponent>(old, "Health")!.isDead = true;
    new AISystem(game.world).update();
    expect(
      ai.target !== null && ai.target !== old && ai.state === "combat",
      "Creature lost arena assignment after its target died",
    );
  },
  async function testMixedAndMirrorHellhoundArenaBattlesFinishUsingNormalAI(game: Game) {
    const original = Math.random;
    try {
      for (const seed of [7, 23, 41])
        for (const roster of [
          ["hellhound", "hellhound", "soldier", "soldier"],
          ["hellhound", "soldier", "hellhound", "rogue"],
          ["alpha_hellhound", "hellhound", "boss", "brute"],
          ["alpha_hellhound", "none", "alpha_hellhound", "none"],
        ]) {
          let state = seed;
          Math.random = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
          game.startBattle(roster[0], roster[1], roster[2], roster[3]);
          const battle = game.world.getResource<BattleState>(BattleState);
          for (let frame = 0; frame < 9000 && !battle.winner; frame++) game.update(1000 / 60);
          expect(!!battle.winner, `Creature arena stalled: ${roster.join("/")} seed ${seed}`);
          expect(
            game.world
              .query("AIController")
              .every((e) =>
                Number.isFinite(
                  game.world.getComponent<TransformComponent>(e.id, "Transform")!.position.x,
                ),
              ),
            "Non-finite creature movement",
          );
        }
    } finally {
      Math.random = original;
    }
  },
  async function testHellhoundProbabilisticallyReactsToOrdinaryHeavyWindups(game: Game) {
    game.startBattle("hellhound", "none", "brute", "none");
    const actors = game.world.query("EnemyTag", "Faction");
    const id = actors.find((e) => (e.components[1] as FactionComponent).team === 3)!.id;
    const target = actors.find((e) => (e.components[1] as FactionComponent).team === 4)!.id;
    const transform = game.world.getComponent<TransformComponent>(id, "Transform")!;
    Object.assign(transform, { position: { x: 500, y: 704 }, facing: 1 });
    const targetTransform = game.world.getComponent<TransformComponent>(target, "Transform")!;
    Object.assign(targetTransform, { position: { x: 545, y: 704 }, facing: -1 });
    game.world.getComponent<PhysicsComponent>(id, "Physics")!.grounded = true;
    const ai = game.world.getComponent<AIControllerComponent>(id, "AIController")!;
    Object.assign(ai, {
      target,
      state: "combat",
      hasAttackToken: false,
      flankTimer: 10000,
      decisionTimer: 10000,
      attackCooldownTimer: 500,
    });
    const targetCombat = game.world.getComponent<CombatComponent>(target, "Combat")!;
    Object.assign(targetCombat, {
      attackState: "windup",
      attackType: "heavy",
      isHeavyAttack: true,
      attackTimer: 550,
      attackZone: 2,
      attackSerial: 1,
    });
    beginAnimation(
      game.world.getComponent<AnimatorComponent>(target, "Animator")!,
      "brute_heavy_attack_mid",
    );
    const strategy = new HellhoundStrategy(false);
    withRandom(0, () => {
      for (let i = 0; i < 8; i++) {
        game.world.getResource<TimeState>(TimeState).elapsed += 16;
        strategy.update(16, id, game.world);
      }
    });
    expect(
      ai.hellhoundSpecialResponse?.mode === "withdraw" &&
        game.world.getComponent<PhysicsComponent>(id, "Physics")!.velocity.x < 0,
      "Hellhound did not withdraw from an ordinary heavy swing when reaction succeeded",
    );
  },
];
