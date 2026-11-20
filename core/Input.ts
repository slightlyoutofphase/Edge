import { InputState } from "./Resources";
import { ActiveKeybindings } from "./InputDefinitions";

export class InputManager {
  private state: InputState;
  private canvas: HTMLCanvasElement;
  public captureKeyboard = true;

  private pendingKeysPressed: Set<string> = new Set();
  private pendingKeysReleased: Set<string> = new Set();
  private pendingMouseButtonsPressed: Set<number> = new Set();
  private pendingMouseButtonsReleased: Set<number> = new Set();

  // Bound handlers for cleanup
  private handleKeyDown: (e: KeyboardEvent) => void;
  private handleKeyUp: (e: KeyboardEvent) => void;
  private handleMouseMove: (e: MouseEvent) => void;
  private handleMouseDown: (e: MouseEvent) => void;
  private handleMouseUp: (e: MouseEvent) => void;
  private handleContextMenu: (e: MouseEvent) => void;

  private handleBlur = () => this.reset();
  private handleVisibility = () => {
    if (document.hidden) this.reset();
  };

  constructor(state: InputState, canvas: HTMLCanvasElement) {
    this.state = state;
    this.canvas = canvas;

    this.handleKeyDown = this.onKeyDown.bind(this);
    this.handleKeyUp = this.onKeyUp.bind(this);
    this.handleMouseMove = this.onMouseMove.bind(this);
    this.handleMouseDown = this.onMouseDown.bind(this);
    this.handleMouseUp = this.onMouseUp.bind(this);
    this.handleContextMenu = this.onContextMenu.bind(this);

    window.addEventListener("blur", this.handleBlur);
    if (typeof document !== "undefined")
      document.addEventListener("visibilitychange", this.handleVisibility);
    window.addEventListener("keydown", this.handleKeyDown);
    window.addEventListener("keyup", this.handleKeyUp);
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mousedown", this.handleMouseDown);
    window.addEventListener("mouseup", this.handleMouseUp);
    window.addEventListener("contextmenu", this.handleContextMenu);
  }

  dispose() {
    window.removeEventListener("blur", this.handleBlur);
    if (typeof document !== "undefined")
      document.removeEventListener("visibilitychange", this.handleVisibility);
    window.removeEventListener("keydown", this.handleKeyDown);
    window.removeEventListener("keyup", this.handleKeyUp);
    window.removeEventListener("mousemove", this.handleMouseMove);
    window.removeEventListener("mousedown", this.handleMouseDown);
    window.removeEventListener("mouseup", this.handleMouseUp);
    window.removeEventListener("contextmenu", this.handleContextMenu);
  }

  // Call at start of frame to update state with buffered events
  update() {
    this.state.keysPressed.clear();
    this.state.keysReleased.clear();
    this.state.mouseButtonsPressed.clear();
    this.state.mouseButtonsReleased.clear();

    for (const k of this.pendingKeysPressed) this.state.keysPressed.add(k);
    for (const k of this.pendingKeysReleased) this.state.keysReleased.add(k);
    for (const b of this.pendingMouseButtonsPressed) this.state.mouseButtonsPressed.add(b);
    for (const b of this.pendingMouseButtonsReleased) this.state.mouseButtonsReleased.add(b);

    this.pendingKeysPressed.clear();
    this.pendingKeysReleased.clear();
    this.pendingMouseButtonsPressed.clear();
    this.pendingMouseButtonsReleased.clear();
  }

  reset() {
    this.state.keysDown.clear();
    this.state.keysPressed.clear();
    this.state.keysReleased.clear();
    this.state.mouseButtons.clear();
    this.state.mouseButtonsPressed.clear();
    this.state.mouseButtonsReleased.clear();

    this.pendingKeysPressed.clear();
    this.pendingKeysReleased.clear();
    this.pendingMouseButtonsPressed.clear();
    this.pendingMouseButtonsReleased.clear();

    this.state.mousePosition = { x: 0, y: 0 };
  }

  private onKeyDown(e: KeyboardEvent) {
    if (!this.captureKeyboard) return;
    const target = e.target as HTMLElement | null;
    if (target?.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? ""))
      return;
    if (Object.values(ActiveKeybindings).some((binding) => binding.keys.includes(e.code)))
      e.preventDefault();
    // Prevent repeating
    if (this.state.keysDown.has(e.code)) return;
    this.state.keysDown.add(e.code);
    this.pendingKeysPressed.add(e.code);
  }

  private onKeyUp(e: KeyboardEvent) {
    this.state.keysDown.delete(e.code);
    if (!this.captureKeyboard) return;
    this.pendingKeysReleased.add(e.code);
  }

  private onMouseMove(e: MouseEvent) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return;
    const scaleX = this.canvas.width / rect.width;
    const scaleY = this.canvas.height / rect.height;
    this.state.mousePosition.x = (e.clientX - rect.left) * scaleX;
    this.state.mousePosition.y = (e.clientY - rect.top) * scaleY;
  }

  private onMouseDown(e: MouseEvent) {
    if (e.target !== this.canvas && (e.target as HTMLElement | null)?.tagName) return;
    this.state.mouseButtons.add(e.button);
    this.pendingMouseButtonsPressed.add(e.button);
  }

  private onMouseUp(e: MouseEvent) {
    this.state.mouseButtons.delete(e.button);
    this.pendingMouseButtonsReleased.add(e.button);
  }

  private onContextMenu(e: MouseEvent) {
    if (e.target !== this.canvas && (e.target as HTMLElement | null)?.tagName) return;
    e.preventDefault();
    e.stopPropagation();
    return false;
  }
}
