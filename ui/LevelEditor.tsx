import React, { useEffect, useRef, useState } from "react";
import { Game } from "../core/Game";
import { CameraState, EditorState } from "../core/Resources";
import { validateLevelData } from "../data/LevelValidation";
import { WEAPONS } from "../data/WeaponDefinitions";
import { LevelData, LEVELS } from "../data/Levels";
import { ENEMY_TYPES } from "../data/EnemyTypes";
import { JsonInputDialog, ToastBanner, ToastMessage } from "./DialogOverlay";

interface LevelEditorProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  gameRef: React.MutableRefObject<Game | null>;
  onExit: () => void;
}

type ToolType = "select" | "paint" | "erase";
type EntityType = "tile" | "enemy" | "trigger" | "checkpoint" | "interactable" | "player";

// Default template for a new level
const DEFAULT_LEVEL: LevelData = {
  id: "custom_level",
  width: 2000,
  height: 1000,
  startPos: { x: 96, y: 896 }, // Snapped to 32
  tiles: [{ x: 0, y: 896, width: 2048, height: 96, type: "solid", asset: "stone-floor" }],
  enemies: [],
  checkpoints: [],
  triggers: [],
  interactables: [],
};

const ENEMY_SIZES: Record<string, { w: number; h: number; offsetX: number; offsetY: number }> = {
  hollow: { w: 64, h: 96, offsetX: 32, offsetY: 96 },
  soldier: { w: 64, h: 96, offsetX: 32, offsetY: 96 },
  duelist: { w: 64, h: 96, offsetX: 32, offsetY: 96 },
  rogue: { w: 64, h: 96, offsetX: 32, offsetY: 96 },
  brute: { w: 96, h: 128, offsetX: 48, offsetY: 128 },
  boss: { w: 128, h: 160, offsetX: 64, offsetY: 160 },
  hellhound: { w: 60, h: 32, offsetX: 30, offsetY: 32 },
  alpha_hellhound: { w: 220, h: 110, offsetX: 110, offsetY: 110 },
};

const PLAYER_SIZE = { w: 64, h: 96, offsetX: 32, offsetY: 96 };
const CHECKPOINT_SIZE = { w: 40, h: 60, offsetX: 20, offsetY: 60 };
const INTERACTABLE_SIZE = { w: 32, h: 32, offsetX: 16, offsetY: 32 };

export const LevelEditor: React.FC<LevelEditorProps> = ({ canvasRef, gameRef, onExit }) => {
  const [levelData, setLevelData] = useState<LevelData>(() =>
    JSON.parse(JSON.stringify(DEFAULT_LEVEL)),
  );
  const [selectedTool, setSelectedTool] = useState<ToolType>("select");
  const [selectedCategory, setSelectedCategory] = useState<EntityType>("tile");
  const [gridSize, setGridSize] = useState(32);
  const [showGrid, setShowGrid] = useState(true);
  const [hideBackground, setHideBackground] = useState(true);

  // Selection state
  const [selectedEntityIndex, setSelectedEntityIndex] = useState<number | null>(null);
  const [selectedEntityType, setSelectedEntityType] = useState<EntityType | null>(null);

  // Paint Palette State
  const [paletteItem, setPaletteItem] = useState<any>({
    type: "solid",
    width: 64,
    height: 32,
    asset: "stone-block",
  });

  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [loadModalOpen, setLoadModalOpen] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const isDragging = useRef(false);
  const isMovingEntity = useRef(false);
  const dragStart = useRef({ x: 0, y: 0 }); // World coords
  const camStart = useRef({ x: 0, y: 0 }); // World coords
  const entityStart = useRef({ x: 0, y: 0 }); // World coords
  const levelDataRef = useRef(levelData);
  levelDataRef.current = levelData;

  const showToast = (text: string, variant: ToastMessage["variant"] = "info") => {
    setToast({ id: Date.now(), text, variant });
  };

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const positiveValue = (value: string, fallback: number, maximum = 32768) => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 1 && number <= maximum ? number : fallback;
  };
  const clearSelection = () => {
    setSelectedEntityIndex(null);
    setSelectedEntityType(null);
    isMovingEntity.current = false;
    if (gameRef.current)
      gameRef.current.world.getResource<EditorState>(EditorState).selection = null;
  };
  const selectionExists = () => {
    if (selectedEntityIndex === null || !selectedEntityType) return false;
    const collections = {
      tile: levelData.tiles,
      enemy: levelData.enemies,
      trigger: levelData.triggers,
      checkpoint: levelData.checkpoints,
      interactable: levelData.interactables,
      player: [levelData.startPos],
    };
    return !!collections[selectedEntityType]?.[selectedEntityIndex];
  };
  const replaceLevel = (data: LevelData) => {
    const valid = validateLevelData(data);
    clearSelection();
    setLevelData(JSON.parse(JSON.stringify(valid)));
  };
  const selectCategory = (category: EntityType) => {
    setSelectedCategory(category);
    const defaults: Record<string, any> = {
      tile: { type: "solid", width: 64, height: 32, asset: "stone-block" },
      enemy: { type: "hollow" },
      trigger: {
        type: "transition",
        width: 96,
        height: 192,
        target: Object.keys(LEVELS).find((id) => id !== levelData.id),
      },
      checkpoint: { type: "checkpoint" },
      interactable: { type: "bonfire", prompt: "Rest", data: {} },
      player: { type: "player" },
    };
    setPaletteItem(defaults[category]);
  };

  // Initialize Editor Mode
  useEffect(() => {
    let cancelled = false;

    const initEditor = async () => {
      if (!gameRef.current && canvasRef.current) {
        const game = new Game(canvasRef.current);
        await game.init();
        if (cancelled) {
          game.destroy();
          return;
        }
        gameRef.current = game;
      }

      const game = gameRef.current;
      if (!game || cancelled) return;

      game.editorMode = true;
      game.inputManager.captureKeyboard = false;
      const cam = game.world.getResource(CameraState) as CameraState;
      cam.isManual = true;
      cam.zoom = 1.0;

      const editor = game.world.getResource(EditorState) as EditorState;
      editor.enabled = true;
      editor.gridSize = gridSize;
      editor.showGrid = showGrid;
      editor.hideBackground = hideBackground;

      game.loadLevelFromData(levelDataRef.current);
    };

    void initEditor();

    return () => {
      cancelled = true;
      if (gameRef.current) {
        gameRef.current.editorMode = false;
        const cam = gameRef.current.world.getResource(CameraState) as CameraState;
        cam.isManual = false;
        const editor = gameRef.current.world.getResource(EditorState) as EditorState;
        editor.enabled = false;
      }
    };
  }, []);

  // Update Game when Data Changes
  useEffect(() => {
    if (gameRef.current) {
      try {
        gameRef.current.loadLevelFromData(levelData);
      } catch (error) {
        showToast(error instanceof Error ? error.message : "Invalid level", "error");
        return;
      }

      // Update selection box if valid
      if (selectedEntityIndex !== null && selectedEntityType !== null) {
        updateSelectionBox(selectedEntityType, selectedEntityIndex, levelData);
      } else {
        const editor = gameRef.current.world.getResource(EditorState) as EditorState;
        editor.selection = null;
      }
    }
  }, [levelData]);

  const updateSelectionBox = (
    type: EntityType,
    index: number,
    dataOverride: LevelData = levelData,
  ) => {
    if (!gameRef.current) return;
    const editor = gameRef.current.world.getResource(EditorState) as EditorState;
    editor.selection = null;

    if (type === "tile") {
      const item = dataOverride.tiles[index];
      if (item) editor.selection = { x: item.x, y: item.y, width: item.width, height: item.height };
    } else if (type === "trigger") {
      const item = dataOverride.triggers[index];
      if (item) editor.selection = { x: item.x, y: item.y, width: item.width, height: item.height };
    } else if (type === "enemy") {
      const item = dataOverride.enemies[index];
      if (item) {
        const size = ENEMY_SIZES[item.type] || ENEMY_SIZES["hollow"];
        editor.selection = {
          x: item.x - size.offsetX,
          y: item.y - size.offsetY,
          width: size.w,
          height: size.h,
        };
      }
    } else if (type === "player") {
      const item = dataOverride.startPos;
      const size = PLAYER_SIZE;
      editor.selection = {
        x: item.x - size.offsetX,
        y: item.y - size.offsetY,
        width: size.w,
        height: size.h,
      };
    } else if (type === "checkpoint") {
      const item = dataOverride.checkpoints[index];
      const size = CHECKPOINT_SIZE;
      if (item)
        editor.selection = {
          x: item.x - size.offsetX,
          y: item.y - size.offsetY,
          width: size.w,
          height: size.h,
        };
    } else if (type === "interactable") {
      const item = dataOverride.interactables?.[index]; // safe check
      const size = INTERACTABLE_SIZE;
      if (item)
        editor.selection = {
          x: item.x - size.offsetX,
          y: item.y - size.offsetY,
          width: size.w,
          height: size.h,
        };
    }
  };

  // Update Grid Settings
  useEffect(() => {
    if (gameRef.current) {
      const editor = gameRef.current.world.getResource(EditorState) as EditorState;
      editor.gridSize = gridSize;
      editor.showGrid = showGrid;
      editor.hideBackground = hideBackground;
    }
  }, [gridSize, showGrid, hideBackground]);

  // Coordinate Conversion
  const getMouseWorldPos = (e: React.MouseEvent) => {
    if (!gameRef.current || !canvasRef.current) return { x: 0, y: 0, rawX: 0, rawY: 0 };
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return { x: 0, y: 0, rawX: 0, rawY: 0 };
    const cam = gameRef.current.world.getResource(CameraState) as CameraState;

    // Scale factors (Canvas Pixels per CSS Pixel)
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;

    // Mouse pos in Canvas Pixels (relative to top-left of canvas buffer)
    const canvasX = (e.clientX - rect.left) * scaleX;
    const canvasY = (e.clientY - rect.top) * scaleY;

    // Center of Canvas in Canvas Pixels (RenderSystem translates here)
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;

    // World Pos
    const wx = (canvasX - cx) / cam.zoom + cam.position.x;
    const wy = (canvasY - cy) / cam.zoom + cam.position.y;

    // Grid Snap
    return {
      x: Math.round(wx / gridSize) * gridSize,
      y: Math.round(wy / gridSize) * gridSize,
      rawX: wx,
      rawY: wy,
    };
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!gameRef.current) return;
    const worldPos = getMouseWorldPos(e);
    const editor = gameRef.current.world.getResource(EditorState) as EditorState;

    // Pan (Middle Mouse or Space+Left)
    if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
      isDragging.current = true;
      dragStart.current = { x: e.clientX, y: e.clientY }; // Screen coords for pan delta
      const cam = gameRef.current.world.getResource(CameraState) as CameraState;
      camStart.current = { ...cam.position };
      return;
    }

    if (e.button === 0) {
      if (selectedTool === "select") {
        // Find clicked object (Reverse order to select top-most)
        let found = false;

        const hitRect = (x: number, y: number, w: number, h: number) => {
          return (
            worldPos.rawX >= x &&
            worldPos.rawX <= x + w &&
            worldPos.rawY >= y &&
            worldPos.rawY <= y + h
          );
        };
        // Use Entity visual bounds for click detection
        const hitEntity = (
          x: number,
          y: number,
          size: { w: number; h: number; offsetX: number; offsetY: number },
        ) => {
          const rectX = x - size.offsetX;
          const rectY = y - size.offsetY;
          return hitRect(rectX, rectY, size.w, size.h);
        };

        // 0. Player Start
        if (!found) {
          const px = levelData.startPos.x;
          const py = levelData.startPos.y;
          if (hitEntity(px, py, PLAYER_SIZE)) {
            setSelectedEntityIndex(0); // Dummy
            setSelectedEntityType("player");
            updateSelectionBox("player", 0);
            found = true;
            isMovingEntity.current = true;
            entityStart.current = { x: px, y: py };
            dragStart.current = { x: worldPos.rawX, y: worldPos.rawY };
          }
        }

        // 1. Interactables
        if (!found && levelData.interactables) {
          for (let i = levelData.interactables.length - 1; i >= 0; i--) {
            const it = levelData.interactables[i];
            if (hitEntity(it.x, it.y, INTERACTABLE_SIZE)) {
              setSelectedEntityIndex(i);
              setSelectedEntityType("interactable");
              updateSelectionBox("interactable", i);
              found = true;
              isMovingEntity.current = true;
              entityStart.current = { x: it.x, y: it.y };
              dragStart.current = { x: worldPos.rawX, y: worldPos.rawY };
              break;
            }
          }
        }

        // 2. Checkpoints
        if (!found) {
          for (let i = levelData.checkpoints.length - 1; i >= 0; i--) {
            const cp = levelData.checkpoints[i];
            if (hitEntity(cp.x, cp.y, CHECKPOINT_SIZE)) {
              setSelectedEntityIndex(i);
              setSelectedEntityType("checkpoint");
              updateSelectionBox("checkpoint", i);
              found = true;
              isMovingEntity.current = true;
              entityStart.current = { x: cp.x, y: cp.y };
              dragStart.current = { x: worldPos.rawX, y: worldPos.rawY };
              break;
            }
          }
        }

        // 3. Triggers
        if (!found) {
          for (let i = levelData.triggers.length - 1; i >= 0; i--) {
            const t = levelData.triggers[i];
            if (hitRect(t.x, t.y, t.width, t.height)) {
              setSelectedEntityIndex(i);
              setSelectedEntityType("trigger");
              updateSelectionBox("trigger", i);
              found = true;
              isMovingEntity.current = true;
              entityStart.current = { x: t.x, y: t.y };
              dragStart.current = { x: worldPos.rawX, y: worldPos.rawY };
              break;
            }
          }
        }

        // 4. Enemies
        if (!found) {
          for (let i = levelData.enemies.length - 1; i >= 0; i--) {
            const en = levelData.enemies[i];
            const size = ENEMY_SIZES[en.type] || ENEMY_SIZES["hollow"];
            if (hitEntity(en.x, en.y, size)) {
              setSelectedEntityIndex(i);
              setSelectedEntityType("enemy");
              updateSelectionBox("enemy", i);
              found = true;
              isMovingEntity.current = true;
              entityStart.current = { x: en.x, y: en.y };
              dragStart.current = { x: worldPos.rawX, y: worldPos.rawY };
              break;
            }
          }
        }

        // 5. Tiles
        if (!found) {
          for (let i = levelData.tiles.length - 1; i >= 0; i--) {
            const t = levelData.tiles[i];
            if (hitRect(t.x, t.y, t.width, t.height)) {
              setSelectedEntityIndex(i);
              setSelectedEntityType("tile");
              updateSelectionBox("tile", i);
              found = true;
              isMovingEntity.current = true;
              entityStart.current = { x: t.x, y: t.y };
              dragStart.current = { x: worldPos.rawX, y: worldPos.rawY };
              break;
            }
          }
        }

        if (!found) {
          setSelectedEntityIndex(null);
          setSelectedEntityType(null);
          editor.selection = null;
        }
      } else if (selectedTool === "paint") {
        const newData = JSON.parse(JSON.stringify(levelData)) as LevelData;
        if (selectedCategory === "tile") {
          newData.tiles.push({
            x: worldPos.x,
            y: worldPos.y,
            width: paletteItem.width ?? 32,
            height: paletteItem.height ?? 32,
            type: paletteItem.type,
            asset: paletteItem.asset,
            damage: paletteItem.type === "hazard" ? (paletteItem.damage ?? 10) : undefined,
          });
        } else if (selectedCategory === "enemy") {
          newData.enemies.push({ type: paletteItem.type, x: worldPos.x, y: worldPos.y });
        } else if (selectedCategory === "trigger") {
          newData.triggers.push({
            type: paletteItem.type,
            width: paletteItem.width ?? 96,
            height: paletteItem.height ?? 192,
            x: worldPos.x,
            y: worldPos.y,
            ...(paletteItem.target ? { target: paletteItem.target } : {}),
            ...(paletteItem.bounds ? { bounds: paletteItem.bounds } : {}),
          });
        } else if (selectedCategory === "checkpoint") {
          newData.checkpoints.push({
            id: `cp_${Date.now()}`,
            x: worldPos.x,
            y: worldPos.y,
            facing: 1,
          });
        } else if (selectedCategory === "interactable") {
          if (!newData.interactables) newData.interactables = [];
          newData.interactables.push({ ...paletteItem, x: worldPos.x, y: worldPos.y });
        } else if (selectedCategory === "player") {
          newData.startPos = { x: worldPos.x, y: worldPos.y };
        }
        try {
          setLevelData(validateLevelData(newData));
        } catch (error) {
          showToast(error instanceof Error ? error.message : "Invalid placement", "error");
        }
      } else if (selectedTool === "erase") {
        clearSelection();
        const newData = JSON.parse(JSON.stringify(levelData)) as LevelData;
        let found = false;

        // Tiles
        if (!found) {
          for (let i = newData.tiles.length - 1; i >= 0; i--) {
            const t = newData.tiles[i];
            if (
              worldPos.rawX >= t.x &&
              worldPos.rawX <= t.x + t.width &&
              worldPos.rawY >= t.y &&
              worldPos.rawY <= t.y + t.height
            ) {
              newData.tiles.splice(i, 1);
              found = true;
              break;
            }
          }
        }
        // Enemies
        if (!found) {
          for (let i = newData.enemies.length - 1; i >= 0; i--) {
            const e = newData.enemies[i];
            const size = ENEMY_SIZES[e.type] || ENEMY_SIZES["hollow"];
            const rectX = e.x - size.offsetX;
            const rectY = e.y - size.offsetY;
            if (
              worldPos.rawX >= rectX &&
              worldPos.rawX <= rectX + size.w &&
              worldPos.rawY >= rectY &&
              worldPos.rawY <= rectY + size.h
            ) {
              newData.enemies.splice(i, 1);
              found = true;
              break;
            }
          }
        }
        // Triggers
        if (!found) {
          for (let i = newData.triggers.length - 1; i >= 0; i--) {
            const t = newData.triggers[i];
            if (
              worldPos.rawX >= t.x &&
              worldPos.rawX <= t.x + t.width &&
              worldPos.rawY >= t.y &&
              worldPos.rawY <= t.y + t.height
            ) {
              newData.triggers.splice(i, 1);
              found = true;
              break;
            }
          }
        }
        // Checkpoints
        if (!found) {
          for (let i = newData.checkpoints.length - 1; i >= 0; i--) {
            const cp = newData.checkpoints[i];
            const size = CHECKPOINT_SIZE;
            const rectX = cp.x - size.offsetX;
            const rectY = cp.y - size.offsetY;
            if (
              worldPos.rawX >= rectX &&
              worldPos.rawX <= rectX + size.w &&
              worldPos.rawY >= rectY &&
              worldPos.rawY <= rectY + size.h
            ) {
              newData.checkpoints.splice(i, 1);
              found = true;
              break;
            }
          }
        }
        // Interactables
        if (!found && newData.interactables) {
          for (let i = newData.interactables.length - 1; i >= 0; i--) {
            const it = newData.interactables[i];
            const size = INTERACTABLE_SIZE;
            const rectX = it.x - size.offsetX;
            const rectY = it.y - size.offsetY;
            if (
              worldPos.rawX >= rectX &&
              worldPos.rawX <= rectX + size.w &&
              worldPos.rawY >= rectY &&
              worldPos.rawY <= rectY + size.h
            ) {
              newData.interactables.splice(i, 1);
              found = true;
              break;
            }
          }
        }

        if (found) setLevelData(newData);
      }
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!gameRef.current) return;
    const editor = gameRef.current.world.getResource(EditorState) as EditorState;

    // Camera Pan
    if (isDragging.current && canvasRef.current) {
      const canvas = canvasRef.current;
      const rect = canvas.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return;
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const zoom = (gameRef.current.world.getResource(CameraState) as CameraState).zoom;

      const dx = ((e.clientX - dragStart.current.x) * scaleX) / zoom;
      const dy = ((e.clientY - dragStart.current.y) * scaleY) / zoom;

      const cam = gameRef.current.world.getResource(CameraState) as CameraState;
      cam.position.x = camStart.current.x - dx;
      cam.position.y = camStart.current.y - dy;
      return;
    }

    // Entity Dragging (Preview Ghost)
    if (isMovingEntity.current && selectedEntityIndex !== null) {
      if (!selectionExists()) {
        clearSelection();
        return;
      }
      const worldPos = getMouseWorldPos(e);
      // Calculate delta from drag start in world units
      const dx = worldPos.rawX - dragStart.current.x;
      const dy = worldPos.rawY - dragStart.current.y;

      const rawNewX = entityStart.current.x + dx;
      const rawNewY = entityStart.current.y + dy;

      // Snap to grid
      const snappedX = Math.round(rawNewX / gridSize) * gridSize;
      const snappedY = Math.round(rawNewY / gridSize) * gridSize;

      // Calculate Visual Ghost Rect
      let w = 0,
        h = 0,
        offX = 0,
        offY = 0;
      if (selectedEntityType === "tile") {
        const item = levelData.tiles[selectedEntityIndex];
        w = item.width;
        h = item.height;
      } else if (selectedEntityType === "enemy") {
        const item = levelData.enemies[selectedEntityIndex];
        const size = ENEMY_SIZES[item.type] || ENEMY_SIZES["hollow"];
        w = size.w;
        h = size.h;
        offX = size.offsetX;
        offY = size.offsetY;
      } else if (selectedEntityType === "trigger") {
        const item = levelData.triggers[selectedEntityIndex];
        w = item.width;
        h = item.height;
      } else if (selectedEntityType === "player") {
        w = PLAYER_SIZE.w;
        h = PLAYER_SIZE.h;
        offX = PLAYER_SIZE.offsetX;
        offY = PLAYER_SIZE.offsetY;
      } else if (selectedEntityType === "checkpoint") {
        w = CHECKPOINT_SIZE.w;
        h = CHECKPOINT_SIZE.h;
        offX = CHECKPOINT_SIZE.offsetX;
        offY = CHECKPOINT_SIZE.offsetY;
      } else if (selectedEntityType === "interactable") {
        w = INTERACTABLE_SIZE.w;
        h = INTERACTABLE_SIZE.h;
        offX = INTERACTABLE_SIZE.offsetX;
        offY = INTERACTABLE_SIZE.offsetY;
      }

      // Ghost uses Top-Left logic in RenderSystem debug draw, so offset for entities
      editor.ghost = {
        x: snappedX - offX,
        y: snappedY - offY,
        width: w,
        height: h,
        type: selectedEntityType!,
      };
      editor.selection = null; // Hide current selection
    }
  };

  const handleMouseUp = () => {
    if (isDragging.current) {
      isDragging.current = false;
    }

    // Commit Move
    if (isMovingEntity.current && selectedEntityIndex !== null && gameRef.current) {
      if (!selectionExists()) {
        clearSelection();
        return;
      }
      const editor = gameRef.current.world.getResource(EditorState) as EditorState;
      if (editor.ghost) {
        const newData = JSON.parse(JSON.stringify(levelData)) as LevelData;
        // Recover original X/Y from ghost rect (which might be offset)
        let newX = editor.ghost.x;
        let newY = editor.ghost.y;

        // Add back offsets
        if (selectedEntityType === "enemy") {
          const item = newData.enemies[selectedEntityIndex];
          const size = ENEMY_SIZES[item.type] || ENEMY_SIZES["hollow"];
          newX += size.offsetX;
          newY += size.offsetY;
        } else if (selectedEntityType === "player") {
          newX += PLAYER_SIZE.offsetX;
          newY += PLAYER_SIZE.offsetY;
        } else if (selectedEntityType === "checkpoint") {
          newX += CHECKPOINT_SIZE.offsetX;
          newY += CHECKPOINT_SIZE.offsetY;
        } else if (selectedEntityType === "interactable") {
          newX += INTERACTABLE_SIZE.offsetX;
          newY += INTERACTABLE_SIZE.offsetY;
        }

        if (selectedEntityType === "tile") {
          newData.tiles[selectedEntityIndex].x = newX;
          newData.tiles[selectedEntityIndex].y = newY;
        } else if (selectedEntityType === "enemy") {
          newData.enemies[selectedEntityIndex].x = newX;
          newData.enemies[selectedEntityIndex].y = newY;
        } else if (selectedEntityType === "trigger") {
          newData.triggers[selectedEntityIndex].x = newX;
          newData.triggers[selectedEntityIndex].y = newY;
        } else if (selectedEntityType === "player") {
          newData.startPos.x = newX;
          newData.startPos.y = newY;
        } else if (selectedEntityType === "checkpoint") {
          newData.checkpoints[selectedEntityIndex].x = newX;
          newData.checkpoints[selectedEntityIndex].y = newY;
        } else if (selectedEntityType === "interactable") {
          if (newData.interactables) {
            newData.interactables[selectedEntityIndex].x = newX;
            newData.interactables[selectedEntityIndex].y = newY;
          }
        }
        setLevelData(newData);

        updateSelectionBox(selectedEntityType!, selectedEntityIndex, newData);
      }
      editor.ghost = null;
      isMovingEntity.current = false;
    }
  };

  const handleWheel = (e: React.WheelEvent) => {
    if (!gameRef.current) return;
    const cam = gameRef.current.world.getResource(CameraState) as CameraState;
    const zoomSpeed = 0.1;
    cam.zoom = Math.max(0.1, Math.min(5.0, cam.zoom - Math.sign(e.deltaY) * zoomSpeed));
  };

  const handleSave = () => {
    const json = JSON.stringify(levelData, null, 2);
    navigator.clipboard
      .writeText(json)
      .then(() => showToast("Level JSON copied to clipboard!", "success"))
      .catch(() => showToast("Failed to copy level JSON to clipboard.", "error"));
  };

  const handleLoad = () => {
    setLoadError(null);
    setLoadModalOpen(true);
  };

  const handleLoadSubmit = (json: string) => {
    try {
      const parsed = JSON.parse(json);
      const sanitized = {
        ...parsed,
        tiles: Array.isArray(parsed.tiles)
          ? parsed.tiles.map((t: any) => ({
              ...t,
              width: t.width ?? 32,
              height: t.height ?? 32,
            }))
          : [],
        checkpoints: Array.isArray(parsed.checkpoints)
          ? parsed.checkpoints.map((cp: any) => ({
              id: cp.id,
              x: cp.x,
              y: cp.y,
              facing: cp.facing,
            }))
          : [],
      } as LevelData;
      replaceLevel(sanitized);
      setLoadModalOpen(false);
      setLoadError(null);
      showToast("Level JSON loaded.", "success");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Invalid JSON");
    }
  };

  const handleLoadPreset = (key: string) => {
    if (LEVELS[key]) {
      replaceLevel(LEVELS[key]);
    }
  };

  const handleSnapSelection = () => {
    if (selectedEntityIndex === null || !gameRef.current) return;
    if (!selectionExists()) {
      clearSelection();
      return;
    }

    const newData = JSON.parse(JSON.stringify(levelData)) as LevelData;
    let changed = false;

    if (selectedEntityType === "tile") {
      const t = newData.tiles[selectedEntityIndex];
      t.x = Math.round(t.x / gridSize) * gridSize;
      t.y = Math.round(t.y / gridSize) * gridSize;
      changed = true;
    } else if (selectedEntityType === "enemy") {
      const e = newData.enemies[selectedEntityIndex];
      e.x = Math.round(e.x / gridSize) * gridSize;
      e.y = Math.round(e.y / gridSize) * gridSize;
      changed = true;
    } else if (selectedEntityType === "player") {
      newData.startPos.x = Math.round(newData.startPos.x / gridSize) * gridSize;
      newData.startPos.y = Math.round(newData.startPos.y / gridSize) * gridSize;
      changed = true;
    } else if (selectedEntityType === "checkpoint") {
      const c = newData.checkpoints[selectedEntityIndex];
      c.x = Math.round(c.x / gridSize) * gridSize;
      c.y = Math.round(c.y / gridSize) * gridSize;
      changed = true;
    } else if (selectedEntityType === "interactable" && newData.interactables) {
      const i = newData.interactables[selectedEntityIndex];
      i.x = Math.round(i.x / gridSize) * gridSize;
      i.y = Math.round(i.y / gridSize) * gridSize;
      changed = true;
    } else if (selectedEntityType === "trigger") {
      const t = newData.triggers[selectedEntityIndex];
      t.x = Math.round(t.x / gridSize) * gridSize;
      t.y = Math.round(t.y / gridSize) * gridSize;
      changed = true;
    }

    if (changed) setLevelData(newData);
  };

  return (
    <div className="absolute inset-0 z-50 flex pointer-events-none">
      {/* Interaction Overlay for Canvas */}
      <div
        className="absolute inset-0 pointer-events-auto"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        onWheel={handleWheel}
      />

      {/* Toolbar - Top */}
      <div className="absolute top-0 left-0 right-0 h-12 bg-neutral-900 border-b border-white/10 flex items-center px-4 gap-4 pointer-events-auto">
        <h1 className="font-bold text-white mr-4">LEVEL EDITOR</h1>

        <div className="flex gap-2 border-r border-white/10 pr-4">
          <button
            onClick={() => setSelectedTool("select")}
            className={`px-3 py-1 text-xs font-bold rounded ${selectedTool === "select" ? "bg-blue-600" : "bg-neutral-800"}`}>
            SELECT
          </button>
          <button
            onClick={() => setSelectedTool("paint")}
            className={`px-3 py-1 text-xs font-bold rounded ${selectedTool === "paint" ? "bg-blue-600" : "bg-neutral-800"}`}>
            PAINT
          </button>
          <button
            onClick={() => setSelectedTool("erase")}
            className={`px-3 py-1 text-xs font-bold rounded ${selectedTool === "erase" ? "bg-blue-600" : "bg-neutral-800"}`}>
            ERASE
          </button>
        </div>

        <div className="flex gap-4 items-center">
          <div className="flex items-center gap-2">
            <span className="text-xs text-neutral-400">Grid:</span>
            <input
              type="number"
              value={gridSize}
              onChange={(e) => setGridSize(positiveValue(e.target.value, gridSize, 256))}
              className="w-12 bg-neutral-800 border border-white/10 px-2 py-1 text-xs rounded text-center"
            />
          </div>
          <button
            onClick={() => setShowGrid(!showGrid)}
            className={`px-2 py-1 text-[10px] font-bold rounded uppercase ${showGrid ? "bg-green-900/50 text-green-200" : "bg-neutral-800 text-neutral-500"}`}>
            {showGrid ? "Grid On" : "Grid Off"}
          </button>
          <button
            onClick={() => setHideBackground(!hideBackground)}
            className={`px-2 py-1 text-[10px] font-bold rounded uppercase ${hideBackground ? "bg-red-900/50 text-red-200" : "bg-neutral-800 text-neutral-500"}`}>
            {hideBackground ? "No BG" : "Show BG"}
          </button>
          {selectedEntityIndex !== null && (
            <button
              onClick={handleSnapSelection}
              className="px-2 py-1 bg-yellow-600/50 hover:bg-yellow-600 text-yellow-100 text-[10px] font-bold rounded uppercase">
              Snap Selected
            </button>
          )}
        </div>

        <div className="flex-1" />

        <div className="flex gap-2">
          <button
            onClick={() => replaceLevel(DEFAULT_LEVEL)}
            className="px-3 py-1 bg-red-900/50 hover:bg-red-900 text-xs font-bold rounded">
            New
          </button>
          <button
            onClick={handleLoad}
            className="px-3 py-1 bg-neutral-800 hover:bg-neutral-700 text-xs font-bold rounded">
            Load JSON
          </button>
          <button
            onClick={handleSave}
            className="px-3 py-1 bg-green-900/50 hover:bg-green-900 text-xs font-bold rounded">
            Save JSON
          </button>
          <button
            onClick={onExit}
            className="px-3 py-1 bg-neutral-800 hover:bg-white/10 text-xs font-bold rounded">
            Exit
          </button>
        </div>
      </div>

      {/* Palette - Left */}
      <div className="absolute top-12 left-0 bottom-0 w-64 bg-neutral-900/90 border-r border-white/10 backdrop-blur pointer-events-auto overflow-y-auto flex flex-col">
        {/* Categories */}
        <div className="flex flex-wrap border-b border-white/10">
          {["tile", "enemy", "trigger", "checkpoint", "interactable", "player"].map((cat) => (
            <button
              key={cat}
              onClick={() => selectCategory(cat as EntityType)}
              className={`flex-1 min-w-[33%] py-2 text-[10px] font-bold uppercase ${selectedCategory === cat ? "bg-white/10 text-white" : "text-neutral-500 hover:bg-white/5"}`}>
              {cat}
            </button>
          ))}
        </div>

        <div className="p-4 space-y-2">
          {selectedCategory === "tile" && (
            <>
              <div className="text-xs font-bold text-neutral-500 mb-2 uppercase flex justify-between">
                <span>Type</span>
                <span className="text-[9px] text-neutral-600 font-normal normal-case">
                  {paletteItem.type === "semisolid" ? "Jump-through platform" : ""}
                </span>
              </div>
              {paletteItem.type === "hazard" && (
                <label className="block text-xs">
                  Damage
                  <input
                    type="number"
                    min="0"
                    value={paletteItem.damage ?? 10}
                    onChange={(e) => {
                      const damage = Number(e.target.value);
                      if (Number.isFinite(damage) && damage >= 0)
                        setPaletteItem({ ...paletteItem, damage });
                    }}
                    className="w-full bg-black border border-white/10 px-2 py-1"
                  />
                </label>
              )}
              {["solid", "semisolid", "hazard", "ladder"].map((type) => (
                <button
                  key={type}
                  onClick={() =>
                    setPaletteItem({
                      ...paletteItem,
                      type,
                      damage: type === "hazard" ? (paletteItem.damage ?? 10) : undefined,
                      asset:
                        type === "solid"
                          ? "stone-wall"
                          : type === "hazard"
                            ? "hazard-spikes"
                            : "stone-platform",
                    })
                  }
                  className={`w-full text-left px-3 py-2 rounded text-xs border ${paletteItem.type === type ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/30"}`}>
                  {type}
                </button>
              ))}

              <div className="text-xs font-bold text-neutral-500 mt-4 mb-2 uppercase">Asset</div>
              {[
                "stone-wall",
                "stone-floor",
                "stone-platform",
                "hazard-spikes",
                "ladder",
                "stone-block",
              ].map((asset) => (
                <button
                  key={asset}
                  onClick={() => setPaletteItem({ ...paletteItem, asset })}
                  className={`w-full text-left px-3 py-2 rounded text-xs border ${paletteItem.asset === asset ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/30"}`}>
                  {asset}
                </button>
              ))}

              <div className="text-xs font-bold text-neutral-500 mt-4 mb-2 uppercase">
                Dimensions
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={paletteItem.width}
                  onChange={(e) =>
                    setPaletteItem({
                      ...paletteItem,
                      width: positiveValue(e.target.value, paletteItem.width ?? 32),
                    })
                  }
                  className="w-1/2 bg-black border border-white/10 px-2 py-1 text-xs"
                  placeholder="W"
                />
                <input
                  type="number"
                  value={paletteItem.height}
                  onChange={(e) =>
                    setPaletteItem({
                      ...paletteItem,
                      height: positiveValue(e.target.value, paletteItem.height ?? 32),
                    })
                  }
                  className="w-1/2 bg-black border border-white/10 px-2 py-1 text-xs"
                  placeholder="H"
                />
              </div>
            </>
          )}

          {selectedCategory === "enemy" && (
            <>
              <div className="text-xs font-bold text-neutral-500 mb-2 uppercase">Enemy Type</div>
              {ENEMY_TYPES.map((type) => (
                <button
                  key={type}
                  onClick={() => setPaletteItem({ type })}
                  className={`w-full text-left px-3 py-2 rounded text-xs border ${paletteItem.type === type ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/30"}`}>
                  {type.replaceAll("_", " ").toUpperCase()}
                </button>
              ))}
            </>
          )}

          {selectedCategory === "trigger" && (
            <>
              <div className="text-xs font-bold text-neutral-500 mb-2 uppercase">Trigger Type</div>
              {paletteItem.type === "transition" && (
                <label className="block text-xs">
                  Destination
                  <select
                    value={paletteItem.target ?? "level1"}
                    onChange={(e) => setPaletteItem({ ...paletteItem, target: e.target.value })}
                    className="w-full bg-black border border-white/10 px-2 py-1">
                    {Object.keys(LEVELS)
                      .filter((id) => id !== levelData.id)
                      .map((id) => (
                        <option key={id}>{id}</option>
                      ))}
                  </select>
                </label>
              )}
              {paletteItem.bounds &&
                (["min", "max"] as const).map((edge) => (
                  <div key={edge} className="flex gap-2">
                    {(["x", "y"] as const).map((axis) => (
                      <label key={axis} className="text-xs">
                        {edge} {axis}
                        <input
                          type="number"
                          value={paletteItem.bounds[edge][axis]}
                          onChange={(e) => {
                            const value = Number(e.target.value);
                            if (Number.isFinite(value))
                              setPaletteItem({
                                ...paletteItem,
                                bounds: {
                                  ...paletteItem.bounds,
                                  [edge]: { ...paletteItem.bounds[edge], [axis]: value },
                                },
                              });
                          }}
                          className="w-full bg-black border border-white/10 px-2 py-1"
                        />
                      </label>
                    ))}
                  </div>
                ))}
              {["transition", "boss_start", "camera_lock", "victory"].map((type) => (
                <button
                  key={type}
                  onClick={() =>
                    setPaletteItem({
                      ...paletteItem,
                      type,
                      width: 96,
                      height: 192,
                      target:
                        type === "transition"
                          ? Object.keys(LEVELS).find((id) => id !== levelData.id)
                          : undefined,
                      bounds:
                        type === "camera_lock" || type === "boss_start"
                          ? { min: { x: 0, y: 0 }, max: { x: 1024, y: 768 } }
                          : undefined,
                    })
                  }
                  className={`w-full text-left px-3 py-2 rounded text-xs border ${paletteItem.type === type ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/30"}`}>
                  {type}
                </button>
              ))}
              <div className="text-xs font-bold text-neutral-500 mt-4 mb-2 uppercase">
                Dimensions
              </div>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={paletteItem.width || 96}
                  onChange={(e) =>
                    setPaletteItem({
                      ...paletteItem,
                      width: positiveValue(e.target.value, paletteItem.width ?? 32),
                    })
                  }
                  className="w-1/2 bg-black border border-white/10 px-2 py-1 text-xs"
                  placeholder="W"
                />
                <input
                  type="number"
                  value={paletteItem.height || 192}
                  onChange={(e) =>
                    setPaletteItem({
                      ...paletteItem,
                      height: positiveValue(e.target.value, paletteItem.height ?? 32),
                    })
                  }
                  className="w-1/2 bg-black border border-white/10 px-2 py-1 text-xs"
                  placeholder="H"
                />
              </div>
            </>
          )}

          {selectedCategory === "checkpoint" && (
            <>
              <div className="text-xs font-bold text-neutral-500 mb-2 uppercase">
                New Checkpoint
              </div>
              <button
                onClick={() => setPaletteItem({ type: "checkpoint" })}
                className="w-full text-left px-3 py-2 rounded text-xs border border-blue-500 bg-blue-500/10">
                Standard Checkpoint
              </button>
              <p className="text-[10px] text-neutral-500 mt-2">
                ID will be auto-generated on placement.
              </p>
            </>
          )}

          {selectedCategory === "interactable" && (
            <>
              <div className="text-xs font-bold text-neutral-500 mb-2 uppercase">Type</div>
              {["bonfire", "chest", "lever", "door"].map((type) => (
                <button
                  key={type}
                  onClick={() =>
                    setPaletteItem({
                      ...paletteItem,
                      type,
                      prompt: type === "bonfire" ? "Rest" : "Interact",
                      data: type === "chest" ? { weaponId: "longsword" } : {},
                    })
                  }
                  className={`w-full text-left px-3 py-2 rounded text-xs border ${paletteItem.type === type ? "border-blue-500 bg-blue-500/10" : "border-white/10 hover:border-white/30"}`}>
                  {type.replaceAll("_", " ").toUpperCase()}
                </button>
              ))}
              {paletteItem.type === "chest" && (
                <label className="block text-xs">
                  Weapon
                  <select
                    value={paletteItem.data?.weaponId ?? "longsword"}
                    onChange={(e) =>
                      setPaletteItem({
                        ...paletteItem,
                        data: { ...paletteItem.data, weaponId: e.target.value },
                      })
                    }
                    className="w-full bg-black border border-white/10 px-2 py-1">
                    {Object.keys(WEAPONS).map((id) => (
                      <option key={id}>{id}</option>
                    ))}
                  </select>
                </label>
              )}
              <div className="text-xs font-bold text-neutral-500 mt-4 mb-2 uppercase">Prompt</div>
              <input
                type="text"
                value={paletteItem.prompt || ""}
                onChange={(e) => setPaletteItem({ ...paletteItem, prompt: e.target.value })}
                className="w-full bg-black border border-white/10 px-2 py-1 text-xs"
                placeholder="Action Prompt"
              />
            </>
          )}

          {selectedCategory === "player" && (
            <>
              <div className="text-xs font-bold text-neutral-500 mb-2 uppercase">Player Spawn</div>
              <div className="px-3 py-2 rounded text-xs border border-blue-500 bg-blue-500/10">
                Start Position ({levelData.startPos.x}, {levelData.startPos.y})
              </div>
              <p className="text-[10px] text-neutral-500 mt-2">
                Select PAINT and click anywhere on the canvas to move the player start position.
              </p>
            </>
          )}
        </div>

        <div className="mt-auto p-4 border-t border-white/10">
          <div className="text-xs font-bold text-neutral-500 mb-2 uppercase">Load Preset</div>
          <div className="grid grid-cols-2 gap-2">
            {Object.keys(LEVELS).map((k) => (
              <button
                key={k}
                onClick={() => handleLoadPreset(k)}
                className="px-2 py-1 bg-neutral-800 text-[10px] rounded hover:bg-white/10">
                {k}
              </button>
            ))}
          </div>
        </div>
      </div>

      <JsonInputDialog
        open={loadModalOpen}
        title="Load Level JSON"
        placeholder="Paste exported Level JSON here..."
        error={loadError}
        onSubmit={handleLoadSubmit}
        onCancel={() => {
          setLoadModalOpen(false);
          setLoadError(null);
        }}
      />
      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
};
