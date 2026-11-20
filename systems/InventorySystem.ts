import { World } from "../core/World";
import { InventoryComponent } from "../components/Inventory";
import { InputState } from "../core/Resources";
import { InputAction } from "../core/InputDefinitions";
import { WEAPONS } from "../data/WeaponDefinitions";
import { SoundRequestComponent } from "../components/SoundRequest";
import { HealthComponent } from "../components/Health";
import { CombatComponent } from "../features/combat/CombatComponent";

export class InventorySystem {
  constructor(private world: World) {}

  update() {
    const input = this.world.getResource<InputState>(InputState);
    const players = this.world.query("Inventory", "PlayerInput");

    for (const { id, components } of players) {
      if (
        this.world.getComponent<HealthComponent>(id, "Health")?.isDead ||
        this.world.hasComponent(id, "HitStop") ||
        (this.world.getComponent<CombatComponent>(id, "Combat")?.attackState ?? "idle") !== "idle"
      )
        continue;
      const inventory = components[0] as InventoryComponent;

      let targetWeapon: string | null = null;

      if (input.isActionPressed(InputAction.WEAPON_1)) targetWeapon = "longsword";
      if (input.isActionPressed(InputAction.WEAPON_2)) targetWeapon = "rapier";
      if (input.isActionPressed(InputAction.WEAPON_3)) targetWeapon = "greatsword";
      if (input.isActionPressed(InputAction.WEAPON_4)) targetWeapon = "dagger";

      if (
        targetWeapon &&
        inventory.currentWeapon !== targetWeapon &&
        inventory.unlockedWeapons.has(targetWeapon)
      ) {
        // Verify definition exists
        if (WEAPONS[targetWeapon]) {
          inventory.currentWeapon = targetWeapon;

          // Add UI sound feedback
          let soundReq = this.world.getComponent<SoundRequestComponent>(id, "SoundRequest");
          if (!soundReq) {
            soundReq = { requests: [] };
            this.world.addComponent(id, "SoundRequest", soundReq);
          }
          soundReq.requests.push({ id: "ui-menu" }); // Reuse menu click sound for now
        }
      }
    }
  }
}
