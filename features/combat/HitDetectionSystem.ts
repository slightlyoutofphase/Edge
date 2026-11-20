import { World } from "../../core/World";
import { ActiveHitboxComponent, HitboxSweepComponent } from "./ActiveHitboxComponent";
import { ColliderComponent } from "../../components/Collider";
import { TransformComponent } from "../../components/Transform";
import { TimeState, CombatEventQueue, SpatialGridState } from "../../core/Resources";
import { PlatformComponent } from "../../components/Platform";
import { FactionComponent } from "../../components/Faction";
import { HealthComponent } from "../../components/Health";
import { CombatComponent } from "./CombatComponent";
import { AABB, aabbIntersects } from "../../utils/AABB";
import {
  hitboxShape,
  shapeBounds,
  interpolateShape,
  sweptContact,
  sweptShapeContact,
  HitboxShape,
} from "./HitboxGeometry";
import { actorContacts, defensiveWeapon } from "./ContactGeometry";
import { facingAttacker } from "../ai/CombatReach";
import { SpatialHashGrid } from "../../utils/SpatialHashGrid";
import { EnemyTagComponent } from "../../components/EnemyTag";
import { isQuadruped } from "../../data/EnemyTypes";

export class HitDetectionSystem {
  private queryBuffer: number[] = [];
  private terrainBuffer: number[] = [];
  private contactGrid = new SpatialHashGrid(128);
  private history = new WeakMap<
    ActiveHitboxComponent,
    { shape: HitboxShape; x: number; y: number; facing: number }
  >();

  constructor(private world: World) {}

  private bounds(id: number, box: AABB): AABB {
    const t = this.world.getComponent<TransformComponent>(id, "Transform")!;
    return {
      x: t.position.x + box.x * Math.abs(t.scale.x),
      y: t.position.y + box.y * t.scale.y,
      width: box.width * Math.abs(t.scale.x),
      height: box.height * t.scale.y,
    };
  }

  update() {
    const time = this.world.getResource<TimeState>(TimeState);
    const events = this.world.getResource<CombatEventQueue>(CombatEventQueue).events;
    const grids = this.world.getResource<SpatialGridState>(SpatialGridState);
    if (time.delta < 0) return;

    // Damage shapes can extend outside the locomotion collider during a pose.
    // A separate tiny broadphase keeps those contacts independent of movement.
    this.contactGrid.clear();
    for (const {
      id,
      components: [health],
    } of this.world.query("Health", "Collider", "Transform")) {
      if ((health as HealthComponent).isDead || (health as HealthComponent).current <= 0) continue;
      const body = actorContacts(this.world, id).bounds,
        weapon = defensiveWeapon(this.world, id);
      let bounds = body;
      if (weapon) {
        const w = shapeBounds(weapon),
          x = Math.min(body.x, w.x),
          y = Math.min(body.y, w.y);
        bounds = {
          x,
          y,
          width: Math.max(body.x + body.width, w.x + w.width) - x,
          height: Math.max(body.y + body.height, w.y + w.height) - y,
        };
      }
      this.contactGrid.insert(id, bounds);
    }

    const hitboxes = this.world
      .query("ActiveHitbox", "Transform")
      .map(({ id, components: [hb, t] }) => ({
        id,
        hitbox: hb as ActiveHitboxComponent,
        transform: t as TransformComponent,
      }));
    for (const {
      id,
      components: [s, t],
    } of this.world.query("HitboxSweep", "Transform")) {
      for (const hitbox of (s as HitboxSweepComponent).hitboxes)
        hitboxes.push({ id, hitbox, transform: t as TransformComponent });
    }
    hitboxes.sort(
      (a, b) =>
        a.id - b.id || (a.hitbox.frameSweep?.start ?? 0) - (b.hitbox.frameSweep?.start ?? 0),
    );
    const recoiled = new Set<number>();
    const weaponSweeps: {
      hitbox: ActiveHitboxComponent;
      from: HitboxShape;
      to: HitboxShape;
      start: number;
      end: number;
      terrain?: number;
    }[] = [];
    for (const { id, hitbox, transform } of hitboxes) {
      if (recoiled.has(hitbox.sourceEntityId)) continue;
      if (this.world.hasComponent(hitbox.sourceEntityId, "HitStop")) {
        this.world.removeComponent(id, "HitboxSweep");
        this.history.delete(hitbox);
        delete hitbox.frameSweep;
        continue;
      }
      const combat = this.world.getComponent<CombatComponent>(hitbox.sourceEntityId, "Combat");
      if (
        combat?.attackState === "stagger" ||
        this.world.getComponent<HealthComponent>(hitbox.sourceEntityId, "Health")?.isDead
      ) {
        this.world.removeComponent(id, "ActiveHitbox");
        this.world.removeComponent(id, "HitboxSweep");
        this.history.delete(hitbox);
        continue;
      }
      const current = hitboxShape(this.world, hitbox, transform),
        old = this.history.get(hitbox);
      const frame = hitbox.frameSweep;
      let previous = frame?.from ?? old?.shape ?? current;
      // A new component starts a new swing. Facing flips, teleports and hitstop
      // must never bridge unrelated poses with a damaging sweep.
      if (
        frame?.reset ||
        (old &&
          (old.facing !== transform.facing ||
            Math.hypot(old.x - transform.position.x, old.y - transform.position.y) > 128))
      )
        previous = current;
      if (
        !old &&
        Math.hypot(previous.center.x - current.center.x, previous.center.y - current.center.y) >
          400 * Math.max(1, Math.abs(transform.scale.x))
      )
        previous = current;
      const from = frame ? interpolateShape(previous, current, frame.start) : previous;
      const to = frame ? interpolateShape(previous, current, frame.end) : current;
      const art = actorContacts(this.world, hitbox.sourceEntityId);
      const type = this.world.getComponent<EnemyTagComponent>(
        hitbox.sourceEntityId,
        "EnemyTag",
      )?.enemyType;
      let weaponSweep: (typeof weaponSweeps)[number] | undefined;
      if (hitbox.attachedToBone === "weapon" && art.weapon && !isQuadruped(type ?? "player")) {
        weaponSweep = {
          hitbox,
          from: frame?.reset ? art.weapon : (art.previousWeapon ?? art.weapon),
          to: art.weapon,
          start: frame?.start ?? 0,
          end: frame?.end ?? 1,
        };
        weaponSweeps.push(weaponSweep);
      }
      const a = shapeBounds(from),
        b = shapeBounds(to);
      const query = {
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
        height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
      };
      const faction = this.world.getComponent<FactionComponent>(hitbox.sourceEntityId, "Faction");

      // Entity-relative area effects (the Alpha's ground slam) retain their
      // intended behavior. Bone-attached melee and player weapons recoil.
      const canRecoil =
        !!hitbox.attachedToBone || this.world.hasComponent(hitbox.sourceEntityId, "PlayerInput");
      const walls: AABB[] = [];
      let terrainContact: ReturnType<typeof sweptContact>;
      let terrainNormal: { x: number; y: number } | undefined;
      if (canRecoil) {
        const terrainQuery = {
          ...query,
          x: Math.min(query.x, transform.position.x),
          width:
            Math.max(query.x + query.width, transform.position.x) -
            Math.min(query.x, transform.position.x),
        };
        for (const envId of grids.staticGrid.query(terrainQuery, this.terrainBuffer)) {
          const platform = this.world.getComponent<PlatformComponent>(envId, "Platform");
          const collider = this.world.getComponent<ColliderComponent>(envId, "Collider");
          if (
            !platform ||
            platform.type !== "solid" ||
            platform.collidable === false ||
            !collider?.hurtboxes[0]
          )
            continue;
          const box = this.bounds(envId, collider.hurtboxes[0]);
          // Ignore the ground beneath a downward strike; raised platforms and
          // ceilings still stop a weapon regardless of their aspect ratio.
          if (box.y >= transform.position.y - 2) continue;
          walls.push(box);
          const contact = sweptContact(from, to, box);
          if (contact && (!terrainContact || contact.time < terrainContact.time)) {
            terrainContact = contact;
            const p = contact.point;
            const sides = [
              { distance: Math.abs(p.x - box.x), x: -1, y: 0 },
              { distance: Math.abs(p.x - box.x - box.width), x: 1, y: 0 },
              { distance: Math.abs(p.y - box.y), x: 0, y: -1 },
              { distance: Math.abs(p.y - box.y - box.height), x: 0, y: 1 },
            ];
            sides.sort((a, b) => a.distance - b.distance);
            terrainNormal = { x: sides[0].x, y: sides[0].y };
          }
        }
      }

      const contacts: {
        target: number;
        guard: boolean;
        bone?: string;
        contact: NonNullable<ReturnType<typeof sweptContact>>;
      }[] = [];
      for (const targetId of this.contactGrid.query(query, this.queryBuffer)) {
        if (targetId === hitbox.sourceEntityId || hitbox.alreadyHit.has(targetId)) continue;
        const targetFaction = this.world.getComponent<FactionComponent>(targetId, "Faction");
        if (faction && targetFaction && faction.team === targetFaction.team) continue;
        const collider = this.world.getComponent<ColliderComponent>(targetId, "Collider");
        const health = this.world.getComponent<HealthComponent>(targetId, "Health");
        if (
          !collider ||
          !health ||
          health.isDead ||
          health.current <= 0 ||
          !this.world.hasComponent(targetId, "Transform")
        )
          continue;
        let first: ReturnType<typeof sweptContact>;
        let bone: string | undefined;
        const targetArt = actorContacts(this.world, targetId);
        for (let i = 0; i < targetArt.bodies.length; i++) {
          const shape = targetArt.bodies[i];
          const contact = sweptShapeContact(from, to, shape);
          if (contact && (!first || contact.time < first.time)) {
            first = contact;
            bone = targetArt.parts?.[i];
          }
        }
        let guard = false;
        const defender = this.world.getComponent<TransformComponent>(targetId, "Transform")!;
        const weapon = defensiveWeapon(this.world, targetId);
        if (
          weapon &&
          (this.world.hasComponent(targetId, "PlayerInput") || facingAttacker(defender, transform))
        ) {
          const contact = sweptShapeContact(from, to, weapon);
          if (contact && (!first || contact.time <= first.time + 1e-5)) {
            first = contact;
            guard = true;
            bone = "weapon";
          }
        }
        if (!first || (terrainContact && first.time >= terrainContact.time - 1e-5)) continue;
        const ray = {
          x: Math.min(transform.position.x, first.point.x),
          y: first.point.y - 0.5,
          width: Math.max(0.01, Math.abs(first.point.x - transform.position.x)),
          height: 1,
        };
        if (walls.some((wall) => aabbIntersects(ray, wall))) continue;
        contacts.push({ target: targetId, guard, bone, contact: first });
      }
      contacts.sort((a, b) => a.contact.time - b.contact.time || a.target - b.target);
      for (const { target, guard, bone, contact } of contacts) {
        hitbox.alreadyHit.add(target);
        events.push({
          attackerId: hitbox.sourceEntityId,
          targetId: target,
          damage: hitbox.damage,
          poiseDamage: hitbox.poiseDamage,
          zone: hitbox.zone,
          attackType: hitbox.attackType,
          knockback: hitbox.knockback,
          impactPoint: contact.point,
          isBlockable: true,
          contactType: guard ? "guard" : "body",
          attackSerial: combat?.attackSerial,
          targetBone: bone,
          contactTime:
            (frame?.start ?? 0) + ((frame?.end ?? 1) - (frame?.start ?? 0)) * contact.time,
        });
      }
      if (terrainContact) {
        if (weaponSweep)
          weaponSweep.terrain =
            (frame?.start ?? 0) + ((frame?.end ?? 1) - (frame?.start ?? 0)) * terrainContact.time;
        recoiled.add(hitbox.sourceEntityId);
        events.push({
          attackerId: hitbox.sourceEntityId,
          targetId: -1,
          damage: 0,
          poiseDamage: 0,
          zone: hitbox.zone,
          attackType: hitbox.attackType,
          knockback: { x: 0, y: 0 },
          impactPoint: terrainContact.point,
          isBlockable: false,
          contactType: "terrain",
          attackSerial: combat?.attackSerial,
          impactNormal: terrainNormal,
          contactTime:
            (frame?.start ?? 0) + ((frame?.end ?? 1) - (frame?.start ?? 0)) * terrainContact.time,
        });
      }
      if (terrainContact || frame?.expires) {
        if (terrainContact) this.world.removeComponent(id, "ActiveHitbox");
        this.world.removeComponent(id, "HitboxSweep");
        this.history.delete(hitbox);
      } else
        this.history.set(hitbox, {
          shape: current,
          x: transform.position.x,
          y: transform.position.y,
          facing: transform.facing,
        });
      delete hitbox.frameSweep;
    }
    // Only overlapping committed melee windows can clash. Resting weapons
    // and creature bites are not contact hazards.
    for (let i = 0; i < weaponSweeps.length; i++)
      for (let j = i + 1; j < weaponSweeps.length; j++) {
        const a = weaponSweeps[i],
          b = weaponSweeps[j],
          idA = a.hitbox.sourceEntityId,
          idB = b.hitbox.sourceEntityId;
        if (
          idA === idB ||
          a.hitbox.clashedWith?.has(idB) ||
          b.hitbox.clashedWith?.has(idA) ||
          this.world.getComponent<FactionComponent>(idA, "Faction")?.team ===
            this.world.getComponent<FactionComponent>(idB, "Faction")?.team
        )
          continue;
        const start = Math.max(a.start, b.start),
          end = Math.min(a.end, b.end);
        if (start >= end) continue;
        let first: ReturnType<typeof sweptContact>;
        for (let n = 0; n < 8 && !first; n++) {
          const t0 = start + ((end - start) * n) / 8,
            t1 = start + ((end - start) * (n + 1)) / 8;
          const contact = sweptShapeContact(
            interpolateShape(a.from, a.to, t0),
            interpolateShape(a.from, a.to, t1),
            interpolateShape(b.from, b.to, (t0 + t1) / 2),
          );
          if (contact) first = { ...contact, time: t0 + (t1 - t0) * contact.time };
        }
        if (
          !first ||
          first.time >= (a.terrain ?? Infinity) ||
          first.time >= (b.terrain ?? Infinity)
        )
          continue;
        (a.hitbox.clashedWith ??= new Set()).add(idB);
        (b.hitbox.clashedWith ??= new Set()).add(idA);
        events.push({
          attackerId: idA,
          targetId: idB,
          damage: 0,
          poiseDamage: 0,
          zone: a.hitbox.zone,
          attackType: a.hitbox.attackType,
          knockback: { x: 0, y: 0 },
          impactPoint: first.point,
          isBlockable: false,
          contactType: "clash",
          contactTime: first.time,
          attackSerial: this.world.getComponent<CombatComponent>(idA, "Combat")?.attackSerial,
          targetAttackSerial: this.world.getComponent<CombatComponent>(idB, "Combat")?.attackSerial,
        });
      }
  }
}
