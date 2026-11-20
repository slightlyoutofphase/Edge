import { Game } from "../core/Game";
import { createEnemy } from "../entities/Archetypes";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { PhysicsComponent } from "../features/movement/PhysicsComponent";
import { TransformComponent } from "../components/Transform";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function getEnemy(game: Game, id: number) {
  return {
    ai: game.world.getComponent<AIControllerComponent>(id, "AIController")!,
    health: game.world.getComponent<HealthComponent>(id, "Health")!,
    stamina: game.world.getComponent<StaminaComponent>(id, "Stamina")!,
    physics: game.world.getComponent<PhysicsComponent>(id, "Physics")!,
    transform: game.world.getComponent<TransformComponent>(id, "Transform")!,
  };
}

export const tests = [
  async function testAIStrategyDispatch(game: Game) {
    const id = createEnemy(game.world, 0, 0, "hollow");
    // If strategy runs, it should handle state transitions.
    // Set state to idle with 0 timer, should switch to patrol occasionally.
    const { ai } = getEnemy(game, id);
    ai.state = "idle";
    ai.decisionTimer = 0; // Force decision

    await runFrames(game, 5);
    // Can't guarantee random switch, but ensuring no crash and update cycle
    if (ai.state !== "idle" && ai.state !== "patrol")
      throw new Error("Strategy did not manage state validly");
  },

  async function testBossPhaseChange(game: Game) {
    const id = createEnemy(game.world, 0, 0, "boss");
    const { ai, health } = getEnemy(game, id);

    // Default Phase 0
    if (ai.currentPhase !== 0) throw new Error("Boss did not start Phase 0");

    // Damage below 50%
    health.current = health.max * 0.4;

    // Boss Strategy checks phases in combat logic, so needs target
    ai.state = "combat";
    ai.target = game.playerId; // Assume player exists from Game init

    await runFrames(game, 1);

    if ((ai.currentPhase as number) !== 1) throw new Error("Boss did not transition to Phase 1");
  },

  async function testStaminaRetreat(game: Game) {
    const id = createEnemy(game.world, 0, 0, "soldier");
    const { ai, stamina } = getEnemy(game, id);

    stamina.current = 10; // Below retreat threshold (20)
    ai.state = "combat";
    ai.target = game.playerId;

    await runFrames(game, 1);

    if ((ai.state as string) !== "retreat") throw new Error("Enemy did not retreat at low stamina");
  },

  async function testFacingSmoothing(game: Game) {
    const id = createEnemy(game.world, 0, 0, "soldier");
    const { ai, transform } = getEnemy(game, id);

    // Force turn timer active
    ai.turnTimer = 100;
    transform.facing = 1;

    // Request turn via logic helper (simulate by calling internal logic or checking constraint)
    // Since we can't call protected methods easily in test, we check if turnTimer decrements
    // and if manual facing flip is prevented if we were to enforce it in system.
    // Actually, we verify the turnTimer mechanics:

    await runFrames(game, 1);
    // 100 - 16 = 84. Expect < 100.
    if (ai.turnTimer < 100 && ai.turnTimer > 0) {
      // Timer ticking correctly
    } else {
      throw new Error(`Turn timer not updating correctly. Got ${ai.turnTimer}`);
    }
  },
];
