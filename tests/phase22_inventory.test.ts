import { Game } from "../core/Game";
import { createPlayer } from "../entities/Archetypes";
import { InventoryComponent } from "../components/Inventory";
import { TimeState } from "../core/Resources";
import { WEAPONS } from "../data/WeaponDefinitions";
import { StaminaComponent } from "../components/Stamina";
import { PlayerInputComponent } from "../components/PlayerInput";
import { CombatComponent } from "../features/combat/CombatComponent";

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}

function getPlayer(game: Game) {
  const results = game.world.query("Inventory", "Stamina", "PlayerInput", "Combat");
  if (results.length === 0) throw new Error("No player found");
  const { id, components } = results[0];
  return {
    id,
    inventory: components[0] as InventoryComponent,
    stamina: components[1] as StaminaComponent,
    input: components[2] as PlayerInputComponent,
    combat: components[3] as CombatComponent,
  };
}

function pressKey(code: string) {
  window.dispatchEvent(new KeyboardEvent("keydown", { code }));
}

function clearWorld(game: Game) {
  const all = game.world.getAllEntities();
  for (const id of all) game.world.destroyEntity(id);
}

export const tests = [
  async function testWeaponSwap(game: Game) {
    clearWorld(game);
    const id = createPlayer(game.world, 0, 0);
    // Force reset inventory to default
    const inventory = game.world.getComponent<InventoryComponent>(id, "Inventory")!;
    inventory.currentWeapon = "longsword";

    // Press 2 (Rapier)
    pressKey("Digit2");
    await runFrames(game, 1);

    if (inventory.currentWeapon !== "rapier")
      throw new Error(`Failed to swap to rapier. Got ${inventory.currentWeapon}`);

    // Press 3 (Greatsword)
    pressKey("Digit3");
    await runFrames(game, 1);

    if ((inventory.currentWeapon as string) !== "greatsword")
      throw new Error("Failed to swap to greatsword");
  },

  async function testWeaponStaminaCost(game: Game) {
    clearWorld(game);

    // Part 1: Greatsword
    let id = createPlayer(game.world, 0, 0);
    let { inventory, stamina, input } = getPlayer(game);

    // Equip Greatsword (Heavy cost 45)
    inventory.currentWeapon = "greatsword";
    stamina.current = 100;

    const time = game.world.getResource<TimeState>(TimeState);
    input.buffer = { action: "heavyAttack", priority: 2, timestamp: time.elapsed };

    await runFrames(game, 1);

    const expected = 100 - WEAPONS["greatsword"].staminaCostHeavy; // 100 - 45 = 55
    if (stamina.current !== expected)
      throw new Error(
        `Greatsword stamina cost wrong. Expected ${expected}, got ${stamina.current}`,
      );

    // Clean up first player to ensure clean state for Dagger test
    game.world.destroyEntity(id);

    // Part 2: Dagger
    id = createPlayer(game.world, 0, 0);
    // Re-fetch components for new entity
    const p2 = getPlayer(game);
    inventory = p2.inventory;
    stamina = p2.stamina;
    input = p2.input;

    // Equip Dagger (Heavy cost 16)
    inventory.currentWeapon = "dagger";
    stamina.current = 100;

    input.buffer = { action: "heavyAttack", priority: 2, timestamp: time.elapsed };

    await runFrames(game, 1);

    const expectedDagger = 100 - WEAPONS["dagger"].staminaCostHeavy; // 100 - 16 = 84
    if (stamina.current !== expectedDagger)
      throw new Error(
        `Dagger stamina cost wrong. Expected ${expectedDagger}, got ${stamina.current}`,
      );
  },

  async function testLockedWeapon(game: Game) {
    clearWorld(game);
    const id = createPlayer(game.world, 0, 0);
    const inventory = game.world.getComponent<InventoryComponent>(id, "Inventory")!;

    inventory.currentWeapon = "longsword";
    // Remove rapier from unlocks
    inventory.unlockedWeapons.delete("rapier");

    pressKey("Digit2");
    await runFrames(game, 1);

    if (inventory.currentWeapon === "rapier") throw new Error("Swapped to locked weapon");
  },
];
