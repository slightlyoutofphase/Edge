import { Animation, BonePose } from "../../features/animation/AnimationTypes";
import {
  bracePose,
  gaitKeyframes,
  gaitReferenceSpeed,
  guardPose,
  placeHand,
  poseMatrices,
  carryHeavyWeapon,
} from "./PoseAuthoring";

const copyPose = (pose: BonePose): BonePose =>
  Object.fromEntries(
    Object.entries(pose).map(([bone, value]) => [
      bone,
      {
        ...value,
        ...(value.translate ? { translate: { ...value.translate } } : {}),
        ...(value.scale ? { scale: { ...value.scale } } : {}),
      },
    ]),
  );

export function animationVariant(base: Animation, skin: string, weapon: string): Animation {
  const variant = {
    ...base,
    keyframes: base.keyframes.map((key) => ({ ...key, bones: copyPose(key.bones) })),
  };
  if (skin !== "player") {
    if ((skin === "brute" || skin === "boss") && ["idle", "run"].includes(base.name)) {
      variant.offHandGrip = { x: -3, y: 0 };
    }
    if (base.name === "run") {
      variant.keyframes = gaitKeyframes(skin, skin === "rogue" ? 48 : 40, true);
      variant.gaitSpeed = gaitReferenceSpeed(base.duration, skin === "rogue" ? 48 : 40, skin);
    } else if (["idle", "stagger_light", "stagger_heavy"].includes(base.name)) {
      const guard = guardPose(skin),
        neutral = guardPose();
      const mass = skin === "boss" ? 0.55 : skin === "brute" ? 0.7 : skin === "rogue" ? 1.1 : 1;
      for (const key of variant.keyframes) {
        for (const bone of [
          "torso",
          "head",
          "shoulder-front",
          "arm-front-lower",
          "weapon-grip",
          "shoulder-back",
          "arm-back-lower",
        ]) {
          key.bones[bone] = {
            ...key.bones[bone],
            rotate:
              (guard[bone]?.rotate ?? 0) +
              ((key.bones[bone]?.rotate ?? 0) - (neutral[bone]?.rotate ?? 0)) * mass,
          };
        }
        if (base.name === "idle" && skin === "rogue") Object.assign(key.bones, bracePose(18, 3));
      }
    } else if (base.name === "death") {
      const heavy = skin === "boss" || skin === "brute";
      for (const key of variant.keyframes) {
        if (key.time < 0.7) {
          key.bones.torso.rotate =
            (key.bones.torso.rotate ?? 0) * (heavy ? 0.8 : skin === "hollow" ? 1.15 : 1);
          key.bones.head.rotate = (key.bones.head.rotate ?? 0) * (heavy ? 0.65 : 1);
        }
        if (heavy && key.time === 0.9) key.time = 0.94;
      }
    }
    if (["crouch", "crouchWalk", "slide", "land", "jump", "fall", "backstep"].includes(base.name)) {
      for (const key of variant.keyframes) {
        const pose = key.bones;
        pose["weapon-grip"] = {
          rotate:
            (skin === "brute" || skin === "boss" ? -20 : 0) -
            (pose.hip?.rotate ?? 0) -
            (pose.torso?.rotate ?? 0) -
            (pose["shoulder-front"]?.rotate ?? 0) -
            (pose["arm-front-upper"]?.rotate ?? 0) -
            (pose["arm-front-lower"]?.rotate ?? 0),
        };
      }
    }
    if (variant.offHandGrip) for (const key of variant.keyframes) carryHeavyWeapon(key.bones);
    return variant;
  }

  const style =
    weapon === "dagger"
      ? "rogue"
      : weapon === "rapier"
        ? "duelist"
        : weapon === "greatsword"
          ? "brute"
          : "player";
  const guard = guardPose(style);
  const isAttack = base.name.includes("attack");
  const starts = base.events?.filter((event) => event.type === "hitbox-start") ?? [];
  const ends = base.events?.filter((event) => event.type === "hitbox-end") ?? [];
  const neutral = guardPose("player");
  const startTime = starts[0]?.time ?? 0.33;
  const endTime = ends[ends.length - 1]?.time ?? 0.75;
  for (const key of variant.keyframes) {
    if (isAttack) {
      const windowIndex = starts.findIndex(
        (event, i) => key.time > event.time && key.time <= (ends[i]?.time ?? event.time),
      );
      const window = windowIndex >= 0 ? starts[windowIndex] : undefined;
      if (key.time === 0 || key.time === 1) {
        for (const bone of ["torso", "head", "shoulder-front", "arm-front-lower", "weapon-grip"])
          key.bones[bone] = { ...guard[bone] };
      } else if (weapon === "dagger" || weapon === "rapier") {
        const zone = window?.data.zone ?? base.zone ?? starts[0]?.data.zone ?? 2;
        const low = zone === 3;
        const isDagger = weapon === "dagger";
        let torso: number;
        let shoulder: number;
        let elbow: number;
        let blade: number;
        if (window) {
          const winStart = window.time;
          const winEnd = ends[windowIndex]?.time ?? winStart;
          const progress = Math.max(
            0,
            Math.min(1, (key.time - winStart) / Math.max(0.01, winEnd - winStart)),
          );
          torso = (low ? 8 : 4) + (isDagger && !low ? 6 : 4) * progress;
          shoulder = low
            ? isDagger
              ? -12 - 32 * progress
              : -18 - 18 * progress
            : zone === 1
              ? isDagger
                ? -136 + 56 * progress
                : -118 + 20 * progress
              : isDagger
                ? -74 - 32 * progress
                : -86 - 14 * progress;
          elbow = isDagger ? -42 + 32 * progress : -30 + 30 * progress;
          blade = low
            ? isDagger
              ? 4 + 4 * progress
              : 6 + 4 * progress
            : zone === 1
              ? isDagger
                ? -28 + 38 * progress
                : -16 + 10 * progress
              : isDagger
                ? -6 + 10 * progress
                : -4 + 4 * progress;
        } else if (key.time <= startTime) {
          torso = low ? 6 : isDagger ? -8 : -10;
          shoulder = low
            ? isDagger
              ? 22
              : 18
            : zone === 1
              ? isDagger
                ? -145
                : -128
              : isDagger
                ? 30
                : 42;
          elbow = isDagger ? -115 : -118;
          blade = low ? -12 : zone === 1 ? (isDagger ? -160 : -140) : isDagger ? -55 : -35;
        } else {
          // Follow-through overshoot after active hitbox closes
          torso = low ? 10 : isDagger ? 12 : 10;
          shoulder = low ? -46 : zone === 1 ? (isDagger ? -72 : -92) : isDagger ? -112 : -96;
          elbow = isDagger ? -16 : -8;
          blade = low ? 6 : zone === 1 ? (isDagger ? 10 : -4) : isDagger ? 6 : 2;
        }
        key.bones.torso = { ...key.bones.torso, rotate: torso };
        key.bones["shoulder-front"] = { rotate: shoulder };
        key.bones["arm-front-lower"] = { rotate: elbow };
        key.bones["weapon-grip"] = {
          rotate: blade - torso - (key.bones.hip?.rotate ?? 0) - shoulder - elbow,
        };
      } else if (weapon === "greatsword") {
        if (
          !base.name.includes("slide") &&
          !base.name.startsWith("jump_attack") &&
          key.time <= endTime
        )
          Object.assign(key.bones, bracePose(window?.data.zone === 3 ? 38 : 30, 4));
        key.bones["shoulder-back"] = { rotate: 0, translate: { x: 7, y: 0 } };
        const grip = poseMatrices(key.bones).get("weapon")!;
        placeHand(key.bones, "back", { x: grip.tx, y: grip.ty });
      }
    } else if (
      ["idle", "walk", "run", "crouch", "crouchWalk", "slide", "land"].includes(base.name)
    ) {
      for (const bone of ["shoulder-front", "arm-front-lower"]) {
        const offset =
          (key.bones[bone]?.rotate ?? neutral[bone]?.rotate ?? 0) - (neutral[bone]?.rotate ?? 0);
        key.bones[bone] = {
          ...key.bones[bone],
          rotate: (guard[bone]?.rotate ?? 0) + offset * 0.75,
        };
      }
      if (base.name === "idle") {
        key.bones.torso.rotate = (key.bones.torso.rotate ?? 0) + (guard.torso.rotate ?? 0);
        key.bones.head = { rotate: (key.bones.head?.rotate ?? 0) + (guard.head.rotate ?? 0) };
      }
      const gripSway =
        ((key.bones["weapon-grip"]?.rotate ?? neutral["weapon-grip"]?.rotate ?? 50) -
          (neutral["weapon-grip"]?.rotate ?? 50)) *
        0.5;
      const carry = (weapon === "greatsword" ? -15 : 0) + gripSway;
      key.bones["weapon-grip"] = {
        rotate:
          carry -
          (key.bones.hip?.rotate ?? 0) -
          (key.bones.torso?.rotate ?? 0) -
          (key.bones["shoulder-front"]?.rotate ?? 0) -
          (key.bones["arm-front-lower"]?.rotate ?? 0),
      };
    }
  }
  return variant;
}
