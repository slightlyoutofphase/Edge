import { Game } from "../core/Game";
import { createEnemy, createPlayer, createPlatform } from "../entities/Archetypes";
import { TransformComponent } from "../components/Transform";
import { CombatComponent } from "../features/combat/CombatComponent";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { HealthComponent } from "../components/Health";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

export const tests = [
  async function testDuelistBackstepAvoidance(game: Game) {
    // Setup: Floor
    createPlatform(game.world, -500, 400, 2000, 50, "solid");

    // Player (Attacker)
    const player = createPlayer(game.world, 0, 400);
    const pCombat = game.world.getComponent<CombatComponent>(player, "Combat")!;
    const pTrans = game.world.getComponent<TransformComponent>(player, "Transform")!;

    // Duelist (Defender)
    const duelist = createEnemy(game.world, 50, 400, "duelist"); // Close range (50px)
    const dAi = game.world.getComponent<AIControllerComponent>(duelist, "AIController")!;
    const dMovement = game.world.getComponent<MovementStateComponent>(duelist, "MovementState")!;
    const dTrans = game.world.getComponent<TransformComponent>(duelist, "Transform")!;
    const dHealth = game.world.getComponent<HealthComponent>(duelist, "Health")!;
    const dPhys = game.world.getComponent<any>(duelist, "Physics")!;

    // Setup State
    dAi.target = player;
    dAi.state = "combat";
    dAi.dodgeCooldownTimer = 0;
    dAi.attackCooldownTimer = 10000; // Keep this fixture defensive during observation.
    dPhys.grounded = true;

    // Force Player to face Duelist and start Attack Windup
    pTrans.facing = 1;
    pCombat.attackState = "windup";
    pCombat.attackTimer = 250; // Leave time to observe before the evasion window.

    // Force RNG to trigger backstep (mock random)
    const originalRandom = Math.random;
    Math.random = () => 0.1; // < 0.4 triggers dodge

    try {
      await runFrames(game, 7);
    } finally {
      // Restore random
      Math.random = originalRandom;
    }

    // Verify
    if (dMovement.current !== "backstep")
      throw new Error(`Duelist did not backstep from windup. State: ${dMovement.current}`);
    if (dHealth.invulnTimer <= 0) throw new Error("Duelist has no i-frames during evasion");

    // Facing check: Duelist should face Player (Left, -1) so backstep moves Right (+X)
    if (dTrans.facing !== -1)
      throw new Error(`Duelist facing wrong way for backstep. Facing: ${dTrans.facing}`);
  },
];
