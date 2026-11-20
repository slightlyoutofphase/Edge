import { World } from "../core/World";
import { InteractionState, InputState, PlayerProgress, TimeState } from "../core/Resources";
import { InteractableComponent } from "../components/Interactable";
import { TransformComponent } from "../components/Transform";
import { InputAction } from "../core/InputDefinitions";
import { InventoryComponent } from "../components/Inventory";
import { SoundRequestComponent } from "../components/SoundRequest";
import { HealthComponent } from "../components/Health";
import { StaminaComponent } from "../components/Stamina";
import { vec2Len, vec2Sub } from "../utils/Vec2";

export class InteractionSystem {
  constructor(private world: World) {}

  update() {
    const input = this.world.getResource<InputState>(InputState);
    const interactionState = this.world.getResource<InteractionState>(InteractionState);
    const progress = this.world.getResource<PlayerProgress>(PlayerProgress);

    // Reset UI state
    interactionState.activePrompt = null;
    interactionState.activeEntityId = null;

    if (interactionState.interactionTimer > 0) {
      interactionState.interactionTimer = Math.max(
        0,
        interactionState.interactionTimer - this.world.getResource<TimeState>(TimeState).delta,
      );
    }

    const players = this.world.query("PlayerInput", "Transform", "Inventory");
    if (players.length === 0) return;

    const { id: playerId, components } = players[0];
    if (
      this.world.getComponent<HealthComponent>(playerId, "Health")?.isDead ||
      this.world.hasComponent(playerId, "HitStop")
    )
      return;
    const pTrans = components[1] as TransformComponent;
    const inventory = components[2] as InventoryComponent;

    // Find nearest interactable
    const interactables = this.world.query("Interactable", "Transform");
    let nearestId = -1;
    let nearestDist = Infinity;
    let nearestComp: InteractableComponent | null = null;

    for (const { id, components: iComps } of interactables) {
      const interactable = iComps[0] as InteractableComponent;
      const iTrans = iComps[1] as TransformComponent;

      if (interactable.cooldown > 0)
        interactable.cooldown = Math.max(
          0,
          interactable.cooldown - this.world.getResource<TimeState>(TimeState).delta,
        );

      // Distance Check
      const dist = vec2Len(vec2Sub(pTrans.position, iTrans.position));
      if (dist < interactable.range && dist < nearestDist) {
        nearestDist = dist;
        nearestId = id;
        nearestComp = interactable;
      }
    }

    if (nearestComp && nearestId !== -1) {
      if (!nearestComp.isInteracted || nearestComp.type === "bonfire") {
        interactionState.activePrompt = nearestComp.prompt;
        interactionState.activeEntityId = nearestId;

        // Handle Input
        if (
          input.isActionPressed(InputAction.INTERACT) &&
          nearestComp.cooldown <= 0 &&
          interactionState.interactionTimer <= 0
        ) {
          this.performInteraction(nearestComp, nearestId, playerId, inventory, progress);
          interactionState.interactionTimer = 500; // ms
        }
      }
    }
  }

  private performInteraction(
    interactable: InteractableComponent,
    interactableId: number,
    playerId: number,
    inventory: InventoryComponent,
    progress: PlayerProgress,
  ) {
    interactable.cooldown = 1000; // ms

    // Sound feedback
    let soundReq = this.world.getComponent<SoundRequestComponent>(playerId, "SoundRequest");
    if (!soundReq) {
      soundReq = { requests: [] };
      this.world.addComponent(playerId, "SoundRequest", soundReq);
    }

    if (interactable.type === "chest") {
      if (!interactable.isInteracted) {
        interactable.isInteracted = true;
        const weaponId = interactable.data?.weaponId;
        if (weaponId) {
          inventory.unlockedWeapons.add(weaponId);
          console.log(`Unlocked weapon: ${weaponId}`);
          soundReq.requests.push({ id: "ui-checkpoint" }); // Reuse generic success sound
          // Update visual asset
          const platform = this.world.getComponent<any>(interactableId, "Platform");
          if (platform) platform.asset = "chest-open";
        }
      }
    } else if (interactable.type === "bonfire") {
      // Heal
      const health = this.world.getComponent<HealthComponent>(playerId, "Health");
      const stamina = this.world.getComponent<StaminaComponent>(playerId, "Stamina");
      if (health) health.current = health.max;
      if (stamina) stamina.current = stamina.max;

      soundReq.requests.push({ id: "ui-checkpoint" });
      console.log("Bonfire rested. Health restored.");
      // Logic for respawning enemies would go here (reset level)
    } else if (interactable.type === "lever") {
      if (!interactable.isInteracted) {
        interactable.isInteracted = true;
        soundReq.requests.push({ id: "ui-menu" });
        // Handle trigger logic if needed
      }
    }
    if (interactable.isInteracted && interactable.persistenceId)
      progress.interactedObjects.add(interactable.persistenceId);
  }
}
