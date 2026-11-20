import React, { useCallback, useEffect, useRef, useState } from "react";
import { Game } from "./core/Game";
import { AnimationViewer } from "./tools/AnimationViewer";
import { BattleState } from "./core/Resources";
import { loadKeybindings } from "./core/InputDefinitions";
import { MainMenu } from "./ui/MainMenu";
import { LevelEditor } from "./ui/LevelEditor";
import { ControlsMenu } from "./ui/ControlsMenu";
import { GameHUD } from "./ui/GameHUD";
import { BattleHUD } from "./ui/BattleHUD";
import { AnimationViewerPanel } from "./ui/AnimationViewerPanel";
import { ContentEditorPanel } from "./ui/ContentEditorPanel";
import { OptionsMenu } from "./ui/OptionsMenu";
import { TestRunnerView } from "./ui/TestRunnerView";
import { ToastBanner, ToastMessage } from "./ui/DialogOverlay";

type ViewState =
  "menu" | "game" | "tests" | "options" | "viewer" | "battle" | "tweaker" | "editor" | "controls";

const App: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const gameRef = useRef<Game | null>(null);
  const viewerRef = useRef<AnimationViewer | null>(null);

  const [view, setView] = useState<ViewState>("menu");
  const [_loading, setLoading] = useState(false);
  const [fadeOpacity, setFadeOpacity] = useState(0);
  const [showTeamMarkers, setShowTeamMarkers] = useState(false);
  const [viewerInitialAnim, setViewerInitialAnim] = useState("idle");
  const [toast, setToast] = useState<ToastMessage | null>(null);

  const showToast = useCallback((text: string, variant: ToastMessage["variant"] = "info") => {
    setToast({ id: Date.now(), text, variant });
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  // Initialization & canvas sizing
  useEffect(() => {
    loadKeybindings();

    const handleResize = () => {
      if (canvasRef.current) {
        canvasRef.current.width = window.innerWidth;
        canvasRef.current.height = window.innerHeight;
      }
    };
    window.addEventListener("resize", handleResize);
    handleResize();
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Only intercept keyboard gameplay bindings while actively playing in the game view
  useEffect(() => {
    if (gameRef.current) {
      gameRef.current.inputManager.captureKeyboard = view === "game";
    }
  }, [view]);

  useEffect(() => {
    return () => {
      if (gameRef.current) gameRef.current.destroy();
      if (viewerRef.current) viewerRef.current.destroy();
    };
  }, []);

  const disposeInstances = () => {
    if (gameRef.current) {
      gameRef.current.destroy();
      gameRef.current = null;
    }
    if (viewerRef.current) {
      viewerRef.current.destroy();
      viewerRef.current = null;
    }
  };

  const startGame = async () => {
    if (!canvasRef.current) return;
    setLoading(true);
    disposeInstances();
    const game = new Game(canvasRef.current);
    await game.init();
    game.inputManager.captureKeyboard = true;
    game.onUIUpdate = (data) => {
      if (data.fade !== undefined) setFadeOpacity(data.fade);
    };
    game.loadLevel("level1");
    gameRef.current = game;
    setLoading(false);
    setView("game");
  };

  const startBattleMode = async () => {
    if (!canvasRef.current) return;
    setLoading(true);
    disposeInstances();
    const game = new Game(canvasRef.current);
    await game.init();
    game.inputManager.captureKeyboard = false;
    game.loadLevel("arena");
    game.world.getResource<BattleState>(BattleState).showTeamMarkers = showTeamMarkers;
    gameRef.current = game;
    setLoading(false);
    setView("battle");
  };

  const startTestRunner = async () => {
    if (!canvasRef.current) return;
    setLoading(true);
    disposeInstances();
    const game = new Game(canvasRef.current);
    await game.init();
    game.inputManager.captureKeyboard = false;
    game.running = false;
    gameRef.current = game;
    setLoading(false);
    setView("tests");
  };

  const startAnimationViewer = async () => {
    if (!canvasRef.current) return;
    setLoading(true);
    disposeInstances();
    const viewer = new AnimationViewer(canvasRef.current);
    await viewer.init();
    viewerRef.current = viewer;
    setViewerInitialAnim(viewer.currentAnimName || "idle");
    setLoading(false);
    setView("viewer");
  };

  const startLevelEditor = () => {
    disposeInstances();
    setView("editor");
  };

  const quitToMenu = () => {
    disposeInstances();
    setView("menu");
    setFadeOpacity(0);
  };

  return (
    <div className="relative w-full h-screen bg-neutral-900 overflow-hidden font-sans select-none">
      <canvas
        ref={canvasRef}
        width={window.innerWidth}
        height={window.innerHeight}
        className={`absolute top-0 left-0 w-full h-full block ${view === "game" || view === "viewer" || view === "battle" || view === "editor" ? "opacity-100" : "opacity-0 pointer-events-none"}`}
      />

      <div
        className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-75"
        style={{ opacity: fadeOpacity, zIndex: 100 }}
      />

      {view === "menu" && (
        <MainMenu
          onStartGame={startGame}
          onBattleMode={startBattleMode}
          onLevelEditor={startLevelEditor}
          onAnimationEditor={startAnimationViewer}
          onContentEditor={() => setView("tweaker")}
          onRunTests={startTestRunner}
          onControls={() => setView("controls")}
          onOptions={() => setView("options")}
        />
      )}

      {view === "controls" && <ControlsMenu onBack={() => setView("menu")} />}

      {view === "editor" && (
        <LevelEditor canvasRef={canvasRef} gameRef={gameRef} onExit={quitToMenu} />
      )}

      {view === "game" && <GameHUD gameRef={gameRef} onQuitToMenu={quitToMenu} />}

      {view === "tweaker" && (
        <ContentEditorPanel onBack={() => setView("menu")} onToast={showToast} />
      )}

      {view === "battle" && (
        <BattleHUD
          gameRef={gameRef}
          showTeamMarkers={showTeamMarkers}
          onToggleTeamMarkers={setShowTeamMarkers}
          onQuitToMenu={quitToMenu}
        />
      )}

      {view === "options" && <OptionsMenu onBack={() => setView("menu")} />}

      {view === "viewer" && (
        <AnimationViewerPanel
          viewerRef={viewerRef}
          initialAnim={viewerInitialAnim}
          onQuitToMenu={quitToMenu}
          onToast={showToast}
        />
      )}

      {view === "tests" && <TestRunnerView gameRef={gameRef} onQuitToMenu={quitToMenu} />}

      <ToastBanner toast={toast} onDismiss={() => setToast(null)} />
    </div>
  );
};

export default App;
