import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

try {
  const apiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
  if (apiUrl) setBaseUrl(apiUrl);

  const loadingEl = document.getElementById('app-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  (window as any).__appStarted = true;

  createRoot(document.getElementById("root")!).render(<App />);
} catch (e) {
  (window as any).__appStarted = false;
  const loadingEl = document.getElementById('app-loading');
  if (loadingEl) loadingEl.style.display = 'none';
  const errorEl = document.getElementById('app-error');
  if (errorEl) errorEl.style.display = 'flex';
  throw e;
}
