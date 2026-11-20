import { EnemyTagComponent } from "../components/EnemyTag";
import { InventoryComponent } from "../components/Inventory";
import { WEAPONS } from "../data/WeaponDefinitions";
import { WeaponPaths } from "../assets/svg/WeaponSVGs";
import { EnemyBonePaths } from "../assets/svg/EnemySVGs";
import { World } from "../core/World";
import { WeaponTrailComponent } from "../features/visuals/WeaponTrailComponent";
import { SkeletonComponent } from "../features/animation/SkeletonComponent";
import { CombatComponent } from "../features/combat/CombatComponent";

export class WeaponTrailSystem {
  constructor(private world: World) {}

  update() {
    const entities = this.world.query("WeaponTrail", "Skeleton", "Combat");

    for (const { id, components } of entities) {
      const trail = components[0] as WeaponTrailComponent;
      const skeleton = components[1] as SkeletonComponent;
      const combat = components[2] as CombatComponent;

      // Only trail during active frames of attack
      if (this.world.hasComponent(id, "HitStop")) continue;
      const inventory = this.world.getComponent<InventoryComponent>(id, "Inventory");
      const enemy = this.world.getComponent<EnemyTagComponent>(id, "EnemyTag");
      const weaponId = combat.attackTiming?.weapon?.id ?? inventory?.currentWeapon;
      const drawing = weaponId
        ? WeaponPaths[WEAPONS[weaponId]?.svgAsset]
        : enemy
          ? EnemyBonePaths[enemy.enemyType].weapon
          : WeaponPaths["weapon-longsword"];
      if (
        drawing?.tipOffset &&
        (trail.tipOffset.x !== drawing.tipOffset.x || trail.tipOffset.y !== drawing.tipOffset.y)
      ) {
        trail.tipOffset.x = drawing.tipOffset.x;
        trail.tipOffset.y = drawing.tipOffset.y;
      }
      const shouldTrail =
        combat.attackState === "active" && this.world.hasComponent(id, "ActiveHitbox");
      trail.active = shouldTrail;

      if (!shouldTrail) {
        // A multi-hit reset must not connect the previous strike to the next.
        trail.history.length = 0;
        continue;
      }

      const boneMatrix = skeleton.worldTransforms.get(trail.boneId);
      if (!boneMatrix) continue;

      // Compute World Positions
      const tipX =
        boneMatrix.a * trail.tipOffset.x + boneMatrix.c * trail.tipOffset.y + boneMatrix.tx;
      const tipY =
        boneMatrix.b * trail.tipOffset.x + boneMatrix.d * trail.tipOffset.y + boneMatrix.ty;

      const baseX =
        boneMatrix.a * trail.baseOffset.x + boneMatrix.c * trail.baseOffset.y + boneMatrix.tx;
      const baseY =
        boneMatrix.b * trail.baseOffset.x + boneMatrix.d * trail.baseOffset.y + boneMatrix.ty;

      const point =
        trail.maxLength > 0 && trail.history.length === trail.maxLength
          ? trail.history.shift()!
          : { base: { x: 0, y: 0 }, tip: { x: 0, y: 0 } };
      point.base.x = baseX;
      point.base.y = baseY;
      point.tip.x = tipX;
      point.tip.y = tipY;
      trail.history.push(point);

      if (trail.history.length > trail.maxLength) {
        trail.history.shift();
      }
    }
  }
}
