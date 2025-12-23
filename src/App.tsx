import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Suspense, useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { Github } from "lucide-react";
import { lazy } from "react";

const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Share = lazy(() => import("./pages/Share"));
const NotFound = lazy(() => import("./pages/NotFound"));

const REPO_URL = "https://github.com/tytsxai/telegram-ui-builder";
const ROUTER_BASENAME =
  import.meta.env.BASE_URL === "/" ? undefined : import.meta.env.BASE_URL.replace(/\/$/, "");

type BadgePos = { x: number; y: number };

const clampPos = (pos: BadgePos): BadgePos => {
  if (typeof window === "undefined") return pos;
  const margin = 8;
  const size = 44; // badge diameter
  const maxX = Math.max(margin, window.innerWidth - size - margin);
  const maxY = Math.max(margin, window.innerHeight - size - margin);
  return {
    x: Math.min(Math.max(pos.x, margin), maxX),
    y: Math.min(Math.max(pos.y, margin), maxY),
  };
};

const RepoBadge = () => {
  const [pos, setPos] = useState<BadgePos>(() => clampPos({ x: 12, y: 100 }));
  const dragRef = useRef<{ offsetX: number; offsetY: number } | null>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      const saved = localStorage.getItem("repo_badge_pos");
      if (saved) {
        const parsed = JSON.parse(saved) as BadgePos;
        setPos(clampPos(parsed));
      } else {
        setPos(clampPos({ x: 12, y: window.innerHeight - 90 }));
      }
    } catch (e) {
      void e;
    }
  }, []);

  useEffect(() => {
    try {
      if (typeof window === "undefined") return;
      localStorage.setItem("repo_badge_pos", JSON.stringify(pos));
    } catch (e) {
      void e;
    }
  }, [pos]);

  useEffect(() => {
    const handleResize = () => setPos((p) => clampPos(p));
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  useEffect(() => {
    const handleMove = (e: PointerEvent) => {
      if (!dragRef.current) return;
      isDraggingRef.current = true;
      setPos((prev) =>
        clampPos({
          x: e.clientX - dragRef.current!.offsetX,
          y: e.clientY - dragRef.current!.offsetY,
        }),
      );
    };
    const handleUp = () => {
      isDraggingRef.current = false;
      dragRef.current = null;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };
  }, []);

  const handlePointerDown = (e: React.PointerEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    isDraggingRef.current = false;
    const rect = (e.currentTarget as HTMLAnchorElement).getBoundingClientRect();
    dragRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (isDraggingRef.current) {
      e.preventDefault();
      isDraggingRef.current = false;
    }
  };

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="View the project on GitHub"
      onPointerDown={handlePointerDown}
      onClick={handleClick}
      className="fixed z-50 flex h-12 w-12 items-center justify-center rounded-full bg-background/60 text-primary shadow-[0_0_20px_hsl(var(--primary)/0.3)] ring-1 ring-primary/50 backdrop-blur-xl hover:-translate-y-1 hover:shadow-[0_0_30px_hsl(var(--primary)/0.6)] hover:bg-background/80 hover:text-primary-foreground transition-all duration-300 cursor-grab active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y }}
    >
      <Github className="h-5 w-5" />
      <span className="sr-only">Open source on GitHub</span>
    </a>
  );
};

const App = () => (
  <ErrorBoundary>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter basename={ROUTER_BASENAME}>
        <Suspense
          fallback={
            <div className="min-h-screen flex items-center justify-center bg-background text-muted-foreground">
              Loading...
            </div>
          }
        >
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/share/:token" element={<Share />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </BrowserRouter>
      <RepoBadge />
    </TooltipProvider>
  </ErrorBoundary>
);

export default App;
