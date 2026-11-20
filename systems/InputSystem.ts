import { World } from "../core/World";
import { InputState, TimeState } from "../core/Resources";
import { PlayerInputComponent } from "../components/PlayerInput";
import { PLAYER_STATS } from "../core/Constants";
import { InputAction } from "../core/InputDefinitions";

export class InputSystem {
  constructor(private world: World) {}

  update() {
    const inputState = this.world.getResource<InputState>(InputState);
    const timeState = this.world.getResource<TimeState>(TimeState);
    const players = this.world.query("PlayerInput");

    const now = timeState.elapsed;

    for (const { components } of players) {
      const playerInput = components[0] as PlayerInputComponent;

      // Clear expired buffer
      if (playerInput.buffer && now - playerInput.buffer.timestamp > PLAYER_STATS.inputBuffer) {
        playerInput.buffer = null;
      }

      // Buffer Jump
      if (inputState.isActionPressed(InputAction.JUMP)) {
        this.bufferInput(playerInput, "jump", 1, now);
      }

      // Buffer Roll
      if (inputState.isActionPressed(InputAction.ROLL)) {
        this.bufferInput(playerInput, "roll", 3, now, {
          moveLeft: inputState.isActionDown(InputAction.MOVE_LEFT),
          moveRight: inputState.isActionDown(InputAction.MOVE_RIGHT),
        });
      }

      // Buffer Light Attack
      if (inputState.isActionPressed(InputAction.ATTACK_LIGHT)) {
        this.bufferInput(playerInput, "lightAttack", 2, now);
      }

      // Buffer Heavy Attack
      if (inputState.isActionPressed(InputAction.ATTACK_HEAVY)) {
        this.bufferInput(playerInput, "heavyAttack", 2, now);
      }
    }
  }

  private bufferInput(
    input: PlayerInputComponent,
    action: "jump" | "roll" | "lightAttack" | "heavyAttack",
    priority: number,
    time: number,
    directions?: { moveLeft?: boolean; moveRight?: boolean },
  ) {
    if (!input.buffer || priority >= input.buffer.priority) {
      input.buffer = { action, priority, timestamp: time, ...directions };
    }
  }
}
