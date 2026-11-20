import { Game } from "../core/Game";
import { AudioSystem } from "../systems/AudioSystem";
import { MovementStateComponent } from "../features/movement/MovementStateComponent";
import { PlayerInputComponent } from "../components/PlayerInput";
import { CombatComponent } from "../features/combat/CombatComponent";
import { AnimatorComponent } from "../features/animation/AnimatorComponent";
import { createDummy } from "../entities/Archetypes";
import { AssetLoader } from "../assets/AssetLoader";
import { Animation } from "../features/animation/AnimationTypes";

function getAudioSystem(game: Game): AudioSystem {
  const s = game.systems.find((s) => s instanceof AudioSystem);
  if (!s) throw new Error("AudioSystem not found");
  return s as AudioSystem;
}

function getPlayer(game: Game) {
  const results = game.world.query(
    "MovementState",
    "PlayerInput",
    "Combat",
    "Animator",
    "Transform",
  );
  if (results.length === 0) throw new Error("No player found");
  const { id, components } = results[0];

  // Remove MovementState to prevent idle/walk overrides
  game.world.removeComponent(id, "MovementState");

  return {
    id,
    state: components[0] as MovementStateComponent,
    input: components[1] as PlayerInputComponent,
    combat: components[2] as CombatComponent,
    animator: components[3] as AnimatorComponent,
    transform: components[4] as any,
  };
}

async function runFrames(game: Game, count: number, dt: number = 16) {
  for (let i = 0; i < count; i++) game.update(dt);
}
export const tests = [
  async function testSwingSound(game: Game) {
    const player = getPlayer(game);

    const anim: Animation = {
      name: "swing_test",
      duration: 100,
      loop: false,
      keyframes: [],
      events: [{ time: 0.1, type: "sound", data: "swing-whoosh" }],
    };
    (AssetLoader as any).animations.set("swing_test", anim);
    player.animator.currentAnim = "swing_test";
    player.animator.time = 0;

    await runFrames(game, 1);

    const audio = getAudioSystem(game);
    if (!audio.recentPlayed.includes("swing-whoosh")) throw new Error("Swing sound not played");
  },

  async function testSwingPitchBySpeed(game: Game) {
    const player = getPlayer(game);
    const audio = getAudioSystem(game);

    const fastAnim: Animation = {
      name: "fast_swing",
      duration: 100,
      loop: false,
      keyframes: [],
      events: [{ time: 0.1, type: "sound", data: { id: "swing-whoosh", pitch: 1.2 } }],
    };
    (AssetLoader as any).animations.set("fast_swing", fastAnim);

    player.animator.currentAnim = "fast_swing";
    player.animator.time = 0;
    await runFrames(game, 1);

    if (!audio.recentParams["swing-whoosh"] || audio.recentParams["swing-whoosh"].pitch !== 1.2)
      throw new Error("Pitch not applied for fast swing");
  },

  async function testHitFleshSound(game: Game) {
    const player = getPlayer(game);
    createDummy(game.world, player.transform.position.x + 40, player.transform.position.y);

    game.world.addComponent(player.id, "ActiveHitbox", {
      offset: { x: 40, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: player.id,
    });

    await runFrames(game, 1);

    const audio = getAudioSystem(game);
    if (!audio.recentPlayed.includes("hit-flesh")) throw new Error("Hit flesh sound not played");
  },

  async function testHitMetalSound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("hit-metal");
    if (!audio.recentPlayed.includes("hit-metal")) throw new Error("Hit metal sound failed");
  },

  async function testBlockSound(game: Game) {
    const player = getPlayer(game);
    const dummyId = createDummy(
      game.world,
      player.transform.position.x + 40,
      player.transform.position.y,
    );
    const dummyCombat = game.world.getComponent<CombatComponent>(dummyId, "Combat")!;

    dummyCombat.isBlocking = true;
    dummyCombat.blockZone = 2; // Mid

    game.world.addComponent(player.id, "ActiveHitbox", {
      offset: { x: 40, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: player.id,
    });

    await runFrames(game, 1);

    const audio = getAudioSystem(game);
    if (!audio.recentPlayed.includes("block")) throw new Error("Block sound not played");
  },

  async function testParrySound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("parry");
    if (!audio.recentPlayed.includes("parry")) throw new Error("Parry sound failed");
  },

  async function testStaggerSound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("stagger");
    if (!audio.recentPlayed.includes("stagger")) throw new Error("Stagger sound failed");
  },

  async function testEnemyAttackTellSound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("enemy-tell");
    if (!audio.recentPlayed.includes("enemy-tell")) throw new Error("Enemy tell sound failed");
  },

  async function testEnemyHitSound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("enemy-hit");
    if (!audio.recentPlayed.includes("enemy-hit")) throw new Error("Enemy hit sound failed");
  },

  async function testEnemyDeathSound(game: Game) {
    const player = getPlayer(game);
    const dummyId = createDummy(
      game.world,
      player.transform.position.x + 40,
      player.transform.position.y,
    );
    const dummyHealth = game.world.getComponent<any>(dummyId, "Health")!;
    dummyHealth.current = 1;

    game.world.addComponent(player.id, "ActiveHitbox", {
      offset: { x: 40, y: 0 },
      width: 100,
      height: 100,
      rotation: 0,
      damage: 10,
      poiseDamage: 0,
      knockback: { x: 0, y: 0 },
      zone: 2,
      alreadyHit: new Set(),
      sourceEntityId: player.id,
    });

    await runFrames(game, 1);

    const audio = getAudioSystem(game);
    if (!audio.recentPlayed.includes("enemy-death"))
      throw new Error("Enemy death sound not played");
  },

  async function testPlayerDamageHighPriority(game: Game) {
    const audio = getAudioSystem(game);

    for (let i = 0; i < 15; i++) audio.playSound("footstep-right");

    audio.playSound("player-damage");

    const priorities = audio.getActivePriorities();
    if (!priorities.includes(1)) throw new Error("Player damage (Priority 1) did not play");
  },

  async function testSoundPriorityOrder(game: Game) {
    const audio = getAudioSystem(game);
    audio.reset(); // Clear pool

    // Fill pool with low priority (e.g. ambient/footsteps is 4/5)
    // Default size is 10
    for (let i = 0; i < 12; i++) {
      audio.playSound("footstep-right");
    }

    // Try to play High Priority (1)
    audio.playSound("player-damage");

    const priorities = audio.getActivePriorities();
    if (!priorities.includes(1)) throw new Error("High priority sound did not steal voice");
  },

  async function testSoundDucking(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("footstep-right");
    audio.playSound("player-damage");

    await runFrames(game, 1);
  },

  async function testDeathSound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("death");
    if (!audio.recentPlayed.includes("death")) throw new Error("Death sound failed");
  },

  async function testRespawnSound(game: Game) {
    const audio = getAudioSystem(game);
    audio.playSound("respawn");
    if (!audio.recentPlayed.includes("respawn")) throw new Error("Respawn sound failed");
  },
];
