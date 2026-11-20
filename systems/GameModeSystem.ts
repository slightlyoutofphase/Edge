import { World } from "../core/World";
import { BattleState, TimeState } from "../core/Resources";
import { HealthComponent } from "../components/Health";
import { FactionComponent } from "../components/Faction";

export class GameModeSystem {
  private checkTimer: number = 0;

  constructor(private world: World) {}

  update() {
    const battle = this.world.getResource<BattleState>(BattleState);
    if (!battle.isActive || battle.winner) return;

    const entities = this.world.query("Health", "Faction");
    let redAlive = 0;
    let blueAlive = 0;
    let hasCombatants = false;

    for (const e of entities) {
      const health = e.components[0] as HealthComponent;
      const faction = e.components[1] as FactionComponent;

      if (faction.team === 3 || faction.team === 4) {
        hasCombatants = true;
        if (!health.isDead) {
          if (faction.team === 3) redAlive++;
          if (faction.team === 4) blueAlive++;
        }
      }
    }

    // Update counts for UI
    battle.redCount = redAlive;
    battle.blueCount = blueAlive;

    // Check win condition every 500ms
    const time = this.world.getResource<TimeState>(TimeState);
    this.checkTimer += time?.delta ?? 1000 / 60;
    if (this.checkTimer < 500) return;
    this.checkTimer %= 500;

    // Only decide winner if we actually started with combatants
    if (hasCombatants) {
      if (redAlive === 0 || blueAlive === 0) {
        if (redAlive > 0) {
          battle.winner = "RED TEAM";
        } else if (blueAlive > 0) {
          battle.winner = "BLUE TEAM";
        } else {
          battle.winner = "DRAW";
        }
      }
    }
  }

  reset() {
    const battle = this.world.getResource<BattleState>(BattleState);
    battle.isActive = false;
    battle.winner = null;
    battle.redCount = 0;
    battle.blueCount = 0;
    this.checkTimer = 0;
  }
}
