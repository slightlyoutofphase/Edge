import { Game } from "../core/Game";
import { CombatEventQueue, CombatDirectorState, InputState } from "../core/Resources";

import { createEnemy, createPlayer, createDummy } from "../entities/Archetypes";
import { AIControllerComponent } from "../features/ai/AIControllerComponent";
import { InputAction } from "../core/InputDefinitions";
import { PlayerInputComponent } from "../components/PlayerInput";

import { HealthComponent } from "../components/Health";
import { TransformComponent } from "../components/Transform";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

export const tests = [
  // 1. Architecture: Hit Event Queue
  async function testHitEventQueue(game: Game) {
    const queue = game.world.getResource<CombatEventQueue>(CombatEventQueue);
    const attackerId = createDummy(game.world, 0, 0);
    const targetId = createDummy(game.world, 100, 0);

    // Manually push event
    queue.events.push({
      attackerId,
      targetId,
      damage: 10,
      poiseDamage: 0,
      zone: 2,
      attackType: "light",
      knockback: { x: 0, y: 0 },
      impactPoint: { x: 50, y: 0 },
      isBlockable: true,
    });

    // DamageSystem should process it
    await runFrames(game, 1);

    if (queue.events.length !== 0) throw new Error("Event queue not cleared");

    const health = game.world.getComponent<HealthComponent>(targetId, "Health")!;
    if (health.current >= 100) throw new Error("Damage not applied from event");
  },

  // 2. Architecture: Input Mapping
  async function testInputMapping(game: Game) {
    const inputState = game.world.getResource<InputState>(InputState);
    const player = createPlayer(game.world, 0, 0);
    const playerInput = game.world.getComponent<PlayerInputComponent>(player, "PlayerInput")!;

    // Press Space (Jump)
    pressKey("Space");

    // We let runFrames trigger the update cycle naturally.
    // update() calls inputManager.update(), which moves pending -> pressed.
    // Then InputSystem reads it.
    await runFrames(game, 1);

    // Check system consumption
    if (playerInput.buffer?.action !== "jump")
      throw new Error("Jump input not buffered in component");

    // Note: We cannot verify inputState.isActionPressed here because keysPressed are cleared
    // at the start of the NEXT update, but since we ran one frame, they are currently set?
    // Actually, InputManager clears pending, sets pressed. InputSystem reads pressed.
    // If we inspect inputState NOW, it should have the keys.
    if (!inputState.isActionPressed(InputAction.JUMP))
      throw new Error("Jump action not detected via InputState after frame");
  },

  // 3. AI: Combat Director Token Limits
  async function testCombatDirectorLimits(game: Game) {
    const director = game.world.getResource<CombatDirectorState>(CombatDirectorState);
    const originalLimit = director.maxTokens;
    try {
      director.maxTokens = 1; // Limit to 1 attacker

      const position = game.world.getComponent<TransformComponent>(
        game.playerId,
        "Transform",
      )!.position;
      const e1 = createEnemy(game.world, position.x + 15, position.y, "hollow");
      const e2 = createEnemy(game.world, position.x + 25, position.y, "hollow");

      const ai1 = game.world.getComponent<AIControllerComponent>(e1, "AIController")!;
      const ai2 = game.world.getComponent<AIControllerComponent>(e2, "AIController")!;

      // Force both to combat state and cooldown 0
      ai1.state = "combat";
      ai1.attackCooldownTimer = 0;
      ai1.target = game.playerId;
      ai2.state = "combat";
      ai2.attackCooldownTimer = 0;
      ai2.target = game.playerId;

      await runFrames(game, 2);

      const t1 = ai1.hasAttackToken;
      const t2 = ai2.hasAttackToken;

      if (t1 && t2) throw new Error("Director allowed 2 attackers with maxTokens=1");
      if (!t1 && !t2) throw new Error("Director allowed 0 attackers");
    } finally {
      director.maxTokens = originalLimit;
    }
  },

  // 4. AI: Token Release
  async function testTokenRelease(game: Game) {
    const position = game.world.getComponent<TransformComponent>(
      game.playerId,
      "Transform",
    )!.position;
    const e1 = createEnemy(game.world, position.x + 15, position.y, "hollow");
    const ai1 = game.world.getComponent<AIControllerComponent>(e1, "AIController")!;

    ai1.state = "combat";
    ai1.target = game.playerId;
    ai1.attackCooldownTimer = 0;

    await runFrames(game, 2);

    if (!ai1.hasAttackToken) throw new Error("Enemy failed to acquire token");

    // Simulate attack cooldown (should release token)
    ai1.state = "combat";
    // Need to simulate transition to idle with cooldown to release
    // Director logic: if hasToken && idle && cooldown > 0 -> release
    const combat = game.world.getComponent<any>(e1, "Combat")!;
    combat.attackState = "idle";
    ai1.attackCooldownTimer = 1000;

    await runFrames(game, 1);

    if (ai1.hasAttackToken) throw new Error("Enemy failed to release token on cooldown");
  },
];
