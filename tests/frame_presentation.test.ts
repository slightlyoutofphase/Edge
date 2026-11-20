import { Game } from "../core/Game";
import { TimeState, PlayerProgress } from "../core/Resources";
import { RenderSystem } from "../systems/RenderSystem";
import { UISystem } from "../systems/UISystem";
import { PhysicsSystem } from "../features/movement/PhysicsSystem";

function expect(value: boolean, message: string) {
  if (!value) throw new Error(message);
}

function fixture() {
  const game = new Game(document.createElement("canvas"));
  game.startBattle("alpha_hellhound", "none", "alpha_hellhound", "none");
  const counts = { render: 0, ui: 0, steps: [] as number[] };
  for (const system of game.systems) {
    const update = system.update.bind(system);
    if (system instanceof RenderSystem)
      system.update = () => {
        counts.render++;
        update();
      };
    else if (system instanceof UISystem)
      system.update = () => {
        counts.ui++;
        update();
      };
    else if (system instanceof PhysicsSystem)
      system.update = () => {
        counts.steps.push(game.world.getResource<TimeState>(TimeState).delta);
        update();
      };
  }
  return { game, counts };
}

export const tests = [
  async function testLateFramePresentsOnceWhileKeepingBoundedSimulationSteps() {
    const { game, counts } = fixture();
    try {
      game.running = true;
      game.lastTime = 0;
      game.loop(100);
      expect(counts.render === 1 && counts.ui === 1, "A render hitch redraws catch-up states");
      expect(counts.steps.length === 6, "Hitch created an extra floating-point update");
      expect(
        counts.steps.every((dt) => dt > 0 && dt <= 1000 / 60 + 1e-9),
        "Physics step exceeded the integration bound",
      );
      expect(
        Math.abs(game.world.getResource<TimeState>(TimeState).elapsed - 100) < 1e-6,
        "Presentation fix dropped simulation time",
      );
    } finally {
      game.destroy();
    }
  },
  async function testFractionalRefreshRateDoesNotDoubleSceneRendering() {
    const { game, counts } = fixture();
    try {
      game.running = true;
      game.lastTime = 0;
      for (let frame = 1; frame <= 30; frame++) game.loop((frame * 1000) / 59.94);
      expect(counts.render === 30 && counts.ui === 30, "59.94 Hz produced extra scene/UI draws");
      expect(
        counts.steps.every((dt) => dt <= 1000 / 60 + 1e-9),
        "Fractional refresh bypassed the simulation bound",
      );
      expect(
        Math.abs(game.world.getResource<TimeState>(TimeState).elapsed - 30000 / 59.94) < 1e-6,
        "Refresh handling changed elapsed time",
      );
    } finally {
      game.destroy();
    }
  },
  async function testCatchUpRetainsTheExistingPhysicsIntegrationIntervals() {
    const { game, counts } = fixture();
    try {
      game.running = true;
      game.lastTime = 0;
      game.loop(40);
      expect(
        counts.steps.length === 3 && counts.render === 1 && counts.ui === 1,
        "Catch-up changed its simulation/presentation count",
      );
      for (let i = 0; i < 2; i++)
        expect(
          Math.abs(counts.steps[i] - 1000 / 60) < 1e-9,
          "Presentation fix changed established physics steps",
        );
      expect(
        Math.abs(counts.steps[2] - (40 - 2000 / 60)) < 1e-9,
        "Catch-up changed its final partial interval",
      );
    } finally {
      game.destroy();
    }
  },
  async function testDirectGameUpdateStillPresentsAndDeferredUpdatesStillSimulate() {
    const { game, counts } = fixture();
    try {
      game.update(16, false);
      expect(
        counts.render === 0 && counts.ui === 0 && counts.steps.length === 1,
        "Deferred presentation skipped gameplay or drew a scene",
      );
      game.update(16);
      expect(
        counts.render === 1 && counts.ui === 1 && counts.steps.length === 2,
        "Direct updates lost their default presentation",
      );
    } finally {
      game.destroy();
    }
  },
  async function testEditorAndVictoryRespectDeferredPresentation() {
    const { game, counts } = fixture();
    try {
      game.editorMode = true;
      game.update(16, false);
      expect(counts.render === 0, "Editor redraws intermediate catch-up states");
      game.update(16);
      expect(counts.render === 1, "Editor lost its final render");
      game.editorMode = false;
      game.world.getResource<PlayerProgress>(PlayerProgress).isVictory = true;
      game.update(16, false);
      expect(counts.render === 1 && counts.ui === 0, "Victory bypassed deferred presentation");
      game.update(16);
      expect(counts.render === 2 && counts.ui === 1, "Victory lost its final presentation");
    } finally {
      game.destroy();
    }
  },
];
