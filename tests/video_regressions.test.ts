import { Game } from "../core/Game";
import { AssetLoader } from "../assets/AssetLoader";
import { AnimationViewer, getAnimationGroups } from "../tools/AnimationViewer";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { CombatComponent } from "../features/combat/CombatComponent";
import { CombatSystem } from "../features/combat/CombatSystem";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { CombatDirectorSystem } from "../features/ai/CombatDirectorSystem";
import { TransformComponent } from "../components/Transform";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { FactionComponent } from "../components/Faction";
import { PlayerInputComponent } from "../components/PlayerInput";
import { BattleState, CameraState, CombatDirectorState, TimeState } from "../core/Resources";
import { CameraSystem } from "../systems/CameraSystem";
import { CollisionSystem } from "../systems/CollisionSystem";
import { UISystem } from "../systems/UISystem";

function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function near(value: number, wanted: number) {
  expect(Math.abs(value - wanted) < 0.01, `${value} != ${wanted}`);
}
function canvas() {
  return document.createElement("canvas");
}
async function withViewer(run: (viewer: AnimationViewer) => void) {
  const viewer = new AnimationViewer(canvas());
  try {
    await viewer.init();
    run(viewer);
  } finally {
    viewer.destroy();
  }
}
function withGame(run: (game: Game) => void) {
  const game = new Game(canvas());
  try {
    run(game);
  } finally {
    game.destroy();
  }
}
function contender(game: Game, x: number, target: number, team = 2) {
  const id = createEnemy(game.world, x, 100, "hollow");
  const ai = game.world.getComponent<AIControllerComponent>(id, "AIController")!;
  ai.state = "combat";
  ai.target = target;
  ai.attackCooldownTimer = 0;
  game.world.getComponent<FactionComponent>(id, "Faction")!.team = team;
  return { id, ai, combat: game.world.getComponent<CombatComponent>(id, "Combat")! };
}

export const tests = [
  async function testViewerStartsWithActualIdleDuration() {
    await withViewer((viewer) => {
      near(viewer.duration, 2000);
      viewer.setAnimation("backstep");
      viewer.spawnEntity("boss");
      near(viewer.duration, 2000);
      near(viewer.currentTime, 0);
    });
  },
  async function testViewerLoopOffStopsLoopingClips() {
    await withViewer((viewer) => {
      viewer.setAnimation("walk");
      viewer.loop = false;
      viewer.update(610);
      near(viewer.currentTime, 600);
      near(viewer.currentClipTime, 600);
      expect(!viewer.isPlaying, "Non-looping playback did not stop");
    });
  },
  async function testViewerPausedEndpointRemainsVisible() {
    await withViewer((viewer) => {
      viewer.setAnimation("heavy_attack_mid");
      viewer.isPlaying = false;
      viewer.setPlaybackTime(viewer.duration);
      viewer.update(16);
      near(viewer.currentTime, 733);
      near(
        viewer.world.getComponent<AnimatorComponent>(viewer.currentEntityId!, "Animator")!.time,
        733,
      );
    });
  },
  async function testViewerLoopOnRepeatsOneShotClips() {
    await withViewer((viewer) => {
      viewer.setAnimation("backstep");
      viewer.update(350);
      near(viewer.currentTime, 50);
    });
  },
  async function testViewerSeekRemovesStaleHitboxes() {
    await withViewer((viewer) => {
      viewer.setAnimation("light_attack_mid");
      viewer.update(160);
      expect(
        viewer.world.hasComponent(viewer.currentEntityId!, "ActiveHitbox"),
        "Fixture never opened its hitbox",
      );
      viewer.isPlaying = false;
      viewer.setPlaybackTime(390);
      viewer.update(0);
      expect(
        !viewer.world.hasComponent(viewer.currentEntityId!, "ActiveHitbox"),
        "Seek retained an expired hitbox",
      );
    });
  },
  async function testViewerPausedSeekDoesNotDispatchEvents() {
    await withViewer((viewer) => {
      viewer.setAnimation("light_attack_mid");
      viewer.isPlaying = false;
      viewer.setPlaybackTime(132);
      viewer.update(16);
      expect(
        !viewer.world.hasComponent(viewer.currentEntityId!, "ActiveHitbox"),
        "Paused seek spawned a gameplay hitbox",
      );
      expect(
        viewer.world.getComponent<AnimatorComponent>(viewer.currentEntityId!, "Animator")!
          .pendingEvents.length === 0,
        "Paused seek fired events",
      );
    });
  },
  async function testViewerBackwardSeekRearmsFutureEvents() {
    await withViewer((viewer) => {
      viewer.setAnimation("light_attack_mid");
      viewer.update(160);
      viewer.setPlaybackTime(100);
      viewer.update(40);
      expect(
        viewer.world.hasComponent(viewer.currentEntityId!, "ActiveHitbox"),
        "Future hitbox failed after a backward seek",
      );
    });
  },
  async function testViewerFrameStepsPauseAndClamp() {
    await withViewer((viewer) => {
      viewer.stepFrame(1);
      near(viewer.currentTime, 1000 / 60);
      expect(!viewer.isPlaying, "Frame step kept playing");
      viewer.stepFrame(-1);
      viewer.stepFrame(-1);
      near(viewer.currentTime, 0);
    });
  },
  async function testViewerPlayRestartsACompletedClip() {
    await withViewer((viewer) => {
      viewer.setAnimation("backstep");
      viewer.loop = false;
      viewer.update(350);
      viewer.setPlaying(true);
      near(viewer.currentTime, 0);
      viewer.update(16);
      near(viewer.currentTime, 16);
      expect(viewer.isPlaying, "Play did not restart the completed clip");
    });
  },
  async function testViewerSeekAndPlayClearSelectedHitboxPreview() {
    await withViewer((viewer) => {
      viewer.previewHitbox = { width: 40 };
      viewer.setPlaybackTime(100);
      expect(viewer.previewHitbox === null, "Seek retained a selected hitbox overlay");
      viewer.previewHitbox = { width: 40 };
      viewer.setPlaying(true);
      expect(viewer.previewHitbox === null, "Playback retained a selected hitbox overlay");
    });
  },
  async function testViewerGroupsClipsByCharacter() {
    for (const entity of ["player", "hollow", "soldier", "duelist", "brute", "rogue", "boss"]) {
      const groups = getAnimationGroups(entity);
      expect(
        groups.some((group) => group.names.includes("idle")),
        "Shared clips missing",
      );
      expect(
        groups.every((group) => group.label === "SHARED" || group.label === entity.toUpperCase()),
        "Other character clips leaked into the default list",
      );
    }
    expect(
      getAnimationGroups("player", true).some((group) => group.label === "BOSS"),
      "Cross-character preview is unavailable",
    );
  },
  async function testViewerCombatClockMatchesActualPlayerAttack() {
    await withViewer((viewer) =>
      withGame((game) => {
        const id = createPlayer(game.world, 0, 0);
        const combat = game.world.getComponent<CombatComponent>(id, "Combat")!;
        combat.attackZone = 3;
        combat.lastZoneChangeTime = 0;
        game.world.getComponent<PlayerInputComponent>(id, "PlayerInput")!.buffer = {
          action: "heavyAttack",
          timestamp: 0,
          priority: 1,
        };
        const time = game.world.getResource<TimeState>(TimeState);
        const combatSystem = new CombatSystem(game.world),
          animations = new AnimationSystem(game.world);
        time.delta = 0;
        combatSystem.update();
        viewer.setAnimation("heavy_attack_low");
        viewer.setPlaybackMode("combat");
        viewer.loop = false;
        for (let frame = 0; frame < 20; frame++) {
          time.delta = 16;
          time.elapsed += 16;
          combatSystem.update();
          animations.update();
          viewer.update(16);
          near(
            viewer.currentClipTime,
            game.world.getComponent<AnimatorComponent>(id, "Animator")!.time,
          );
        }
        const window = viewer.hitWindows[0];
        viewer.isPlaying = false;
        viewer.setPlaybackTime(window.start);
        near(viewer.currentClipTime, 0.45 * viewer.clipDuration);
      }),
    );
  },
  async function testViewerWeaponTimingUpdatesWithoutMovingPose() {
    await withViewer((viewer) => {
      viewer.setAnimation("heavy_attack_mid");
      viewer.setPlaybackMode("combat");
      viewer.setPlaybackTime(100);
      const before = viewer.currentClipTime,
        duration = viewer.duration;
      viewer.setWeapon("greatsword");
      near(viewer.currentClipTime, before);
      expect(viewer.duration !== duration, "Weapon-specific timing did not update");
    });
  },
  async function testViewerEditedEventsRefreshCombatTimingAndKeepPose() {
    await withViewer((viewer) => {
      viewer.setAnimation("heavy_attack_mid");
      viewer.setPlaybackMode("combat");
      viewer.setPlaybackTime(100);
      const before = viewer.currentClipTime;
      const clip = AssetLoader.getAnimation("heavy_attack_mid")!,
        original = clip.events;
      try {
        clip.events = clip.events!.map((event) =>
          event.type === "hitbox-start" ? { ...event, time: 0.4 } : event,
        );
        viewer.refreshEvents();
        near(viewer.currentClipTime, before);
        viewer.isPlaying = false;
        viewer.setPlaybackTime(viewer.hitWindows[0].start);
        near(viewer.currentClipTime, 0.4 * clip.duration);
        clip.events = [];
        viewer.refreshEvents();
        expect(!viewer.hasCombatTiming, "Deleted hit events retained stale combat timing");
      } finally {
        clip.events = original;
      }
    });
  },
  async function testDeadActorsDoNotPushLivingActorsInEitherOrder() {
    for (const deadFirst of [true, false])
      withGame((game) => {
        const first = createEnemy(game.world, 0, 100, "hollow"),
          second = createEnemy(game.world, 5, 100, "hollow");
        const dead = deadFirst ? first : second,
          alive = deadFirst ? second : first;
        const health = game.world.getComponent<HealthComponent>(dead, "Health")!;
        health.current = 0;
        health.isDead = true;
        const before = game.world.getComponent<TransformComponent>(alive, "Transform")!.position.x;
        game.world.getResource<TimeState>(TimeState).delta = 16;
        new CollisionSystem(game.world).update();
        near(game.world.getComponent<TransformComponent>(alive, "Transform")!.position.x, before);
      });
  },
  async function testArenaSpawnsAllExistingWeaponTrails() {
    withGame((game) => {
      game.startBattle("soldier", "hollow", "duelist", "rogue");
      expect(
        game.world.query("WeaponTrail", "AIController").length === 4,
        "Arena fighters lack weapon trails",
      );
      game.startBattle("boss", "none", "brute", "none");
      expect(
        game.world.query("WeaponTrail", "AIController").length === 2,
        "Restart left missing or duplicate trails",
      );
    });
  },
  async function testDistantActorsCannotReserveAttackSlots() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100);
      const far = contender(game, -500, target),
        otherFar = contender(game, -400, target),
        nearActor = contender(game, 30, target);
      new CombatDirectorSystem(game.world).update();
      expect(
        !far.ai.hasAttackToken && !otherFar.ai.hasAttackToken && nearActor.ai.hasAttackToken,
        "Distant actors starved the ready fighter",
      );
    });
  },
  async function testBlockedAndVerticallySeparatedActorsCannotReserveSlots() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100),
        blocked = contender(game, 30, target),
        high = contender(game, 20, target);
      game.world.getComponent<TransformComponent>(high.id, "Transform")!.position.y = 200;
      createPlatform(game.world, 10, 0, 5, 100, "solid");
      new CombatDirectorSystem(game.world).update();
      expect(
        !blocked.ai.hasAttackToken && !high.ai.hasAttackToken,
        "Unreachable attack reserved a slot",
      );
    });
  },
  async function testDeadStaggeredAndExhaustedActorsCannotReserveSlots() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100),
        dead = contender(game, 10, target),
        staggered = contender(game, 20, target),
        tired = contender(game, 30, target);
      game.world.getComponent<HealthComponent>(dead.id, "Health")!.isDead = true;
      staggered.combat.attackState = "stagger";
      game.world.getComponent<StaminaComponent>(tired.id, "Stamina")!.current = 0;
      new CombatDirectorSystem(game.world).update();
      expect(
        game.world.getResource<CombatDirectorState>(CombatDirectorState).activeTokens.size === 0,
        "Invalid fighter was granted attack permission",
      );
    });
  },
  async function testUnusedReservationsExpireAndRotate() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100),
        contenders = [
          contender(game, 10, target),
          contender(game, 20, target),
          contender(game, 30, target),
        ];
      game.world.getResource<CombatDirectorState>(CombatDirectorState).maxTokens = 1;
      game.world.getResource<TimeState>(TimeState).delta = 100;
      const director = new CombatDirectorSystem(game.world);
      const holders = () => contenders.filter((c) => c.ai.hasAttackToken);
      const seen = new Set<number>();

      director.update();
      const round1 = holders();
      expect(round1.length === 1, "Initial single-slot request did not grant exactly one token");
      seen.add(round1[0].id);

      for (let i = 0; i < 3; i++) director.update();
      const round2 = holders();
      expect(
        round2.length === 1 && !round1[0].ai.hasAttackToken && !seen.has(round2[0].id),
        "Unused reservation did not rotate to another contender",
      );
      seen.add(round2[0].id);

      for (let i = 0; i < 3; i++) director.update();
      const round3 = holders();
      expect(
        round3.length === 1 && !round2[0].ai.hasAttackToken,
        "Expired reservation failed to hand off token",
      );
      seen.add(round3[0].id);
      expect(seen.size >= 2, "Reservation rotation starved remaining contenders");
    });
  },
  async function testAttackTokenSurvivesActiveAttackAndRecovery() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100),
        actor = contender(game, 20, target);
      const director = new CombatDirectorSystem(game.world);
      director.update();
      game.world.getResource<TimeState>(TimeState).delta = 1000;
      for (const phase of ["windup", "active", "recovery"] as const) {
        actor.combat.attackState = phase;
        director.update();
        expect(actor.ai.hasAttackToken, "An in-progress attack lost its permission");
      }
      actor.combat.attackState = "idle";
      actor.ai.attackCooldownTimer = 1000;
      director.update();
      expect(!actor.ai.hasAttackToken, "Completed attack retained permission during cooldown");
    });
  },
  async function testArenaSharesReadyAttackSlotsAcrossTeams() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100);
      contender(game, 10, target, 3);
      contender(game, 20, target, 3);
      contender(game, 30, target, 4);
      game.world.getResource<BattleState>(BattleState).isActive = true;
      new CombatDirectorSystem(game.world).update();
      const teams = [
        ...game.world.getResource<CombatDirectorState>(CombatDirectorState).activeTokens,
      ].map((id) => game.world.getComponent<FactionComponent>(id, "Faction")!.team);
      expect(
        teams.includes(3) && teams.includes(4),
        "Spawn order gave both arena slots to one team",
      );
    });
  },
  async function testHeavyLowSolesRemainGroundedThroughoutClip() {
    withGame((game) => {
      const id = createPlayer(game.world, 0, 0);
      game.world.removeComponent(id, "MovementState");
      game.world.removeComponent(id, "Combat");
      game.world.getComponent<AnimatorComponent>(id, "Animator")!.currentAnim = "heavy_attack_low";
      const animation = new AnimationSystem(game.world),
        skeleton = new SkeletonSystem(game.world);
      for (let frame = 0; frame <= 120; frame++) {
        animation.preview = { time: (frame / 120) * 733, delta: 0, loop: false, emitEvents: false };
        animation.update();
        skeleton.update();
        for (const bone of ["foot-front", "foot-back"]) {
          const matrix = game.world
            .getComponent<SkeletonComponent>(id, "Skeleton")!
            .worldTransforms.get(bone)!;
          near(matrix.ty + matrix.d * 4, 0);
        }
      }
    });
  },
  async function testHeavyLowBraceReleasesCleanlyIntoIdle() {
    withGame((game) => {
      const id = createPlayer(game.world, 0, 0);
      const animator = game.world.getComponent<AnimatorComponent>(id, "Animator")!;
      animator.currentAnim = "heavy_attack_low";
      animator.time = 733;
      game.world.getResource<TimeState>(TimeState).delta = 16;
      const animation = new AnimationSystem(game.world),
        skeleton = new SkeletonSystem(game.world);
      for (let frame = 0; frame < 12; frame++) {
        animation.update();
        skeleton.update();
        const skin = game.world.getComponent<SkeletonComponent>(id, "Skeleton")!;
        for (const bone of ["foot-front", "foot-back"]) {
          const m = skin.worldTransforms.get(bone)!;
          expect(Math.abs(m.ty + m.d * 4) < 0.5, "Brace stayed bent while idle lifted the hip");
        }
      }
      expect(!animator.blendFrom, "Attack-to-idle blend did not finish");
      const idleFrontLeg =
        game.world.getComponent<SkeletonComponent>(id, "Skeleton")!.currentPose["leg-front-upper"]
          ?.rotate ?? 0;
      expect(
        Math.abs(idleFrontLeg - -14) < 0.25,
        `Expected idle leg-front-upper near -14, got ${idleFrontLeg}`,
      );
    });
  },
  async function testSpectatorZoomKeepsWideAndNarrowFightsVisible() {
    for (const width of [360, 1920])
      withGame((game) => {
        game.canvas.width = width;
        game.canvas.height = 1080;
        const camera = game.world.getResource<CameraState>(CameraState);
        camera.viewport = { x: width, y: 1080 };
        camera.position = { x: 600, y: 600 };
        camera.targetPosition = { ...camera.position };
        game.world.getResource<BattleState>(BattleState).isActive = true;
        const ids = [
          createEnemy(game.world, 100, 704, "hollow"),
          createEnemy(game.world, 1100, 704, "boss"),
        ];
        game.world.getResource<TimeState>(TimeState).delta = 16;
        const system = new CameraSystem(game.world);
        for (let frame = 0; frame < 300; frame++) system.update();
        for (const id of ids) {
          const transform = game.world.getComponent<TransformComponent>(id, "Transform")!;
          const x = (transform.position.x - camera.position.x) * camera.zoom + width / 2;
          const y = (transform.position.y - camera.position.y) * camera.zoom + 540;
          expect(x > 0 && x < width && y > 0 && y < 1000, "Spectator framing clipped a fighter");
        }
      });
  },
  async function testArenaBarsStackWithoutOverlap() {
    withGame((game) => {
      const target = createPlayer(game.world, 0, 100);
      for (let i = 0; i < 4; i++) contender(game, 30, target, i < 2 ? 3 : 4);
      game.world.getResource<CameraState>(CameraState).zoom = 2.5;
      const boxes: number[][] = [],
        ctx = game.canvas.getContext("2d")!,
        original = ctx.fillRect;
      ctx.fillRect = function (x, y, width, height) {
        if (this.fillStyle === "#000000") boxes.push([x, y, width, height]);
      };
      try {
        const ui = new UISystem(game.world);
        ui.setCanvas(game.canvas);
        ui.update();
      } finally {
        ctx.fillRect = original;
      }
      expect(boxes.length === 4, "Arena health bars were missing");
      for (let i = 0; i < boxes.length; i++)
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i],
            b = boxes[j];
          expect(
            a[1] + a[3] <= b[1] || b[1] + b[3] <= a[1],
            "Overlapping fighters retained overlapping health bars",
          );
        }
    });
  },
  async function testSpectatorKeepsFightersVisibleAtArenaEdgesDuringPan() {
    withGame((game) => {
      game.canvas.width = 1920;
      game.canvas.height = 1080;
      const camera = game.world.getResource<CameraState>(CameraState);
      camera.viewport = { x: 1920, y: 1080 };
      camera.bounds = { min: { x: 0, y: 0 }, max: { x: 1200, y: 800 } };
      camera.position = { x: 600, y: 600 };
      camera.targetPosition = { ...camera.position };
      camera.zoom = 3;
      game.world.getResource<BattleState>(BattleState).isActive = true;
      const ids = [
        createEnemy(game.world, 1150, 704, "hollow"),
        createEnemy(game.world, 1190, 704, "boss"),
      ];
      game.world.getResource<TimeState>(TimeState).delta = 16;
      new CameraSystem(game.world).update();
      for (const id of ids) {
        const t = game.world.getComponent<TransformComponent>(id, "Transform")!;
        for (const x of [t.position.x - 100 * t.scale.x, t.position.x + 100 * t.scale.x]) {
          const screen = (x - camera.position.x) * camera.zoom + 960;
          expect(
            screen >= 0 && screen <= 1920,
            "Arena bounds or pan lag clipped a fighter's padded silhouette",
          );
        }
      }
    });
  },
];
