import { World } from "../core/World";
import { createEnemy, createPlatform } from "../entities/Archetypes";
import {
  CameraState,
  EditorState,
  GlobalLight,
  SpatialGridState,
  TimeState,
} from "../core/Resources";
import { SpatialHashGrid } from "../utils/SpatialHashGrid";
import { Matrix2D } from "../utils/Matrix2D";
import { SpriteCache } from "../utils/SpriteCache";
import { poseMatrices } from "../animation/data/PoseAuthoring";
import { PlayerSkeleton } from "../skeleton/data/PlayerSkeleton";
import { QuadrupedSkeleton } from "../skeleton/data/QuadrupedSkeleton";
import { NavigationGraph } from "../features/navigation/NavigationGraph";
import { isSolidTerrainBlocking } from "../features/ai/CombatReach";
import { CollisionSystem } from "../systems/CollisionSystem";
import { PhysicsSystem } from "../features/movement/PhysicsSystem";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { TransformComponent } from "../components/Transform";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimationSystem } from "../features/animation/AnimationSystem";
import { Animation, BonePose } from "../features/animation/AnimationTypes";
import { AnimationViewer } from "../tools/AnimationViewer";
import { AssetLoader } from "../assets/AssetLoader";
import { TilePaths } from "../assets/svg/EnvironmentSVGs";
import { RenderSystem } from "../systems/RenderSystem";
import { createViewerClock } from "../ui/ViewerPlayhead";
import { WeaponTrailSystem } from "../systems/WeaponTrailSystem";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";

function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}
function same(actual: unknown, expected: unknown, message: string) {
  expect(JSON.stringify(actual) === JSON.stringify(expected), message);
}
function spatialWorld() {
  const world = new World();
  world.setResource(TimeState, Object.assign(new TimeState(), { delta: 16 }));
  world.setResource(SpatialGridState, new SpatialGridState());
  return world;
}

export const tests = [
  async function testSelectiveCacheReplacementAndEmptyResults() {
    const world = new World(),
      id = world.createEntity();
    const empty = world.query("A", "B");
    expect(empty === world.query("A", "B"), "Empty results must use the same cached snapshot");
    const a = { value: 1 };
    world.addComponent(id, "A", a);
    const onlyA = world.query("A");
    world.addComponent(id, "B", {});
    expect(
      world.query("A", "B").length === 1,
      "Adding a previously missing dependency left a stale empty cache",
    );
    expect(world.query("A") === onlyA, "Adding B discarded the unrelated A cache");
    world.addComponent(id, "A", a);
    world.removeComponent(id, "Missing");
    world.removeComponent(9999, "A");
    expect(world.query("A") === onlyA, "No-op mutations discarded a valid cache");
    const replacement = { value: 2 };
    world.addComponent(id, "A", replacement);
    expect(
      world.query("A")[0].components[0] === replacement,
      "Component replacement returned the old object",
    );
    expect(
      onlyA[0].components[0] === a,
      "Replacement mutated a query snapshot held by a running system",
    );
  },

  async function testSelectiveCacheDestroyAndRecycledIds() {
    const world = new World(),
      actor = world.createEntity(),
      effect = world.createEntity();
    world.addComponent(actor, "Actor", {});
    world.addComponent(effect, "Effect", {});
    const actors = world.query("Actor"),
      effects = world.query("Effect");
    world.destroyEntity(effect);
    expect(world.query("Actor") === actors, "Destroying an effect invalidated the actor cache");
    expect(
      world.query("Effect").length === 0 && effects.length === 1,
      "Destroying an entity damaged snapshot semantics",
    );
    const recycled = world.createEntity();
    expect(recycled === effect, "Entity recycling order changed");
    world.addComponent(recycled, "Actor", {});
    same(
      world.query("Actor").map((e) => e.id),
      [actor, recycled],
      "Recycled entity missing or in the wrong query order",
    );
  },

  async function testGridBucketReuseDoesNotRetainIds() {
    const grid = new SpatialHashGrid(32),
      area = { x: -64, y: -64, width: 128, height: 128 },
      out: number[] = [];
    for (let frame = 0; frame < 30; frame++) {
      grid.clear();
      grid.clear();
      grid.insert(frame * 2, area);
      grid.insert(frame * 2 + 1, area);
      expect(grid.query(area, out) === out, "Grid replaced its caller's output buffer");
      same(
        out,
        [frame * 2, frame * 2 + 1],
        "Reused buckets retained old IDs or changed deduplication order",
      );
    }
    grid.clear();
    same(grid.query(area, out), [], "Cleared grid retained occupants");
  },

  async function testPoseMatrixScratchSwitchesRigsAndPreservesSnapshots() {
    const scratch = new Map<string, Matrix2D>();
    const pose: BonePose = {
      "body-pivot": { rotate: 13, translate: { x: 3, y: -4 }, scale: { x: 1.1, y: 0.9 } },
      hip: { rotate: -21 },
      pelvis: { rotate: 17 },
      "fore-near-upper": { rotate: 43 },
    };
    for (const definition of [PlayerSkeleton, QuadrupedSkeleton, PlayerSkeleton]) {
      const snapshot = poseMatrices(pose, definition);
      const expected = JSON.stringify([...snapshot]);
      const reused = poseMatrices(pose, definition, scratch);
      same(
        [...reused],
        [...snapshot],
        "Scratch FK changed a bone transform or kept another rig's bones",
      );
      const first = reused.get(definition.root.id);
      poseMatrices({ "body-pivot": { rotate: -8 } }, definition, scratch);
      expect(
        first === scratch.get(definition.root.id),
        "Scratch FK allocated a new matrix on repeat use",
      );
      expect(
        JSON.stringify([...snapshot]) === expected,
        "Public FK snapshots were overwritten by a subsequent solve",
      );
    }
  },

  async function testSampleStorageResetsSparseBonesAndKeepsSnapshots() {
    const system = new AnimationSystem(new World()) as any;
    const buffer = { bones: {} };
    const clip: Animation = {
      name: "scratch-regression",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: { torso: { rotate: 10 } } },
        { time: 0.5, bones: { torso: { rotate: 30 }, head: { scale: { x: 0.5, y: 2 } } } },
        { time: 1, bones: { hip: { translate: { x: 2, y: 4 } } } },
      ],
    };
    const retained = system.sampleAnimation(clip, 25),
      snapshot = structuredClone(retained);
    for (const time of [25, 75, 0, 100, 25]) {
      const actual = system.sampleAnimation(clip, time, buffer),
        expected = system.sampleAnimation(clip, time);
      for (const key of Object.keys(expected))
        same(actual[key], expected[key], `Scratch sampling changed ${key} at ${time}`);
      same(
        Object.keys(actual),
        Object.keys(expected),
        "Sparse sampling retained a previous segment's bones",
      );
    }
    same(retained, snapshot, "Sampling storage overwrote a retained public pose");
    const empty = system.sampleAnimation({ ...clip, keyframes: [] }, 30, buffer);
    same(empty, {}, "An empty clip retained the previous clip's pose");
  },

  async function testTerrainProbeGridMatchesFallbackAndDirtyEdits() {
    const world = spatialWorld();
    const wall = createPlatform(world, 20, -100, 10, 100);
    createPlatform(world, 60, -100, 10, 100, "semisolid");
    const decor = createPlatform(world, 100, -100, 10, 100);
    world.getComponent<any>(decor, "Platform").collidable = false;
    world.getComponent<TransformComponent>(wall, "Transform")!.scale = { x: -2, y: 0.5 };
    const probes = [15, 21, 39, 41, 65, 105, 10000].flatMap((x) =>
      [-101, -80, -55, -49, 1].map((y) => ({ x, y, width: 2, height: 8 })),
    );
    const fallback = probes.map((probe) => isSolidTerrainBlocking(world, probe));
    new CollisionSystem(world).update(false);
    same(
      probes.map((probe) => isSolidTerrainBlocking(world, probe)),
      fallback,
      "Grid terrain tests differ from the full terrain scan",
    );
    world.getComponent<TransformComponent>(wall, "Transform")!.position.x = 500;
    world.getResource<SpatialGridState>(SpatialGridState).needsStaticRebuild = true;
    const movedProbe = { x: 505, y: -80, width: 2, height: 8 };
    expect(
      isSolidTerrainBlocking(world, movedProbe),
      "Dirty terrain incorrectly used old grid occupants",
    );
    new CollisionSystem(world).update(false);
    expect(isSolidTerrainBlocking(world, movedProbe), "Rebuilt terrain grid lost a moved wall");
  },

  async function testTraversalCacheUsesExactDimensionsAndRebuilds() {
    const world = new World(),
      nav = new NavigationGraph();
    const floor = createPlatform(world, 0, 0, 300, 30);
    const ceiling = createPlatform(world, 40, -50, 40, 10);
    nav.build(world);
    const nodes = [...nav.nodes.values()].filter((node) => node.platformId === floor);
    const [a, b] = [nodes[0], nodes[1]],
      internal = nav as any;
    expect(
      !!internal.traversal(a, b, "walk", { width: 10, height: 39 }),
      "Small actor unexpectedly cannot pass under ceiling",
    );
    expect(
      internal.traversal(a, b, "walk", { width: 10, height: 39.001 }) === null,
      "Cache rounded away a real clearance obstruction",
    );
    world.destroyEntity(ceiling);
    nav.build(world);
    const rebuilt = [...nav.nodes.values()].filter((node) => node.platformId === floor);
    expect(
      !!internal.traversal(rebuilt[0], rebuilt[1], "walk", { width: 10, height: 39.001 }),
      "Terrain rebuild retained a blocked cached route",
    );
  },

  async function testCachedPathsDoNotShareMutableTakeoffPoints() {
    const world = new World(),
      nav = new NavigationGraph();
    createPlatform(world, 0, 0, 200, 30);
    createPlatform(world, 240, 0, 200, 30);
    nav.build(world);
    const start = { x: 20, y: -1 },
      end = { x: 400, y: -1 };
    const first = nav.findPath(start, end),
      expected = structuredClone(first);
    expect(first.length > 1 && !!first[0].takeoff, "Path fixture did not produce traversal steps");
    first[0].takeoff!.x = -99999;
    first[0].x = -99999;
    first[0].started = true;
    same(nav.findPath(start, end), expected, "A caller mutated the cached route for another actor");
  },

  async function testPreviousPositionStorageRetainsCorrectCoordinates() {
    const world = spatialWorld(),
      id = createEnemy(world, 100, 0, "hellhound");
    const transform = world.getComponent<TransformComponent>(id, "Transform")!;
    const physics = world.getComponent<PhysicsComponent>(id, "Physics")!;
    const system = new PhysicsSystem(world),
      collision = new CollisionSystem(world);
    system.update();
    const previous = physics.previousPosition!;
    same(previous, { x: 100, y: 0 }, "Physics no longer records the pre-integration position");
    collision.update();
    expect(
      previous === physics.previousPosition,
      "Collision replaced reusable previousPosition storage",
    );
    same(previous, transform.position, "Collision failed to record the resolved position");
    const resolved = { ...transform.position };
    system.update();
    same(previous, resolved, "Next physics step lost the prior resolved position");
    expect(
      previous === physics.previousPosition,
      "Physics replaced reusable previousPosition storage",
    );
  },

  async function testSpriteMetadataCachingDoesNotClampContactGeometry() {
    const path = "M -600 -40 L 600 -40 L 600 40 L -600 40 Z";
    const before = SpriteCache.getBounds(path),
      values = SpriteCache.getCoordinates(path);
    SpriteCache.get(path, "white");
    expect(
      SpriteCache.getBounds(path) === before && before.width === 1208,
      "Sprite fallback clamped shared contact bounds",
    );
    expect(
      SpriteCache.getCoordinates(path) === values,
      "Contact coordinates were reparsed on repeat use",
    );
    same(
      values,
      [-600, -40, 600, -40, 600, 40, -600, 40],
      "Contact coordinate parsing changed geometry",
    );
  },

  async function testTerrainDrawsOnlyNearbyCells() {
    const world = spatialWorld(),
      canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    world.setResource(CameraState, Object.assign(new CameraState(), { zoom: 1 }));
    world.setResource(
      EditorState,
      Object.assign(new EditorState(), { enabled: true, hideBackground: true }),
    );
    world.setResource(GlobalLight, new GlobalLight());
    createPlatform(world, -2000, -2000, 5000, 5000, "solid", 0, "stone-block");
    new CollisionSystem(world).update(false);
    const tile = TilePaths["stone-block"],
      sprite = SpriteCache.get(tile, tile.path, tile.fill, tile.stroke, tile.strokeWidth);
    const ctx = canvas.getContext("2d")!,
      original = ctx.drawImage;
    let draws = 0;
    ctx.drawImage = function (this: CanvasRenderingContext2D, ...args: any[]) {
      if (args[0] === sprite) draws++;
      return (original as any).apply(this, args);
    } as typeof original;
    try {
      new RenderSystem(world, canvas).update();
    } finally {
      ctx.drawImage = original;
    }
    expect(
      draws > 50 && draws < 225,
      `Visible terrain submitted ${draws} cells instead of culling the long platform`,
    );
  },

  async function testRenderOrderCacheHandlesTwoHandedTransitionsAndRigReplacement() {
    const world = spatialWorld(),
      id = createEnemy(world, 0, 0, "brute");
    const skeleton = world.getComponent<SkeletonComponent>(id, "Skeleton")!;
    skeleton.definition = PlayerSkeleton;
    for (const bone of PlayerSkeleton.bones.keys())
      skeleton.worldTransforms.set(bone, new Matrix2D());
    const renderer = new RenderSystem(world, document.createElement("canvas")) as any;
    const normal = renderer.getBoneOrder(skeleton);
    skeleton.offHandGripActive = true;
    const gripped = renderer.getBoneOrder(skeleton);
    expect(
      gripped.indexOf("hand-back") > gripped.indexOf("weapon"),
      "Support hand is behind the two-handed handle",
    );
    skeleton.offHandGripActive = false;
    expect(
      renderer.getBoneOrder(skeleton) === normal,
      "Normal order was not restored after releasing the grip",
    );
    skeleton.definition = QuadrupedSkeleton;
    skeleton.worldTransforms = poseMatrices({}, QuadrupedSkeleton);
    const replaced = renderer.getBoneOrder(skeleton);
    expect(
      replaced !== normal && replaced.includes("jaw") && !replaced.includes("weapon"),
      "Rig replacement retained the old bone order",
    );
  },

  async function testViewerEventCacheInvalidatesForEditsAndTimingModes() {
    const viewer = new AnimationViewer(document.createElement("canvas"));
    const name = "performance_event_regression";
    AssetLoader.registerAnimation(name, {
      name,
      loop: false,
      duration: 100,
      keyframes: [],
      events: [
        { time: 0.8, type: "hitbox-end" },
        { time: 0.2, type: "hitbox-start" },
      ],
    });
    try {
      viewer.setAnimation(name);
      const windows = viewer.hitWindows;
      same(windows, [{ start: 20, end: 80 }], "Viewer changed sorted event windows");
      expect(viewer.hitWindows === windows, "Viewer recomputed unchanged hit windows");
      AssetLoader.getAnimation(name)!.events![0].time = 0.3;
      viewer.refreshEvents();
      same(
        viewer.hitWindows,
        [{ start: 30, end: 80 }],
        "In-place event edit retained cached timing",
      );
      AssetLoader.getAnimation(name)!.events = [{ time: 0.4, type: "hitbox-start" }];
      same(
        viewer.hitWindows,
        [{ start: 40, end: 100 }],
        "Replaced event list retained cached windows",
      );
      viewer.spawnEntity("boss");
      viewer.setAnimation("boss_heavy_attack_mid");
      viewer.setPlaybackMode("combat");
      const combat = viewer.hitWindows;
      viewer.setPlaybackMode("clip");
      expect(viewer.hitWindows !== combat, "Switching timing modes retained combat hit windows");
    } finally {
      viewer.destroy();
      AssetLoader.animations.delete(name);
    }
  },

  async function testViewerClockDeduplicatesAndUnsubscribes() {
    const clock = createViewerClock();
    let notifications = 0;
    const unsubscribe = clock.subscribe(() => notifications++);
    clock.setTime(17);
    clock.setTime(17);
    clock.setTime(0);
    expect(
      notifications === 2 && clock.getSnapshot() === 0,
      "Viewer clock lost seeks or notified for unchanged time",
    );
    unsubscribe();
    clock.setTime(50);
    expect(
      notifications === 2 && clock.getSnapshot() === 50,
      "Unmounted viewer controls retained a subscription",
    );
  },

  async function testTrailPointReusePreservesHistoryAndStrikeResets() {
    const world = spatialWorld(),
      id = createEnemy(world, 0, 0, "soldier");
    const skeleton = world.getComponent<SkeletonComponent>(id, "Skeleton")!;
    const matrix = new Matrix2D();
    skeleton.worldTransforms.set("weapon", matrix);
    world.getComponent<any>(id, "Combat").attackState = "active";
    world.addComponent(id, "ActiveHitbox", {});
    const trail: WeaponTrailComponent = {
      boneId: "weapon",
      tipOffset: { x: 30, y: 0 },
      baseOffset: { x: 0, y: 0 },
      history: [],
      maxLength: 3,
      active: false,
      color: "white",
    };
    world.addComponent(id, "WeaponTrail", trail);
    const system = new WeaponTrailSystem(world);
    for (let i = 0; i < 12; i++) {
      matrix.tx = i;
      system.update();
    }
    same(
      trail.history.map((p) => p.base.x),
      [9, 10, 11],
      "Trail point reuse changed history order",
    );
    same(
      trail.history.map((p) => p.tip.x),
      [39, 40, 41],
      "Trail point reuse changed tip geometry",
    );
    world.removeComponent(id, "ActiveHitbox");
    system.update();
    expect(
      !trail.active && trail.history.length === 0,
      "Separate strikes were joined by a stale trail",
    );
  },
];
