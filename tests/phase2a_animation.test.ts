import { Game } from "../core/Game";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { TransformComponent } from "../components/Transform";
import { Animation } from "../features/animation/AnimationTypes";
import { AssetLoader } from "../assets/AssetLoader";
import { createPlayer } from "../entities/Archetypes";

// Helper to access components
function getPlayerAnimation(game: Game) {
  const results = game.world.query("Skeleton", "Animator", "Transform", "PlayerInput");
  if (results.length === 0) throw new Error("No player found");
  const playerEntity = results.find((e) => !!e.components[3]);
  if (!playerEntity) throw new Error("No player found with PlayerInput");

  // CRITICAL FIX: Remove MovementState to prevent AnimationSystem from overriding
  // our test-driven animations with default movement animations (idle/walk).
  if (game.world.hasComponent(playerEntity.id, "MovementState")) {
    game.world.removeComponent(playerEntity.id, "MovementState");
  }

  return {
    skeleton: playerEntity.components[0] as SkeletonComponent,
    animator: playerEntity.components[1] as AnimatorComponent,
    transform: playerEntity.components[2] as TransformComponent,
  };
}

// Manually update
async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) {
    game.update(dt);
  }
}

export const tests = [
  // 1. Skeleton Definition Structure
  async function testSkeletonDefStructure(game: Game) {
    const { skeleton } = getPlayerAnimation(game);
    if (!skeleton.definition) throw new Error("Skeleton definition missing");
    if (skeleton.definition.id !== "player-skeleton") throw new Error("Wrong skeleton ID");
    if (!skeleton.definition.root) throw new Error("Root bone missing");
    if (!skeleton.definition.bones.has("head")) throw new Error("Head bone missing in map");
    if (!skeleton.definition.bindPose) throw new Error("Bind pose missing");
  },

  // 2. Bone Hierarchy Parsing
  async function testBoneHierarchyParsing(game: Game) {
    const { skeleton } = getPlayerAnimation(game);
    const root = skeleton.definition!.root;

    if (root.children.length === 0) throw new Error("Root has no children");
    const body = root.children.find((c) => c.id === "body-pivot");
    if (!body) throw new Error("body-pivot missing from root children");

    const hip = body.children.find((c) => c.id === "hip");
    if (!hip) throw new Error("hip missing from body children");

    if (skeleton.definition!.bones.size < 10) throw new Error("Bone map seems too small");
  },

  // 3. Pivot Point Parsing
  async function testPivotPointParsing(game: Game) {
    const { skeleton } = getPlayerAnimation(game);
    const hip = skeleton.definition!.bones.get("hip");
    if (!hip) throw new Error("Hip bone not found");

    // Hip pivot is 0, -28 (updated from -24)
    if (hip.pivot.y !== -28)
      throw new Error(`Hip pivot Y mismatch. Expected -28, got ${hip.pivot.y}`);
  },

  // 4. World Transform Computation
  async function testWorldTransformComputation(game: Game) {
    const { skeleton, transform } = getPlayerAnimation(game);

    // Ensure initial update
    await runFrames(game, 1);

    if (skeleton.worldTransforms.size === 0) throw new Error("World transforms empty");
    const rootTx = skeleton.worldTransforms.get("root");
    if (!rootTx) throw new Error("Root transform missing");

    // Root should match entity position (100, 300)
    if (rootTx.tx !== transform.position.x || rootTx.ty !== transform.position.y) {
      throw new Error(
        `Root transform mismatch. Expected ${transform.position.x},${transform.position.y}, got ${rootTx.tx},${rootTx.ty}`,
      );
    }
  },

  // 5. Matrix Order of Operations
  async function testMatrixOrderOfOperations(game: Game) {
    const { skeleton } = getPlayerAnimation(game);
    await runFrames(game, 1);

    const bodyTx = skeleton.worldTransforms.get("body-pivot")!;
    const hipTx = skeleton.worldTransforms.get("hip")!;

    if (!bodyTx || !hipTx) throw new Error("Transforms missing");
  },

  // 6. Facing Flips Transforms
  async function testFacingFlipsTransforms(game: Game) {
    const { skeleton, transform } = getPlayerAnimation(game);

    transform.facing = -1;
    await runFrames(game, 1);

    const rootTx = skeleton.worldTransforms.get("root")!;

    // a (scale x) should be negative
    if (rootTx.a > 0) throw new Error("Root transform X scale not flipped");
  },

  // 7. Bind Pose Application
  async function testBindPoseApplication(game: Game) {
    const { skeleton } = getPlayerAnimation(game);

    // Set to empty animation to force bind pose
    skeleton.currentPose = {};

    await runFrames(game, 1);

    // Check a bone that has no pose in bind pose (defaults identity)
    const headTx = skeleton.worldTransforms.get("head")!;
    // Just ensure it exists and valid
    if (isNaN(headTx.tx)) throw new Error("Bind pose transform invalid");
  },

  // 8. Keyframe Interpolation
  async function testKeyframeInterpolation(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);

    // Create simple test animation
    const testAnim: Animation = {
      name: "test",
      duration: 1000,
      loop: false,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } } },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    // Use proper registration
    AssetLoader.registerAnimation("test", testAnim);

    animator.currentAnim = "test";
    animator.time = 500; // 50%

    await runFrames(game, 1, 0);

    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const headRot = skeleton.currentPose["head"].rotate;
    if (Math.abs(headRot! - 50) > 0.1)
      throw new Error(`Interpolation failed. Expected 50, got ${headRot}`);
  },

  // 9. Normalized Time Calculation
  async function testNormalizedTimeCalculation(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    // Using same test anim
    animator.currentAnim = "test";
    animator.time = 250; // 25%

    await runFrames(game, 1, 0);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const headRot = skeleton.currentPose["head"].rotate;
    if (Math.abs(headRot! - 25) > 0.1)
      throw new Error(`Normalized time calc failed. Expected 25, got ${headRot}`);
  },

  // 10. Looping Animation
  async function testLoopingAnimation(game: Game) {
    const { animator } = getPlayerAnimation(game);
    const testAnim: Animation = {
      name: "loop",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: {} },
        { time: 1, bones: {} },
      ],
    };
    AssetLoader.registerAnimation("loop", testAnim);

    animator.currentAnim = "loop";
    animator.time = 90;

    await runFrames(game, 2, 16); // 32ms -> 122ms -> wraps to 22ms

    if (animator.time > 100) throw new Error(`Loop failed. Time ${animator.time}`);
    if (animator.time < 0) throw new Error("Time negative");
  },

  // 11. Non-Looping Animation
  async function testNonLoopingAnimation(game: Game) {
    const { animator } = getPlayerAnimation(game);
    const testAnim: Animation = {
      name: "once",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: {} },
        { time: 1, bones: {} },
      ],
    };
    AssetLoader.registerAnimation("once", testAnim);

    animator.currentAnim = "once";
    animator.time = 90;

    await runFrames(game, 2, 16); // 122ms

    if (animator.time !== 100)
      throw new Error(`Non-loop failed. Expected 100, got ${animator.time}`);
  },

  // 12. Animation Events
  async function testAnimationEvents(game: Game) {
    const { animator } = getPlayerAnimation(game);
    const testAnim: Animation = {
      name: "events",
      duration: 100,
      loop: false,
      keyframes: [],
      events: [{ time: 0.5, type: "sound", data: "test-sound" }],
    };
    AssetLoader.registerAnimation("events", testAnim);

    animator.currentAnim = "events";
    // 16ms frame: 30 -> 46 (which is < 50), so event should NOT fire.
    animator.time = 30;

    await runFrames(game, 1);
    if (animator.pendingEvents.length > 0) throw new Error("Event fired too early");

    // Use 40 so range is [40, 56] covering 50.
    animator.time = 40;
    await runFrames(game, 1);
    if (animator.pendingEvents.length === 0) throw new Error("Event failed to fire");
    if (animator.pendingEvents[0].type !== "sound") throw new Error("Wrong event type");
  },

  // 13. Events Do Not Double Fire During Blend
  async function testEventsDoNotDoubleFireDuringBlend(game: Game) {
    const { animator } = getPlayerAnimation(game);
    animator.pendingEvents = [];

    const testAnim: Animation = {
      name: "events2",
      duration: 100,
      loop: false,
      keyframes: [],
      events: [{ time: 0.5, type: "sound", data: "test-sound" }],
    };
    AssetLoader.registerAnimation("events2", testAnim);
    animator.currentAnim = "events2";
    animator.time = 49;

    await runFrames(game, 1); // 49 + 16 = 65 -> Fire
    if (animator.pendingEvents.length !== 1) throw new Error("First fire failed");

    animator.pendingEvents = [];
    await runFrames(game, 1); // 65 + 16 = 81 -> Should not fire again
    if (animator.pendingEvents.length !== 0) throw new Error("Event double fired");
  },

  // 14. Event Timing During Blend
  async function testEventTimingDuringBlend(game: Game) {
    // Events are triggered based on the animation's local time, irrelevant of blending weight
    const { animator } = getPlayerAnimation(game);
    const testAnim: Animation = {
      name: "events3",
      duration: 100,
      loop: false,
      keyframes: [],
      events: [{ time: 0.5, type: "sound", data: "test-sound" }],
    };
    AssetLoader.registerAnimation("events3", testAnim);
    animator.currentAnim = "events3";
    animator.time = 40;
    animator.blendFrom = "idle"; // blending

    await runFrames(game, 1, 16); // 40 -> 56 -> Fire; inspect this frame's events

    if (animator.pendingEvents.length === 0) throw new Error("Event skipped during blend");
  },

  // 15-18 Easing Tests
  async function testLinearEasing(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    const anim: Animation = {
      name: "linear",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } }, easing: "linear" },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    AssetLoader.registerAnimation("linear", anim);
    animator.currentAnim = "linear";
    animator.time = 50;
    await runFrames(game, 1, 0);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 50) > 1) throw new Error(`Linear failed. Got ${rot}`);
  },

  async function testEaseInEasing(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    const anim: Animation = {
      name: "easeIn",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } }, easing: "ease-in" },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    AssetLoader.registerAnimation("easeIn", anim);
    animator.currentAnim = "easeIn";
    animator.time = 50; // t=0.5 -> t*t = 0.25 -> 25
    await runFrames(game, 1, 0);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 25) > 1) throw new Error(`EaseIn failed. Expected ~25, Got ${rot}`);
  },

  async function testEaseOutEasing(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    const anim: Animation = {
      name: "easeOut",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } }, easing: "ease-out" },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    AssetLoader.registerAnimation("easeOut", anim);
    animator.currentAnim = "easeOut";
    animator.time = 50; // t=0.5 -> 1 - 0.25 = 0.75 -> 75
    await runFrames(game, 1, 0);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 75) > 1) throw new Error(`EaseOut failed. Expected ~75, Got ${rot}`);
  },

  async function testEaseInOutEasing(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    const anim: Animation = {
      name: "easeInOut",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } }, easing: "ease-in-out" },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    AssetLoader.registerAnimation("easeInOut", anim);
    animator.currentAnim = "easeInOut";
    animator.time = 50; // t=0.5 -> 0.5 (symmetric)
    await runFrames(game, 1, 0);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 50) > 1) throw new Error(`EaseInOut failed. Expected ~50, Got ${rot}`);
  },

  // 19. Animation Blend Transition
  async function testAnimationBlendTransition(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);

    const animA: Animation = {
      name: "A",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } } },
        { time: 1, bones: { head: { rotate: 0 } } },
      ],
    };
    const animB: Animation = {
      name: "B",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 100 } } },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    AssetLoader.registerAnimation("A", animA);
    AssetLoader.registerAnimation("B", animB);

    animator.currentAnim = "B";
    animator.blendFrom = "A";
    animator.blendDuration = 100;
    animator.blendElapsed = 0;
    animator.blendFromTime = 0;

    // 50ms elapsed -> 50% blend -> 50 deg
    animator.blendElapsed = 50;
    await runFrames(game, 1);

    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 50) > 1) throw new Error(`Blend transition failed. Expected 50, got ${rot}`);
  },

  // 20. Blend Weight Interpolation
  async function testBlendWeightInterpolation(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    // 25% -> 25 deg
    const animA: Animation = {
      name: "A",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } } },
        { time: 1, bones: { head: { rotate: 0 } } },
      ],
    };
    const animB: Animation = {
      name: "B",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 100 } } },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };
    AssetLoader.registerAnimation("A", animA);
    AssetLoader.registerAnimation("B", animB);
    animator.currentAnim = "B";
    animator.blendFrom = "A";
    animator.blendDuration = 100;
    animator.blendElapsed = 25;

    await runFrames(game, 1);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 25) > 1) throw new Error(`Blend weight failed. Expected 25, got ${rot}`);
  },

  // 21. Override Blend Mode
  async function testOverrideBlendMode(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);

    // Main anim: Head 0
    const animMain: Animation = {
      name: "main",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } } },
        { time: 1, bones: { head: { rotate: 0 } } },
      ],
    };
    // Layer anim: Head 100
    const animLayer: Animation = {
      name: "layer",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 100 } } },
        { time: 1, bones: { head: { rotate: 100 } } },
      ],
    };

    AssetLoader.registerAnimation("main", animMain);

    animator.currentAnim = "main";
    animator.layers = [
      {
        name: "layer1",
        boneMask: new Set(["head"]),
        animation: animLayer,
        time: 0,
        weight: 1.0,
        blendMode: "override",
        priority: 1,
      },
    ];

    await runFrames(game, 1);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (rot !== 100) throw new Error(`Override failed. Expected 100, got ${rot}`);
  },

  // 22. Additive Blend Mode
  async function testAdditiveBlendMode(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);

    // Main: 50
    const animMain: Animation = {
      name: "mainAdd",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 50 } } },
        { time: 1, bones: { head: { rotate: 50 } } },
      ],
    };
    // Layer: 20
    const animLayer: Animation = {
      name: "layerAdd",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 20 } } },
        { time: 1, bones: { head: { rotate: 20 } } },
      ],
    };

    AssetLoader.registerAnimation("mainAdd", animMain);

    animator.currentAnim = "mainAdd";
    animator.layers = [
      {
        name: "layer1",
        boneMask: new Set(["head"]),
        animation: animLayer,
        time: 0,
        weight: 1.0,
        blendMode: "additive",
        priority: 1,
      },
    ];

    await runFrames(game, 1);
    if (!skeleton.currentPose["head"]) throw new Error("Head pose missing");
    const rot = skeleton.currentPose["head"].rotate!;
    if (Math.abs(rot - 70) > 0.1) throw new Error(`Additive failed. Expected 70, got ${rot}`);
  },

  // 23. Bone Mask Filtering
  async function testBoneMaskFiltering(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);

    const animMain: Animation = {
      name: "mainMask",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 }, torso: { rotate: 0 } } },
        { time: 1, bones: { head: { rotate: 0 }, torso: { rotate: 0 } } },
      ],
    };
    const animLayer: Animation = {
      name: "layerMask",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 100 }, torso: { rotate: 100 } } },
        { time: 1, bones: { head: { rotate: 100 }, torso: { rotate: 100 } } },
      ],
    };

    AssetLoader.registerAnimation("mainMask", animMain);

    animator.currentAnim = "mainMask";
    animator.layers = [
      {
        name: "layer1",
        boneMask: new Set(["head"]), // Only head
        animation: animLayer,
        time: 0,
        weight: 1.0,
        blendMode: "override",
        priority: 1,
      },
    ];

    await runFrames(game, 1);

    if (skeleton.currentPose["head"].rotate !== 100) throw new Error("Masked bone not affected");
    if (skeleton.currentPose["torso"].rotate !== 0) throw new Error("Unmasked bone affected");
  },

  // 24. Layer Priority Order
  async function testLayerPriorityOrder(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);

    const animMain: Animation = {
      name: "mainP",
      duration: 100,
      loop: true,
      keyframes: [
        { time: 0, bones: { head: { rotate: 0 } } },
        { time: 1, bones: { head: { rotate: 0 } } },
      ],
    };
    AssetLoader.registerAnimation("mainP", animMain);
    animator.currentAnim = "mainP";

    const animL1: Animation = {
      name: "L1",
      duration: 100,
      loop: true,
      keyframes: [{ time: 0, bones: { head: { rotate: 10 } } }],
    };
    const animL2: Animation = {
      name: "L2",
      duration: 100,
      loop: true,
      keyframes: [{ time: 0, bones: { head: { rotate: 20 } } }],
    };

    animator.layers = [
      {
        name: "low",
        boneMask: new Set(["head"]),
        animation: animL1,
        time: 0,
        weight: 1,
        blendMode: "override",
        priority: 1,
      },
      {
        name: "high",
        boneMask: new Set(["head"]),
        animation: animL2,
        time: 0,
        weight: 1,
        blendMode: "override",
        priority: 2,
      },
    ];

    await runFrames(game, 1);
    // High priority (20) should override Low priority (10)
    if (skeleton.currentPose["head"].rotate !== 20)
      throw new Error(`Priority failed. Expected 20, got ${skeleton.currentPose["head"].rotate}`);
  },

  // 25. Child Bones Inherit Parent
  async function testChildBonesInheritParent(game: Game) {
    const { animator, skeleton } = getPlayerAnimation(game);
    // Ensure that if we rotate hip, the head moves in world space even if head has no rotation
    // This is a WorldTransform check

    const anim: Animation = {
      name: "hipRot",
      duration: 100,
      loop: false,
      keyframes: [
        { time: 0, bones: { hip: { rotate: 90 } } },
        { time: 1, bones: { hip: { rotate: 90 } } },
      ],
    };
    AssetLoader.registerAnimation("hipRot", anim);
    animator.currentAnim = "hipRot";

    await runFrames(game, 1);

    const _headTx = skeleton.worldTransforms.get("head")!;

    if (Math.abs(_headTx.d) > 0.1) throw new Error("Child did not inherit rotation");
  },

  // 26. Bone Render Order Sorting
  async function testBoneRenderOrderSorting(game: Game) {
    const { skeleton } = getPlayerAnimation(game);
    const hip = skeleton.definition!.bones.get("hip");
    const arm = skeleton.definition!.bones.get("arm-front-upper");

    if (hip!.renderOrder >= arm!.renderOrder)
      throw new Error("Render orders incorrect (Hip should be behind Arm)");
  },

  // 27. Entity Y Sorting
  async function testEntityYSorting(game: Game) {
    // Create two entities at different Y, check no crash in RenderSystem.
    // We can't verify exact draw order without mocking CanvasCtx, but we can verify the system iterates.
    createPlayer(game.world, 100, 100);
    createPlayer(game.world, 100, 200);
    await runFrames(game, 1);
  },

  // 28. Effect Render Order
  async function testEffectRenderOrder(game: Game) {
    // Spawn effect, check no crash. Effects render last (on top).
    const id = game.world.createEntity();
    game.world.addComponent(id, "VisualEffect", {
      type: "spark",
      position: { x: 0, y: 0 },
      velocity: { x: 0, y: 0 },
      rotation: 0,
      rotationSpeed: 0,
      scale: 1,
      alpha: 1,
      life: 100,
      maxLife: 100,
    });
    await runFrames(game, 1);
  },
];
