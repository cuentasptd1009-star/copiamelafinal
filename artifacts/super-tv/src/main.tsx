import { createRoot } from "react-dom/client";
import { setBaseUrl } from "@workspace/api-client-react";
import App from "./App";
import "./index.css";

const apiUrl = (import.meta.env.VITE_API_URL || "").replace(/\/+$/, "");
if (apiUrl) setBaseUrl(apiUrl);

const loadingEl = document.getElementById('app-loading');
if (loadingEl) loadingEl.style.display = 'none';
(window as any).__appStarted = true;

createRoot(document.getElementById("root")!).render(<App />);
