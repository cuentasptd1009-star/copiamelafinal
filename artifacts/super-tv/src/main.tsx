import { createRoot } from "react-dom/client";
import { useEffect } from "react";
import { setBaseUrl } from "@workspace/api-client-react";
import { loadYouTubeApi } from "./lib/youtube-api";
import App from "./App";
import "./index.css";
import { apiBase } from "./lib/api";

// Preload the YouTube IFrame API in idle time so it's already ready
// by the time the user opens a YouTube movie — same pattern as hls.js preloading.
if (typeof requestIdleCallback !== "undefined") {
  requestIdleCallback(() => loadYouTubeApi(() => {}), { timeout: 3000 });
} else {
  setTimeout(() => loadYouTubeApi(() => {}), 500);
}

function showError() {
  (window as any).__appStarted = false;
  const loadingEl = document.getElementById('app-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  const errorEl = document.getElementById('app-error');
  if (errorEl) errorEl.style.display = 'flex';
}

function MountedApp() {
  useEffect(() => {
    // root.render schedules work; only a committed tree is a successful boot.
    (window as any).__appStarted = true;
    (window as any).__clearLiteTimer?.();
    const loadingEl = document.getElementById('app-loading');
    const errorEl = document.getElementById('app-error');
    if (loadingEl) loadingEl.style.display = 'none';
    if (errorEl) errorEl.style.display = 'none';
  }, []);
  return <App />;
}

try {
  setBaseUrl(apiBase);

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("Root element not found");

  const root = createRoot(rootEl, { onUncaughtError: error => {
    showError();
    console.error('Super TV render failed', error);
  } });

  root.render(<MountedApp />);
} catch (e) {
  showError();
  throw e;
}
