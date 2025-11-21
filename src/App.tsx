import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import ErrorBoundary from "./components/ErrorBoundary";
import Index from "./pages/Index";
import Auth from "./pages/Auth";
import Share from "./pages/Share";
import NotFound from "./pages/NotFound";
import { Github } from "lucide-react";

const queryClient = new QueryClient();

const REPO_URL = "https://github.com/tytsxai/telegram-ui-components";

const RepoBadge = () => (
  <a
    href={REPO_URL}
    target="_blank"
    rel="noreferrer"
    aria-label="View the project on GitHub"
    className="fixed left-3 bottom-14 sm:left-6 sm:bottom-10 z-50 flex h-11 w-11 items-center justify-center rounded-full bg-slate-900/85 text-white shadow-lg shadow-black/30 ring-1 ring-white/10 backdrop-blur hover:-translate-y-0.5 hover:bg-slate-900/95 transition-transform duration-150"
  >
    <Github className="h-5 w-5" />
    <span className="sr-only">Open source on GitHub</span>
  </a>
);

const App = () => (
  <ErrorBoundary>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <BrowserRouter>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/share/:token" element={<Share />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
        <RepoBadge />
      </TooltipProvider>
    </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
