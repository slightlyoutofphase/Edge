import { World } from "../core/World";
import {
  TimeState,
  InputState,
  CameraState,
  SpatialGridState,
  CombatEventQueue,
} from "../core/Resources";
import { AssetLoader } from "../assets/AssetLoader";
import { createEnemy, createPlayer } from "../entities/Archetypes";
import { QuadrupedSkeleton, QUADRUPED_LEGS } from "../skeleton/data/QuadrupedSkeleton";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { TransformComponent } from "../components/Transform";
import { ColliderComponent } from "../components/Collider";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { SkeletonSystem } from "../features/animation/SkeletonSystem";
import { MovementSystem } from "../features/movement/MovementSystem";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";
import { getAnimationGroups, AnimationViewer } from "../tools/AnimationViewer";
import { attackMotionOffset } from "../features/combat/AttackTiming";
import { LEVELS } from "../data/Levels";
import { validateLevelData } from "../data/LevelValidation";

export const quadrupeds = ["hellhound", "alpha_hellhound"] as const;
function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function near(actual: number, expected: number, message: string) {
  expect(Math.abs(actual - expected) < 0.04, `${message}: ${actual} != ${expected}`);
}
function fixture(skin: (typeof quadrupeds)[number], facing: 1 | -1 = 1) {
  const world = new World();
  world.setResource(TimeState, Object.assign(new TimeState(), { delta: 16 }));
  world.setResource(InputState, new InputState());
  world.setResource(CameraState, new CameraState());
  world.setResource(SpatialGridState, new SpatialGridState());
  world.setResource(CombatEventQueue, new CombatEventQueue());
  const id = createEnemy(world, 0, 0, skin);
  const transform = world.getComponent<TransformComponent>(id, "Transform")!;
  transform.facing = facing;
  return {
    world,
    id,
    transform,
    skeleton: world.getComponent<SkeletonComponent>(id, "Skeleton")!,
    animator: world.getComponent<AnimatorComponent>(id, "Animator")!,
    animation: new AnimationSystem(world),
    bones: new SkeletonSystem(world),
  };
}
function preview(a: ReturnType<typeof fixture>, name: string, time: number) {
  a.world.removeComponent(a.id, "MovementState");
  a.world.removeComponent(a.id, "Combat");
  a.animator.currentAnim = name;
  a.animation.preview = { time, delta: 0, loop: false, emitEvents: false };
  a.animation.update();
  a.bones.update();
}

export const tests = [
  async function testQuadrupedsShareTheRigButHaveDistinctPlayerRelativeSizes() {
    const small = fixture("hellhound"),
      alpha = fixture("alpha_hellhound");
    const player = createPlayer(small.world, 0, 0);
    const playerBox = small.world.getComponent<ColliderComponent>(player, "Collider")!.hurtboxes[0];
    for (const a of [small, alpha]) {
      expect(
        a.skeleton.definition === QuadrupedSkeleton,
        "Creature cloned or borrowed the humanoid rig",
      );
      const box = a.world.getComponent<ColliderComponent>(a.id, "Collider")!.hurtboxes[0];
      const height = box.height * a.transform.scale.y;
      expect(
        a === small ? height <= playerBox.height * 0.4 : height > playerBox.height * 1.4,
        "Creature size does not match its role",
      );
      for (const leg of QUADRUPED_LEGS)
        for (const part of ["upper", "lower", "paw"])
          expect(
            QuadrupedSkeleton.bones.has(`${leg}-${part}`),
            "Rig is missing an independent limb joint",
          );
      expect(!QuadrupedSkeleton.bones.has("weapon"), "Quadruped inherited a humanoid weapon mount");
    }
  },
  async function testEveryCreatureTrackAndArtworkBoneBelongsToTheQuadrupedRig() {
    for (const skin of quadrupeds) {
      const clips = [...AssetLoader.animations.values()].filter((clip) =>
        clip.name.startsWith(skin + "_"),
      );
      expect(clips.length >= 12, "Creature lacks its locomotion, reactions, or attacks");
      for (const clip of clips) {
        expect(clip.skeletonId === QuadrupedSkeleton.id, "Clip lost its explicit rig");
        for (const key of clip.keyframes)
          for (const bone of Object.keys(key.bones))
            expect(QuadrupedSkeleton.bones.has(bone), `${clip.name} keys a foreign bone: ${bone}`);
        for (const event of clip.events ?? [])
          if (event.data?.attachedToBone)
            expect(
              QuadrupedSkeleton.bones.has(event.data.attachedToBone),
              "Attack attaches to a nonexistent bone",
            );
      }
      for (const bone of Object.keys(EnemyBonePaths[skin]))
        expect(QuadrupedSkeleton.bones.has(bone), "Unattached creature artwork");
    }
  },
  async function testEveryGroundedQuadrupedTrackPlantsAPawAtBothFacings() {
    for (const skin of quadrupeds)
      for (const facing of [1, -1] as const) {
        const a = fixture(skin, facing);
        for (const clip of AssetLoader.animations.values()) {
          if (!clip.name.startsWith(skin + "_") || !clip.grounded) continue;
          for (let step = 0; step <= 90; step++) {
            const time = (clip.duration * step) / 90;
            preview(a, clip.name, time);
            const soles = QUADRUPED_LEGS.map((leg) => {
              const m = a.skeleton.worldTransforms.get(`${leg}-paw`)!;
              return m.ty + 2 * m.d;
            });
            const offset = attackMotionOffset(clip, time);
            near(
              Math.max(...soles),
              offset.y,
              `${skin}/${clip.name} lost ground or preview flight contact`,
            );
            expect(
              soles.every((y) => y <= offset.y + 0.04),
              "Paw penetrated the support plane",
            );
          }
        }
      }
  },
  async function testQuadrupedLoopSeamsDoNotSnapAnyBone() {
    for (const skin of quadrupeds) {
      const a = fixture(skin);
      for (const clip of AssetLoader.animations.values())
        if (clip.name.startsWith(skin + "_") && clip.loop) {
          preview(a, clip.name, 0);
          const first = new Map([...a.skeleton.worldTransforms].map(([b, m]) => [b, { ...m }]));
          preview(a, clip.name, clip.duration);
          for (const [bone, m] of a.skeleton.worldTransforms)
            for (const property of ["a", "b", "c", "d", "tx", "ty"] as const)
              near(m[property], first.get(bone)![property], `${clip.name}/${bone} loop seam`);
        }
    }
  },
  async function testRegularMidAttackRearsWithTwoGroundedHindPawsAndRaisedForePaws() {
    const a = fixture("hellhound");
    preview(a, "hellhound_light_attack_mid", 420);
    for (const leg of ["hind-near", "hind-far"]) {
      const m = a.skeleton.worldTransforms.get(`${leg}-paw`)!;
      near(m.ty + 2 * m.d, 0, "Hind support paw");
    }
    for (const leg of ["fore-near", "fore-far"])
      expect(
        a.skeleton.worldTransforms.get(`${leg}-paw`)!.ty < -12,
        "Fore paw stayed on the floor during rear",
      );
    expect(
      a.skeleton.worldTransforms.get("head")!.ty < -27,
      "Swipe did not rise to a humanoid mid-height",
    );
    expect(
      a.skeleton.worldTransforms.get("chest")!.ty < -20,
      "Rear collapsed its pelvis instead of lifting the chest",
    );
  },
  async function testCreatureJawHingesIndependentlyAndRigMirrorsWithoutDrifting() {
    for (const skin of quadrupeds) {
      const right = fixture(skin, 1),
        left = fixture(skin, -1);
      const name =
        skin === "hellhound" ? "hellhound_light_attack_low" : "alpha_hellhound_heavy_attack_low";
      const clip = AssetLoader.getAnimation(name)!;
      preview(right, name, clip.duration * 0.23);
      preview(left, name, clip.duration * 0.23);
      expect((right.skeleton.currentPose.jaw.rotate ?? 0) > 20, "Bite windup did not open the jaw");
      for (const [bone, m] of right.skeleton.worldTransforms) {
        near(m.tx, -left.skeleton.worldTransforms.get(bone)!.tx, "Mirrored x");
        near(m.ty, left.skeleton.worldTransforms.get(bone)!.ty, "Mirrored y");
      }
    }
  },
  async function testMovementKeepsCreatureHeightAndDoesNotAddHumanoidStanceBones() {
    for (const skin of quadrupeds) {
      const a = fixture(skin);
      a.world.getComponent<PhysicsComponent>(a.id, "Physics")!.grounded = true;
      const collider = a.world.getComponent<ColliderComponent>(a.id, "Collider")!;
      new MovementSystem(a.world).update();
      a.animation.update();
      near(collider.hurtboxes[0].height, 50, "Restored standing creature height");
      expect(
        Object.keys(a.skeleton.currentPose).every((b) => QuadrupedSkeleton.bones.has(b)),
        "Humanoid stance contaminated creature pose",
      );
    }
  },
  async function testCreatureGaitPlaybackFollowsSpeedWhilePreservingVelocity() {
    const clocks: number[] = [];
    for (const speed of [65, 130]) {
      const a = fixture("hellhound");
      a.world.getComponent<MovementStateComponent>(a.id, "MovementState")!.current = "walk";
      a.world.getComponent<PhysicsComponent>(a.id, "Physics")!.velocity.x = speed;
      a.animator.currentAnim = "hellhound_walk";
      a.animation.update();
      clocks.push(a.animator.time);
      near(
        a.world.getComponent<PhysicsComponent>(a.id, "Physics")!.velocity.x,
        speed,
        "Gait changed gameplay speed",
      );
    }
    near(clocks[1], clocks[0] * 2, "Movement driven gait clock");
  },
  async function testPlantedCreaturePawCancelsForwardTravelInsteadOfSkating() {
    for (const skin of quadrupeds)
      for (const facing of [1, -1] as const)
        for (const gait of ["walk", "run"]) {
          const a = fixture(skin, facing),
            clip = AssetLoader.getAnimation(`${skin}_${gait}`)!;
          const xs: number[] = [];
          for (const fraction of [0.1, 0.15, 0.2]) {
            const time = clip.duration * fraction;
            a.transform.position.x =
              ((clip.gaitSpeed! * a.transform.scale.x * time) / 1000) * facing;
            preview(a, clip.name, time);
            xs.push(a.skeleton.worldTransforms.get("fore-near-paw")!.tx);
          }
          for (const x of xs) near(x, xs[0], `${skin}/${gait} planted paw moved in world space`);
        }
  },
  async function testCreatureRunGathersLimbPairsRatherThanReusingTheWalkTrot() {
    const a = fixture("alpha_hellhound");
    const sole = (leg: string) => {
      const m = a.skeleton.worldTransforms.get(leg + "-paw")!;
      return m.ty + 2 * m.d;
    };
    const run = AssetLoader.getAnimation("alpha_hellhound_run")!;
    preview(a, run.name, run.duration * 0.2);
    near(sole("fore-near"), 0, "Running near fore support");
    near(sole("fore-far"), 0, "Running far fore support");
    expect(sole("hind-near") < -1, "Run did not gather the hind legs");
    const walk = AssetLoader.getAnimation("alpha_hellhound_walk")!;
    preview(a, walk.name, walk.duration * 0.2);
    near(sole("hind-far"), 0, "Walking diagonal support");
    expect(sole("fore-far") < -1, "Walk and run have identical limb timing");
  },
  async function testLeapAnticipationAndLandingCompressTheBodyWithFourPlantedPaws() {
    for (const skin of quadrupeds) {
      const a = fixture(skin);
      preview(a, `${skin}_idle`, 0);
      const chest = a.skeleton.worldTransforms.get("chest")!.ty;
      for (const [name, fraction] of [
        [
          skin === "hellhound"
            ? "hellhound_light_attack_high"
            : "alpha_hellhound_heavy_attack_high",
          skin === "hellhound" ? 0.18 : 0.25,
        ],
        [`${skin}_land`, 0.22],
      ] as const) {
        const clip = AssetLoader.getAnimation(name)!;
        preview(a, name, clip.duration * fraction);
        expect(
          a.skeleton.worldTransforms.get("chest")!.ty > chest + 3 * a.transform.scale.y,
          "Pose bent a single limb without compressing the body",
        );
        for (const leg of QUADRUPED_LEGS) {
          const m = a.skeleton.worldTransforms.get(`${leg}-paw`)!;
          near(m.ty + 2 * m.d, 0, "Compression lifted a support paw");
        }
        near(a.transform.position.y, 0, "Visual compression moved the physical body");
      }
    }
  },
  async function testQuadrupedCorpseRestsAboveTheFloor() {
    for (const skin of quadrupeds) {
      const a = fixture(skin);
      preview(a, skin + "_death", 900);
      let lowest = -Infinity;
      for (const [bone, drawing] of Object.entries(EnemyBonePaths[skin])) {
        const m = a.skeleton.worldTransforms.get(bone)!;
        const points = drawing.path.match(/-?\d+(?:\.\d+)?/g)!.map(Number);
        for (let i = 0; i < points.length; i += 2)
          lowest = Math.max(lowest, m.b * points[i] + m.d * points[i + 1] + m.ty);
      }
      near(lowest, 0, "Corpse contact envelope");
    }
  },
  async function testCreatureViewerGroupsAndAlphaCombatTimingUseTheirOwnTracks() {
    const viewer = new AnimationViewer(document.createElement("canvas"));
    try {
      await viewer.init();
      viewer.spawnEntity("alpha_hellhound");
      expect(
        viewer.currentAnimName === "alpha_hellhound_idle",
        "Viewer started with a humanoid idle",
      );
      const groups = getAnimationGroups("alpha_hellhound");
      expect(
        groups.length === 1 && groups[0].names.every((n) => n.startsWith("alpha_hellhound_")),
        "Viewer exposes incompatible shared rig tracks",
      );
      expect(
        getAnimationGroups("alpha_hellhound", true).every((group) =>
          group.names.every(
            (name) => AssetLoader.getAnimation(name)!.skeletonId === QuadrupedSkeleton.id,
          ),
        ),
        "Show All mixes incompatible rigs",
      );
      viewer.setAnimation("light_attack_mid");
      expect(
        viewer.currentAnimName === "alpha_hellhound_idle",
        "Viewer accepted a humanoid track on the quadruped",
      );
      viewer.setAnimation("hellhound_light_attack_mid");
      expect(
        viewer.currentAnimName === "hellhound_light_attack_mid",
        "Viewer could not compare the other character on the same rig",
      );
      expect(
        AssetLoader.getAnimation("hellhound_light_attack_mid", { skin: "alpha_hellhound" })
          ?.name === "hellhound_light_attack_mid",
        "Compatible quadruped preview lost its pose",
      );
      viewer.setAnimation("alpha_hellhound_special_attack_slam");
      viewer.setPlaybackMode("combat");
      near(viewer.duration, 1800, "Alpha clip was mistaken for a player weapon attack");
      expect(viewer.hitWindows.length === 1, "Alpha slam timing missing from viewer");
    } finally {
      viewer.game.destroy();
    }
  },
  async function testHellhoundsAreValidSpawnTypesWithoutChangingCampaignPlacement() {
    const edited = {
      ...LEVELS.arena,
      enemies: quadrupeds.map((type) => ({ type, x: 400, y: 700 })),
    };
    expect(validateLevelData(edited).enemies.length === 2, "Level data rejects new archetypes");
    expect(
      Object.values(LEVELS).every((level) =>
        level.enemies.every((e) => e.type !== "hellhound" && e.type !== "alpha_hellhound"),
      ),
      "Campaign content was changed",
    );
  },
];
