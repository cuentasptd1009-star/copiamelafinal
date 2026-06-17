import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import legacy from "@vitejs/plugin-legacy";
import path from "path";

const rawPort = process.env.PORT;
const port = rawPort ? Number(rawPort) : 3000;
if (rawPort && (Number.isNaN(port) || port <= 0)) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH || "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    legacy({
      targets: [
        'chrome >= 38',
        'safari >= 9',
        'firefox >= 40',
        'ios >= 9',
        'android >= 4.4',
        'samsung >= 2',
        'opera >= 30',
      ],
      modernPolyfills: false,
      renderLegacyChunks: true,
      polyfills: true,
      externalSystemjs: false,
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-runtime-error-modal").then(m => m.default()),
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    target: ['es2015', 'chrome47', 'safari9'],
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug', 'console.warn'],
        passes: 2,
        ecma: 2015,
      },
      mangle: { safari10: true },
      format: { comments: false },
    },
    cssCodeSplit: true,
    cssMinify: true,
    chunkSizeWarningLimit: 1000,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Video players — loaded lazily, separate chunk
          if (id.includes('hls.js') || id.includes('dashjs') || id.includes('flv.js')) {
            return 'vendor-video';
          }
          // Framer Motion — heavy animation lib
          if (id.includes('framer-motion')) {
            return 'vendor-motion';
          }
          // Recharts + dependencies
          if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-')) {
            return 'vendor-charts';
          }
          // DnD kit
          if (id.includes('@dnd-kit')) {
            return 'vendor-dnd';
          }
          // All Radix UI components together
          if (id.includes('@radix-ui')) {
            return 'vendor-radix';
          }
          // React core
          if (id.includes('react-dom') || id.includes('react/')) {
            return 'vendor-react';
          }
          // TanStack Query
          if (id.includes('@tanstack/react-query')) {
            return 'vendor-query';
          }
          // Router
          if (id.includes('wouter')) {
            return 'vendor-router';
          }
          // Icons
          if (id.includes('lucide-react') || id.includes('react-icons')) {
            return 'vendor-icons';
          }
          // Other node_modules
          if (id.includes('node_modules')) {
            return 'vendor-misc';
          }
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: { strict: true },
    proxy: {
      "/api": {
        target: `http://localhost:${process.env.API_PORT || 8080}`,
        changeOrigin: true,
      },
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
