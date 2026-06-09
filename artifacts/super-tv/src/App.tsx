import { lazy, Suspense, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useSearch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { SplashScreen } from "@/components/SplashScreen";

import Login from "@/pages/login";
import Home from "@/pages/home";
import PlayerPage from "@/pages/player";
import VodPlayerPage from "@/pages/vod-player";
import ActivarPage from "@/pages/activar";
import DescargarPage from "@/pages/descargar";
import MovieDetail from "@/pages/movie-detail";
import SeriesDetail from "@/pages/series-detail";
import NotFound from "@/pages/not-found";
import { MiniPlayer } from "@/components/MiniPlayer";
import { TvKeyboard } from "@/components/TvKeyboard";

const AdminPanel = lazy(() => import("@/pages/admin"));
const SubadminPanel = lazy(() => import("@/pages/subadmin"));

setAuthTokenGetter(() => {
  const path = window.location.pathname;
  if (path.includes('/admin') || path.includes('/subadmin')) {
    return getToken("admin") ?? getToken("subadmin") ?? null;
  }
  return getToken("user") ?? null;
});

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 2 * 60 * 1000,
      gcTime: 10 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: false,
    },
  },
});

function splashAlreadyShown(): boolean {
  try { return !!sessionStorage.getItem('supertv_splash_shown'); } catch { return false; }
}

function markSplashShown() {
  try { sessionStorage.setItem('supertv_splash_shown', '1'); } catch {}
}

function HomeRoute() {
  const [showSplash, setShowSplash] = useState(() => !splashAlreadyShown());

  const handleSplashDone = useCallback(() => {
    markSplashShown();
    setShowSplash(false);
  }, []);

  return (
    <>
      <Home />
      {showSplash && <SplashScreen onDone={handleSplashDone} />}
    </>
  );
}

function PlayerRoute() {
  const search = useSearch();
  return <PlayerPage key={search} />;
}

function VodPlayerRoute() {
  const search = useSearch();
  return <VodPlayerPage key={search} />;
}

function Router() {
  return (
    <Switch>
      <Route path="/" component={Login} />
      <Route path="/home" component={HomeRoute} />
      <Route path="/player" component={PlayerRoute} />
      <Route path="/vod-player" component={VodPlayerRoute} />
      <Route path="/pelicula/:id" component={MovieDetail} />
      <Route path="/serie/:id" component={SeriesDetail} />
      <Route path="/admin" component={AdminPanel} />
      <Route path="/subadmin" component={SubadminPanel} />
      <Route path="/activar" component={ActivarPage} />
      <Route path="/descargar" component={DescargarPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
          <MiniPlayer />
        </WouterRouter>
        <TvKeyboard />
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
