import { Game } from "../core/Game";
import { BattleState, CameraState, PlayerProgress } from "../core/Resources";

// These check engine state affected by the UI; browser layout needs DOM tests.
export const tests = [
  async function testCanvasViewportTracksResize(game: Game) {
    const width = game.canvas.width,
      height = game.canvas.height;
    try {
      game.canvas.width = 640;
      game.canvas.height = 360;
      game.update(16);
      const viewport = game.world.getResource<CameraState>(CameraState).viewport;
      if (viewport.x !== 640 || viewport.y !== 360)
        throw new Error("Camera viewport ignored canvas resize");
    } finally {
      game.canvas.width = width;
      game.canvas.height = height;
    }
  },
  async function testArenaSetupCreatesExpectedTeams(game: Game) {
    game.startBattle("hollow", "none", "soldier", "none");
    for (let i = 0; i < 30; i++) game.update(16);
    const battle = game.world.getResource<BattleState>(BattleState);
    if (!battle.isActive || battle.redCount !== 1 || battle.blueCount !== 1)
      throw new Error("Arena setup did not create the selected teams");
  },
  async function testDirectLoadUpdatesDisplayedLevel(game: Game) {
    game.loadLevel("level2");
    if (
      game.world.getResource<PlayerProgress>(PlayerProgress).currentLevelId !== "level2" ||
      !game.playerId ||
      !game.world.hasComponent(game.playerId, "PlayerInput")
    )
      throw new Error("Direct load did not leave a usable player handle");
  },
];
