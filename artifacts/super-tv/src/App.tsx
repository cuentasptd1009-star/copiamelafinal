import { lazy, Suspense, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, useSearch, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { setAuthTokenGetter } from "@workspace/api-client-react";
import { getToken } from "@/lib/auth";

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

// ── TV Receiver Setup ──────────────────────────────────────────────────────
// When the TV opens the app with ?tv_receiver=1, this component:
//   1. Saves the auth token so the app is authenticated
//   2. Sets __isTvBrowser = true so the TV layout activates
//   3. Cleans the sensitive token from the URL bar
//   4. Listens for Presentation API messages from the phone (play commands)
function TvReceiverSetup() {
  const [, setLocation] = useLocation();
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get('tv_receiver') !== '1') return;

    // Store auth token passed from phone
    const token = params.get('t');
    if (token) {
      localStorage.setItem('supertv_token', token);
    }

    // Activate TV browser mode
    (window as any).__isTvBrowser = true;

    // Remove sensitive params from URL bar without a page reload
    window.history.replaceState({}, '', window.location.pathname);

    // Navigate to home (in case we're on login)
    setLocation('/home');

    // Set up Presentation Receiver — listen for play commands from the phone
    const receiver = (navigator as any).presentation?.receiver;
    if (!receiver) return;

    const setupConn = (conn: any) => {
      conn.onmessage = (evt: MessageEvent) => {
        try {
          const data = JSON.parse(evt.data);
          if (data.action === 'play') {
            const p = new URLSearchParams();
            if (data.type === 'movie' || data.type === 'vod') {
              p.set('url', data.url ?? '');
              p.set('title', data.title ?? '');
              p.set('type', data.type ?? 'movie');
              if (data.movieId) p.set('movieId', String(data.movieId));
              if (data.format) p.set('format', data.format);
              if (data.startFrom) p.set('startFrom', String(data.startFrom));
              setLocation('/vod-player?' + p.toString());
            } else {
              // channel (default)
              if (data.channelId) p.set('channelId', String(data.channelId));
              p.set('title', data.title ?? '');
              p.set('type', 'channel');
              p.set('url', data.url ?? '');
              p.set('format', data.format ?? '');
              setLocation('/player?' + p.toString());
            }
          } else if (data.action === 'home') {
            setLocation('/home');
          }
        } catch {}
      };
    };

    receiver.connectionList
      .then((list: any) => {
        list.connections.forEach(setupConn);
        list.onconnectionavailable = (e: any) => setupConn(e.connection);
      })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return null;
}

function HomeRoute() {
  return <Home />;
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
          <TvReceiverSetup />
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
