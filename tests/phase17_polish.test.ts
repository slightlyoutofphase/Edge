import { Game } from "../core/Game";
import { PlayerProgress } from "../core/Resources";
import { createTrigger } from "../entities/Archetypes";
import { SpriteCache } from "../utils/SpriteCache";
import { PlayerBonePaths } from "../assets/svg/PlayerSVG";
import { TransformComponent } from "../components/Transform";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  // === Sprite Cache Tests ===
  async function testSpriteCachePopulation(game: Game) {
    SpriteCache.clear();
    // Trigger a render pass by running a frame
    await runFrames(game, 1);

    // Use a known path from assets
    const pathData = PlayerBonePaths["head"];

    // Request it manually to ensure cache logic runs
    const cached = SpriteCache.get(
      pathData.path,
      pathData.fill,
      pathData.stroke,
      pathData.strokeWidth,
    );

    if (!cached) throw new Error("SpriteCache failed to generate bitmap");
    if (!(cached instanceof HTMLCanvasElement)) throw new Error("Cached item is not a canvas");

    // Second call should return same object
    const cached2 = SpriteCache.get(
      pathData.path,
      pathData.fill,
      pathData.stroke,
      pathData.strokeWidth,
    );
    if (cached !== cached2) throw new Error("SpriteCache failed to return cached instance");
  },

  // === Transition Tests ===
  async function testTransitionStateFlow(game: Game) {
    const progress = game.world.getResource<PlayerProgress>(PlayerProgress);
    progress.transitionState = "none";

    // Create transition trigger at 0,0, 100x100
    createTrigger(game.world, 0, 0, 100, 100, "transition", { target: "level2" });

    // Move player to 50,50 to safely intersect trigger (Center of 0-100)
    const players = game.world.query("PlayerInput", "Transform");
    if (players.length > 0) {
      const transform = players[0].components[1] as TransformComponent;
      transform.position.x = 50;
      transform.position.y = 50;
    } else {
      throw new Error("No player found for transition test");
    }

    // Run frame to detect trigger
    await runFrames(game, 1);

    // Should enter fade-out
    if ((progress.transitionState as string) !== "fade-out")
      throw new Error(`Trigger did not start fade-out. State: ${progress.transitionState}`);

    // Advance time to finish fade (1000ms)
    progress.transitionTimer = 16;
    await runFrames(game, 2);

    // Should move to loading -> fade-in
    // Note: loading state is transient in update loop if nextLevelId is set
    if ((progress.transitionState as string) !== "fade-in")
      throw new Error(`Failed to transition to fade-in. State: ${progress.transitionState}`);
    if (progress.currentLevelId !== "level2")
      throw new Error(`Level did not change. Current: ${progress.currentLevelId}`);

    // Advance time to finish fade-in
    progress.transitionTimer = 16;
    await runFrames(game, 2);

    if (progress.transitionState !== "none") throw new Error("Failed to finish transition");
  },
];
