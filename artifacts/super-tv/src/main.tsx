import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import { loadYouTubeApi } from "./lib/youtube-api";
import App from "./App";
import "./index.css";

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

try {
  const apiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  if (apiUrl) setBaseUrl(apiUrl);

  const rootEl = document.getElementById("root");
  if (!rootEl) throw new Error("Root element not found");

  const root = createRoot(rootEl);

  root.render(<App />);

  const loadingEl = document.getElementById('app-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  (window as any).__appStarted = true;
} catch (e) {
  showError();
  throw e;
}
