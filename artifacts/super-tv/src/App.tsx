import { lazy, Suspense, useState, useCallback } from "react";
import { Switch, Route, Router as WouterRouter, useSearch } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";
import { SplashScreen } from "@/components/SplashScreen";

const NotFound = lazy(() => import("@/pages/not-found"));
const Login = lazy(() => import("@/pages/login"));
const Home = lazy(() => import("@/pages/home"));
const PlayerPage = lazy(() => import("@/pages/player"));
const VodPlayerPage = lazy(() => import("@/pages/vod-player"));
const AdminPanel = lazy(() => import("@/pages/admin"));
const SubadminPanel = lazy(() => import("@/pages/subadmin"));
const ActivarPage = lazy(() => import("@/pages/activar"));
const MovieDetail = lazy(() => import("@/pages/movie-detail"));
const SeriesDetail = lazy(() => import("@/pages/series-detail"));
const MiniPlayer = lazy(() =>
  import("@/components/MiniPlayer").then((m) => ({ default: m.MiniPlayer }))
);
const TvKeyboard = lazy(() =>
  import("@/components/TvKeyboard").then((m) => ({ default: m.TvKeyboard }))
);

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
      <Suspense fallback={null}>
        <Home />
      </Suspense>
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
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Suspense fallback={null}>
            <Router />
            <MiniPlayer />
          </Suspense>
        </WouterRouter>
        <Suspense fallback={null}>
          <TvKeyboard />
        </Suspense>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
