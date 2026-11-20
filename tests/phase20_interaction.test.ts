import { Game } from "../core/Game";
import { createInteractable, createPlayer } from "../entities/Archetypes";
import { InteractableComponent } from "../components/Interactable";
import { InteractionState } from "../core/Resources";
import { InventoryComponent } from "../components/Inventory";
import { AudioSystem } from "../systems/AudioSystem";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function clearWorld(game: Game) {
  const all = game.world.getAllEntities();
  for (const id of all) game.world.destroyEntity(id);
}

function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

export const tests = [
  async function testInteractionPromptDetection(game: Game) {
    clearWorld(game);
    createPlayer(game.world, 0, 0);
    const chest = createInteractable(game.world, 40, 0, "chest", "Open Chest");

    await runFrames(game, 1);

    const state = game.world.getResource<InteractionState>(InteractionState);
    if (state.activePrompt !== "Open Chest")
      throw new Error(`Prompt not active. Got ${state.activePrompt}`);
    if (state.activeEntityId !== chest) throw new Error("Wrong entity active");
  },

  async function testInteractionRange(game: Game) {
    clearWorld(game);
    createPlayer(game.world, 0, 0);
    createInteractable(game.world, 100, 0, "chest", "Open Chest"); // Range is 60

    await runFrames(game, 1);

    const state = game.world.getResource<InteractionState>(InteractionState);
    if (state.activePrompt !== null) throw new Error("Prompt shown out of range");
  },

  async function testInteractionExecution(game: Game) {
    clearWorld(game); // Ensure clean state

    const pId = createPlayer(game.world, 0, 0);
    const inv = game.world.getComponent<InventoryComponent>(pId, "Inventory")!;

    createInteractable(game.world, 30, 0, "chest", "Open", { weaponId: "test_wep" });

    // Use event dispatch so InputManager captures it in pending,
    // and promotes to keysPressed during update()
    pressKey("KeyF");

    await runFrames(game, 1);

    if (!inv.unlockedWeapons.has("test_wep"))
      throw new Error("Interaction failed to unlock weapon");

    const audioSys = game.systems.find((s) => s instanceof AudioSystem) as AudioSystem;
    if (!audioSys.recentPlayed.includes("ui-checkpoint"))
      throw new Error("No sound feedback on interaction");
  },

  async function testInteractionCooldown(game: Game) {
    clearWorld(game);
    createPlayer(game.world, 0, 0);
    const chest = createInteractable(game.world, 30, 0, "lever", "Pull");

    pressKey("KeyF");

    await runFrames(game, 1); // Trigger

    const interactable = game.world.getComponent<InteractableComponent>(chest, "Interactable")!;

    // Check if cooldown was applied by the first interaction
    if (interactable.cooldown < 50) throw new Error("Cooldown not applied after interaction");

    // Attempt re-trigger (should fail due to cooldown)
    // We manually reset isInteracted to allow the logic to attempt it
    interactable.isInteracted = false;

    // Press key again for next frame
    pressKey("KeyF");

    // Capture state before run
    const prevCooldown = interactable.cooldown;

    await runFrames(game, 1);

    // Cooldown should just decrement naturally, not reset to 60 (which happens on successful interact)
    if (interactable.cooldown > prevCooldown)
      throw new Error("Interaction triggered despite cooldown");
  },
];
