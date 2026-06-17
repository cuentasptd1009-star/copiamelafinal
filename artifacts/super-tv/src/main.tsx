import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const apiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
if (apiUrl) setBaseUrl(apiUrl);

function Root() {
  useEffect(() => {
    // Hide loading spinner AFTER React's first DOM commit (guaranteed to be painted)
    const loadingEl = document.getElementById('app-loading');
    if (loadingEl) loadingEl.style.display = 'none';
    (window as any).__appStarted = true;
  }, []);
  return <App />;
}

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<Root />);
}
