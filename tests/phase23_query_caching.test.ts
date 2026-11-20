import { Game } from "../core/Game";
import { World } from "../core/World";

// Helper to access private members for testing if necessary,
// or verify via behavior (reference equality).
// We use behavior verification (reference equality of returned arrays).

export const tests = [
  async function testQueryCachingBasic(_game: Game) {
    const world = new World();
    const e1 = world.createEntity();
    world.addComponent(e1, "A", { val: 1 });
    world.addComponent(e1, "B", { val: 2 });

    const r1 = world.query("A", "B");
    const r2 = world.query("A", "B");

    if (r1.length !== 1) throw new Error("Query failed basic retrieval");
    if (r1 !== r2) throw new Error("Query did not return cached array reference");
  },

  async function testQueryOrderSensitivity(_game: Game) {
    const world = new World();
    const e1 = world.createEntity();
    const compA = { name: "A" };
    const compB = { name: "B" };

    world.addComponent(e1, "A", compA);
    world.addComponent(e1, "B", compB);

    const r1 = world.query("A", "B");
    const r2 = world.query("B", "A");

    // Check content order
    if (r1[0].components[0] !== compA) throw new Error("Order A,B returned wrong first component");
    if (r2[0].components[0] !== compB) throw new Error("Order B,A returned wrong first component");

    // Check they are distinct arrays (since signatures differ)
    if (r1 === r2) throw new Error("Query cache should not treat different orders as same key");
  },

  async function testInvalidationOnAddComponent(_game: Game) {
    const world = new World();
    const e1 = world.createEntity();
    world.addComponent(e1, "A", {});

    const r1 = world.query("A");
    if (r1.length !== 1) throw new Error("Initial query wrong");

    // Add B to e1
    world.addComponent(e1, "B", {});

    // A query depends only on the component names it contains.
    const r2 = world.query("A");
    if (r1 !== r2) throw new Error("Unrelated query cache was invalidated on addComponent");

    // Check new query
    const r3 = world.query("A", "B");
    if (r3.length !== 1) throw new Error("New query failed to find entity");
  },

  async function testInvalidationOnRemoveComponent(_game: Game) {
    const world = new World();
    const e1 = world.createEntity();
    world.addComponent(e1, "A", {});
    world.addComponent(e1, "B", {});

    const r1 = world.query("A", "B");
    if (r1.length !== 1) throw new Error("Setup failed");

    world.removeComponent(e1, "B");

    const r2 = world.query("A", "B"); // Should be empty
    if (r2.length !== 0) throw new Error("Remove component did not update query result");
    if (r1 === r2) throw new Error("Cache returned stale array");
  },

  async function testInvalidationOnDestroyEntity(_game: Game) {
    const world = new World();
    const e1 = world.createEntity();
    world.addComponent(e1, "A", {});

    const r1 = world.query("A");
    if (r1.length !== 1) throw new Error("Setup failed");

    world.destroyEntity(e1);

    const r2 = world.query("A");
    if (r2.length !== 0) throw new Error("Destroy entity did not update query");
    if (r1 === r2) throw new Error("Cache returned stale array");
  },

  async function testStableFramePerformance(_game: Game) {
    const world = new World();
    for (let i = 0; i < 100; i++) {
      const e = world.createEntity();
      world.addComponent(e, "Transform", { x: i });
      world.addComponent(e, "Physics", { v: 0 });
    }

    // Frame 1: Build Cache

    const r1 = world.query("Transform", "Physics");

    // Frame 2: Read Cache

    const r2 = world.query("Transform", "Physics");

    if (r1 !== r2) throw new Error("Cache not stable");
  },
];
