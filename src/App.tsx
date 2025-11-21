import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Suspense, useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import { Github } from "lucide-react";
import { lazy } from "react";

const Index = lazy(() => import("./pages/Index"));
const Auth = lazy(() => import("./pages/Auth"));
const Share = lazy(() => import("./pages/Share"));
const NotFound = lazy(() => import("./pages/NotFound"));

const queryClient = new QueryClient();

const REPO_URL = "https://github.com/tytsxai/telegram-ui-components";

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
      setPos((prev) =>
        clampPos({
          x: e.clientX - dragRef.current!.offsetX,
          y: e.clientY - dragRef.current!.offsetY,
        }),
      );
    };
    const handleUp = () => {
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
    const rect = (e.currentTarget as HTMLAnchorElement).getBoundingClientRect();
    dragRef.current = {
      offsetX: e.clientX - rect.left,
      offsetY: e.clientY - rect.top,
    };
  };

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      aria-label="View the project on GitHub"
      onPointerDown={handlePointerDown}
      className="fixed z-50 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/85 text-white shadow-lg shadow-black/30 ring-1 ring-white/10 backdrop-blur hover:-translate-y-0.5 hover:bg-slate-900/95 transition-transform duration-150 cursor-grab active:cursor-grabbing"
      style={{ left: pos.x, top: pos.y }}
    >
      <Github className="h-5 w-5" />
      <span className="sr-only">Open source on GitHub</span>
    </a>
  );
};

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
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
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
