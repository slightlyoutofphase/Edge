export enum InputAction {
  MOVE_LEFT = "MoveLeft",
  MOVE_RIGHT = "MoveRight",
  MOVE_UP = "MoveUp",
  MOVE_DOWN = "MoveDown",
  JUMP = "Jump",
  RUN = "Run",
  CROUCH = "Crouch",
  ROLL = "Roll",
  BACKSTEP = "Backstep",
  SLIDE = "Slide",
  ATTACK_LIGHT = "AttackLight",
  ATTACK_HEAVY = "AttackHeavy",
  BLOCK = "Block",
  PARRY = "Parry",
  INTERACT = "Interact",
  WEAPON_1 = "Weapon1",
  WEAPON_2 = "Weapon2",
  WEAPON_3 = "Weapon3",
  WEAPON_4 = "Weapon4",
}

export type InputBinding = {
  keys: string[];
  mouseButtons?: number[];
};

export const DEFAULT_KEYBINDINGS: Record<InputAction, InputBinding> = {
  [InputAction.MOVE_LEFT]: { keys: ["KeyA", "ArrowLeft"] },
  [InputAction.MOVE_RIGHT]: { keys: ["KeyD", "ArrowRight"] },
  [InputAction.MOVE_UP]: { keys: ["KeyW", "ArrowUp"] },
  [InputAction.MOVE_DOWN]: { keys: ["KeyS", "ArrowDown"] },
  [InputAction.JUMP]: { keys: ["Space"] },
  [InputAction.RUN]: { keys: ["ShiftLeft", "ShiftRight"] },
  [InputAction.CROUCH]: { keys: ["KeyS"] }, // Contextual
  [InputAction.ROLL]: { keys: ["KeyG"] },
  [InputAction.BACKSTEP]: { keys: ["AltLeft"] },
  [InputAction.SLIDE]: { keys: ["KeyV"] },
  [InputAction.ATTACK_LIGHT]: { keys: [], mouseButtons: [0] }, // LMB
  [InputAction.ATTACK_HEAVY]: { keys: ["KeyE"] },
  [InputAction.BLOCK]: { keys: [], mouseButtons: [2] }, // RMB
  [InputAction.PARRY]: { keys: ["KeyQ"] },
  [InputAction.INTERACT]: { keys: ["KeyF"] },
  [InputAction.WEAPON_1]: { keys: ["Digit1"] },
  [InputAction.WEAPON_2]: { keys: ["Digit2"] },
  [InputAction.WEAPON_3]: { keys: ["Digit3"] },
  [InputAction.WEAPON_4]: { keys: ["Digit4"] },
};

// Mutable active bindings
export let ActiveKeybindings: Record<InputAction, InputBinding> = JSON.parse(
  JSON.stringify(DEFAULT_KEYBINDINGS),
);

const STORAGE_KEY = "edge_keybindings_v1";

function validateBindings(value: unknown): Record<InputAction, InputBinding> {
  const result = JSON.parse(JSON.stringify(DEFAULT_KEYBINDINGS)) as Record<
    InputAction,
    InputBinding
  >;
  if (!value || typeof value !== "object") return result;
  for (const action of Object.values(InputAction)) {
    const binding = (value as Record<string, InputBinding>)[action];
    if (
      !binding ||
      !Array.isArray(binding.keys) ||
      !binding.keys.every(
        (key) => typeof key === "string" && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(key),
      ) ||
      (binding.mouseButtons !== undefined &&
        (!Array.isArray(binding.mouseButtons) ||
          !binding.mouseButtons.every(
            (button) => Number.isInteger(button) && button >= 0 && button <= 4,
          )))
    )
      continue;
    result[action] = {
      keys: [...binding.keys],
      mouseButtons: binding.mouseButtons ? [...binding.mouseButtons] : undefined,
    };
  }
  return result;
}

export function loadKeybindings() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    ActiveKeybindings = validateBindings(stored ? JSON.parse(stored) : DEFAULT_KEYBINDINGS);
  } catch {
    ActiveKeybindings = validateBindings(DEFAULT_KEYBINDINGS);
  }
}

export function saveKeybindings(bindings: Record<InputAction, InputBinding>) {
  ActiveKeybindings = validateBindings(bindings);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ActiveKeybindings));
  } catch {
    /* The current session still uses the selected bindings. */
  }
}

export function resetKeybindings() {
  saveKeybindings(DEFAULT_KEYBINDINGS);
}

export function getBindingLabel(action: InputAction): string {
  const binding = ActiveKeybindings[action];
  return (
    [
      ...binding.keys.map((key) => key.replace(/^Key|^Digit/, "").replace(/Left$|Right$/, "")),
      ...(binding.mouseButtons?.map(
        (button) => ["LMB", "MMB", "RMB"][button] ?? `Mouse ${button + 1}`,
      ) ?? []),
    ].join(" / ") || "Unbound"
  );
}
