import {
  Animation,
  AnimationEvent,
  BonePose,
  Keyframe,
} from "../../features/animation/AnimationTypes";
import { AnimationKey, SkeletonKey } from "../../core/AssetKeys";
import { QUADRUPED_LEGS } from "../../skeleton/data/QuadrupedSkeleton";
import { placePaw, quadrupedPose } from "./QuadrupedPose";

const key = (
  time: number,
  overrides: BonePose = {},
  easing: Keyframe["easing"] = "ease-in-out",
): Keyframe => ({ time, bones: quadrupedPose(overrides), easing });
const clip = (name: string, duration: number, keys: Keyframe[], loop = false): Animation => ({
  name,
  duration,
  loop,
  keyframes: keys,
  grounded: true,
  skeletonId: SkeletonKey.QUADRUPED,
});

const pawAnchor = (leg: (typeof QUADRUPED_LEGS)[number]) =>
  leg === "fore-near" ? 11 : leg === "fore-far" ? 19 : leg === "hind-near" ? -16 : -11;

function compress(time: number, depth: number, overrides: BonePose = {}): Keyframe {
  const pose = quadrupedPose(overrides);
  pose["body-pivot"] = { rotate: 0, translate: { x: 0, y: depth } };
  for (const leg of QUADRUPED_LEGS) placePaw(pose, leg, { x: pawAnchor(leg), y: -2 });
  return { time, bones: pose, easing: "ease-in-out" };
}

function rear(time: number, lean: number, strike = false): Keyframe {
  const pose = quadrupedPose({
    pelvis: { rotate: lean },
    neck: { rotate: -lean / 3 },
    head: { rotate: -lean / 2 },
    jaw: { rotate: 22 },
    "fore-near-upper": { rotate: strike ? -35 : -115 },
    "fore-near-lower": { rotate: strike ? 5 : 55 },
    "fore-far-upper": { rotate: strike ? -55 : -125 },
    "fore-far-lower": { rotate: strike ? 15 : 65 },
    "tail-base": { rotate: -lean + 20 },
  });
  // The rear is anchored by the hind paws, not by the old standing-leg support
  // compensation. Keep the pelvis raised while those chains solve to the floor.
  pose["body-pivot"] = { rotate: 0, translate: { x: 0, y: 0 } };
  pose.pelvis = { rotate: lean, translate: { x: 0, y: -2 } };
  placePaw(pose, "hind-near", { x: -16, y: -2 });
  placePaw(pose, "hind-far", { x: -10, y: -2 });
  return { time, bones: pose, easing: "ease-in-out" };
}

function gait(name: string, running: boolean): Animation {
  const keys: Keyframe[] = [];
  const duration = running ? 520 : 760;
  const support = running ? 0.46 : 0.64;
  const stride = running ? 26 : 16;
  for (let i = 0; i <= 20; i++) {
    const t = i / 20,
      bob = Math.cos(t * Math.PI * 4);
    const pose = quadrupedPose({
      pelvis: { rotate: running ? bob * 3 : bob },
      torso: { rotate: running ? -bob * 3 : 0 },
      neck: { rotate: -bob * 3 },
      head: { rotate: bob * 2 },
      jaw: { rotate: running ? 12 : 6 },
      "ear-near": { rotate: running ? -8 - bob * 4 : -bob * 2 },
      "ear-far": { rotate: running ? -12 - bob * 3 : bob },
      "tail-base": { rotate: Math.sin(t * Math.PI * 2) * 12 },
      "tail-mid": { rotate: -Math.sin(t * Math.PI * 2 + 0.6) * 14 },
      "tail-tip": { rotate: -bob * 10 },
    });
    pose["body-pivot"] = { rotate: 0, translate: { x: 0, y: running ? 5 - bob : 2 - bob * 0.5 } };
    for (const leg of QUADRUPED_LEGS) {
      const diagonal = leg === "fore-near" || leg === "hind-far";
      // A walk uses diagonal support; the run gathers/releases front and hind
      // pairs separately, with the far paw trailing its partner slightly.
      const offset = running
        ? (leg.startsWith("hind") ? 0.5 : 0) + (leg.endsWith("far") ? 0.12 : 0)
        : diagonal
          ? 0
          : 0.5;
      const phase = (t + offset) % 1;
      const p = phase < support ? phase / support : (phase - support) / (1 - support);
      const swing = phase >= support;
      placePaw(pose, leg, {
        x: pawAnchor(leg) + (swing ? p - 0.5 : 0.5 - p) * stride,
        y: -2 - (swing ? Math.sin(p * Math.PI) * (running ? 7 : 4) : 0),
      });
    }
    keys.push({ time: t, bones: pose, easing: "linear" });
  }
  const alpha = name.startsWith("alpha_hellhound");
  // Match the planted paw's backward travel to the entity's forward velocity.
  return {
    ...clip(name, duration, keys, true),
    gaitSpeed: stride / ((duration / 1000) * support),
    events: [0, 0.5].map((time, i) => ({
      time,
      type: "sound",
      data: {
        id: i ? "footstep-left" : "footstep-right",
        volume: alpha ? 0.7 : 0.35,
        pitch: alpha ? 0.6 : 1.25,
      },
    })),
  };
}

const bite = (time: number, opened: boolean, alpha: boolean, lunging = false) =>
  key(time, {
    neck: { rotate: opened ? 32 : 64, translate: { x: lunging ? 4 : 0, y: alpha ? 6 : 3 } },
    head: { rotate: opened ? -40 : -64 },
    jaw: { rotate: opened ? 48 : 0 },
    torso: { rotate: lunging ? 6 : -3 },
    "tail-base": { rotate: opened ? -18 : 8 },
    "fore-near-upper": { rotate: lunging ? -25 : 20 },
    "fore-near-lower": { rotate: lunging ? 15 : -20 },
  });

function hit(
  time: number,
  zone: 1 | 2 | 3,
  bone: string | undefined,
  x: number,
  y: number,
  width: number,
  height: number,
  alpha = false,
  damage = 1,
): AnimationEvent {
  return {
    time,
    type: "hitbox-start",
    data: {
      attachedToBone: bone,
      offset: { x, y },
      width,
      height,
      rotation: 0,
      damage,
      poiseDamage: alpha ? 45 : 18,
      knockback: { x: alpha ? 220 : 95, y: -30 },
      zone,
      attackType: alpha ? "heavy" : "light",
    },
  };
}
function attack(
  name: string,
  duration: number,
  keys: Keyframe[],
  zone: 1 | 2 | 3,
  start: number,
  end: number,
  hitbox: AnimationEvent,
  motion?: Animation["motion"],
): Animation {
  return {
    ...clip(name, duration, keys),
    zone,
    windupMs: duration * start,
    motion,
    events: [
      {
        time: Math.max(0, start - 0.13),
        type: "sound",
        data: { id: "enemy-tell", pitch: name.startsWith("alpha") ? 0.55 : 1.1 },
      },
      { time: start, type: "sound", data: { id: "swing-whoosh", pitch: 0.75 } },
      hitbox,
      { time: end, type: "hitbox-end" },
    ],
  };
}

export const HellhoundAttackLow = attack(
  AnimationKey.HELLHOUND_ATTACK_LOW,
  580,
  [
    key(0),
    bite(0.23, true, false),
    bite(0.31, true, false, true),
    bite(0.36, false, false, true),
    bite(0.45, false, false),
    key(0.8),
    key(1),
  ],
  3,
  0.31,
  0.44,
  hit(0.31, 3, "head", 10, 4, 15, 10),
  { start: 0.29, end: 0.4, speed: 95 },
);

export const HellhoundAttackMid = attack(
  AnimationKey.HELLHOUND_ATTACK_MID,
  1050,
  [
    key(0),
    rear(0.23, -38),
    rear(0.4, -78),
    rear(0.48, -52, true),
    rear(0.58, -28, true),
    key(0.78, { "fore-near-upper": { rotate: 15 }, "fore-near-lower": { rotate: -15 } }),
    key(1),
  ],
  2,
  0.44,
  0.59,
  hit(0.44, 2, "fore-near-paw", 2, 0, 14, 10),
  { start: 0.4, end: 0.59, speed: 65 },
);
HellhoundAttackMid.bodyHeight = 80;

export const HellhoundAttackHigh = attack(
  AnimationKey.HELLHOUND_ATTACK_HIGH,
  1000,
  [
    key(0),
    compress(0.18, 4, {
      neck: { rotate: 8 },
      head: { rotate: -15 },
      "ear-near": { rotate: -12 },
      "tail-base": { rotate: 12 },
    }),
    key(0.3, {
      pelvis: { rotate: -12 },
      "fore-near-upper": { rotate: -70 },
      "fore-far-upper": { rotate: -60 },
      "hind-near-upper": { rotate: 35 },
      "hind-far-upper": { rotate: 25 },
      jaw: { rotate: 40 },
    }),
    key(0.43, {
      pelvis: { rotate: 8 },
      neck: { rotate: 12 },
      head: { rotate: -20 },
      jaw: { rotate: 35 },
      "fore-near-upper": { rotate: -35 },
      "fore-far-upper": { rotate: -25 },
    }),
    key(0.59, { neck: { rotate: 35 }, head: { rotate: -35 }, jaw: { rotate: 0 } }),
    key(0.74),
    key(1),
  ],
  1,
  0.4,
  0.62,
  hit(0.4, 1, "head", 10, 3, 14, 10),
  { start: 0.22, end: 0.62, speed: 145, lift: 320 },
);

export const AlphaHellhoundAttackLow = attack(
  AnimationKey.ALPHA_HELLHOUND_ATTACK_LOW,
  980,
  [
    key(0),
    bite(0.3, true, true),
    bite(0.43, true, true, true),
    bite(0.51, false, true, true),
    bite(0.62, false, true),
    key(0.88),
    key(1),
  ],
  3,
  0.43,
  0.6,
  hit(0.43, 3, "head", 10, 4, 16, 11, true),
  { start: 0.4, end: 0.52, speed: 105 },
);

export const AlphaHellhoundAttackMid = attack(
  AnimationKey.ALPHA_HELLHOUND_ATTACK_MID,
  1150,
  [
    key(0),
    key(0.3, {
      "fore-near-upper": { rotate: -125 },
      "fore-near-lower": { rotate: 15 },
      neck: { rotate: 20 },
      jaw: { rotate: 22 },
      torso: { rotate: -8 },
    }),
    key(0.45, {
      "fore-near-upper": { rotate: -95 },
      "fore-near-lower": { rotate: 0 },
      torso: { rotate: 6 },
      neck: { rotate: 25 },
      jaw: { rotate: 32 },
    }),
    key(0.6, {
      "fore-near-upper": { rotate: -30 },
      "fore-near-lower": { rotate: -10 },
      torso: { rotate: 8 },
    }),
    key(0.82),
    key(1),
  ],
  2,
  0.43,
  0.61,
  hit(0.43, 2, "fore-near-paw", 3, 0, 15, 12, true),
  { start: 0.4, end: 0.58, speed: 70 },
);

export const AlphaHellhoundAttackHigh = attack(
  AnimationKey.ALPHA_HELLHOUND_ATTACK_HIGH,
  1300,
  [
    key(0),
    compress(0.25, 5, {
      jaw: { rotate: 25 },
      neck: { rotate: 10 },
      "ear-near": { rotate: -12 },
      "ear-far": { rotate: -8 },
      "tail-base": { rotate: 15 },
    }),
    key(0.36, {
      pelvis: { rotate: -8 },
      "fore-near-upper": { rotate: -70 },
      "fore-far-upper": { rotate: -60 },
      "hind-near-upper": { rotate: 30 },
      "hind-far-upper": { rotate: 20 },
      jaw: { rotate: 40 },
    }),
    bite(0.51, true, true, true),
    bite(0.66, false, true, true),
    key(0.81),
    key(1),
  ],
  1,
  0.48,
  0.69,
  hit(0.48, 1, "head", 10, 3, 16, 12, true),
  { start: 0.29, end: 0.7, speed: 205, lift: 290 },
);

export const AlphaHellhoundSpecialMaul = attack(
  AnimationKey.ALPHA_HELLHOUND_SPECIAL_MAUL,
  1500,
  [
    key(0),
    bite(0.27, true, true),
    bite(0.36, true, true, true),
    bite(0.51, false, true, true),
    bite(0.67, true, true, true),
    bite(0.77, false, true),
    key(1),
  ],
  2,
  0.36,
  0.73,
  hit(0.36, 2, "head", 9, 3, 18, 13, true, 1.2),
  { start: 0.32, end: 0.73, speed: 230 },
);
// One hit per opponent during the maul, rather than fresh hits on every jaw snap.

export const AlphaHellhoundSpecialSlam = attack(
  AnimationKey.ALPHA_HELLHOUND_SPECIAL_SLAM,
  1800,
  [
    key(0),
    rear(0.27, -42),
    rear(0.48, -60),
    rear(0.54, -62),
    key(0.62, {
      pelvis: { rotate: 8 },
      "fore-near-upper": { rotate: 28 },
      "fore-near-lower": { rotate: -36 },
      "fore-far-upper": { rotate: 22 },
      "fore-far-lower": { rotate: -28 },
      jaw: { rotate: 35 },
      neck: { rotate: 45 },
    }),
    key(0.72, { head: { rotate: 10 }, jaw: { rotate: 10 } }),
    key(0.9),
    key(1),
  ],
  3,
  0.6,
  0.69,
  hit(0.6, 3, undefined, 0, -4, 116, 14, true, 1.35),
);
AlphaHellhoundSpecialSlam.events!.splice(2, 0, {
  time: 0.6,
  type: "effect",
  data: { type: "hellhound-shockwave", scale: 2 },
});
AlphaHellhoundSpecialSlam.bodyHeight = 80;

function shared(skin: string): Animation[] {
  const idle = clip(
    `${skin}_idle`,
    skin === "hellhound" ? 1600 : 2200,
    [
      key(0, { jaw: { rotate: 5 } }),
      key(0.5, {
        torso: { scale: { x: 1.025, y: 1.04 } },
        neck: { rotate: -3 },
        jaw: { rotate: 9 },
        "ear-near": { rotate: -5 },
        "tail-tip": { rotate: 10 },
      }),
      key(1, { jaw: { rotate: 5 } }),
    ],
    true,
  );
  const land = clip(`${skin}_land`, 250, [
    compress(0, 3, { head: { rotate: 12 } }),
    compress(0.22, 5, {
      neck: { rotate: 10 },
      head: { rotate: 4 },
      "ear-near": { rotate: -15 },
      "tail-base": { rotate: 15 },
    }),
    compress(0.62, 1.5, {
      head: { rotate: -5 },
      "ear-near": { rotate: 5 },
      "tail-base": { rotate: -8 },
    }),
    key(1),
  ]);
  const jump = clip(`${skin}_jump`, 400, [
    key(0),
    key(0.5, {
      "fore-near-upper": { rotate: -65 },
      "fore-far-upper": { rotate: -55 },
      "hind-near-upper": { rotate: 35 },
      "hind-far-upper": { rotate: 25 },
      "tail-base": { rotate: -25 },
    }),
    key(1, { "fore-near-upper": { rotate: -25 }, "fore-far-upper": { rotate: -20 } }),
  ]);
  const fall = clip(
    `${skin}_fall`,
    500,
    [
      key(0, { "fore-near-upper": { rotate: -25 }, "fore-far-upper": { rotate: -20 } }),
      key(1, { "fore-near-upper": { rotate: -25 }, "fore-far-upper": { rotate: -20 } }),
    ],
    true,
  );
  const light = clip(`${skin}_stagger_light`, 350, [
    key(0),
    key(0.2, {
      torso: { rotate: -12 },
      head: { rotate: -25 },
      jaw: { rotate: 35 },
      "ear-near": { rotate: -25 },
    }),
    key(1),
  ]);
  const heavy = clip(`${skin}_stagger_heavy`, 750, [
    key(0),
    key(0.18, {
      pelvis: { rotate: -12 },
      torso: { rotate: -12 },
      head: { rotate: -30 },
      jaw: { rotate: 45 },
    }),
    key(0.65, { head: { rotate: 15 } }),
    key(1),
  ]);
  const death = clip(`${skin}_death`, 900, [
    key(0),
    key(0.35, {
      pelvis: { rotate: 12 },
      head: { rotate: 25 },
      "fore-near-upper": { rotate: 60 },
      "fore-near-lower": { rotate: -90 },
    }),
    key(0.7, {
      "body-pivot": { rotate: 18 },
      "fore-near-upper": { rotate: -80 },
      "fore-near-lower": { rotate: -30 },
      "fore-far-upper": { rotate: -100 },
      "hind-near-upper": { rotate: 50 },
      "hind-far-upper": { rotate: 35 },
      neck: { rotate: 55 },
      head: { rotate: -15 },
      "ear-near": { rotate: -65 },
      jaw: { rotate: 10 },
    }),
    key(1, {
      "body-pivot": { rotate: 18 },
      "fore-near-upper": { rotate: -80 },
      "fore-near-lower": { rotate: -30 },
      "fore-far-upper": { rotate: -100 },
      "hind-near-upper": { rotate: 50 },
      "hind-far-upper": { rotate: 35 },
      neck: { rotate: 55 },
      head: { rotate: -15 },
      "ear-near": { rotate: -65 },
      jaw: { rotate: 5 },
    }),
  ]);
  if (skin === "alpha_hellhound") {
    // Fold all four legs and lower the neck into a settled side collapse.
    // Body contact compensation rests the existing artwork on the floor;
    // the boss no longer resembles a standing crouch after death.
    const settled: BonePose = {
      "body-pivot": { rotate: 6 },
      pelvis: { rotate: 0 },
      "fore-near-upper": { rotate: 70 },
      "fore-near-lower": { rotate: -145 },
      "fore-near-paw": { rotate: 75 },
      "fore-far-upper": { rotate: 95 },
      "fore-far-lower": { rotate: -170 },
      "fore-far-paw": { rotate: 75 },
      "hind-near-upper": { rotate: 120 },
      "hind-near-lower": { rotate: -200 },
      "hind-near-paw": { rotate: 80 },
      "hind-far-upper": { rotate: 130 },
      "hind-far-lower": { rotate: -210 },
      "hind-far-paw": { rotate: 80 },
      neck: { rotate: 70 },
      head: { rotate: -62 },
      "ear-near": { rotate: -65 },
      "ear-far": { rotate: -55 },
      jaw: { rotate: 5 },
      "tail-base": { rotate: 35 },
      "tail-mid": { rotate: 0 },
      "tail-tip": { rotate: -5 },
    };
    death.keyframes[2] = key(0.7, settled);
    death.keyframes[3] = key(1, settled);
  }
  death.grounded = false;
  death.bodyContact = true;
  return [
    idle,
    gait(`${skin}_walk`, false),
    gait(`${skin}_run`, true),
    jump,
    fall,
    land,
    light,
    heavy,
    death,
  ];
}

export const HellhoundAnimations: Animation[] = [
  ...shared("hellhound"),
  ...shared("alpha_hellhound"),
  HellhoundAttackLow,
  HellhoundAttackMid,
  HellhoundAttackHigh,
  AlphaHellhoundAttackLow,
  AlphaHellhoundAttackMid,
  AlphaHellhoundAttackHigh,
  AlphaHellhoundSpecialMaul,
  AlphaHellhoundSpecialSlam,
];
