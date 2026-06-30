import type { CastState } from '@/hooks/useChromecast';

  interface CastButtonProps {
    castState: CastState;
    onCast: () => void;
    className?: string;
  }

  // W3C Remote Playback API: supported in Chrome, Edge, Samsung Internet, Opera, Firefox (desktop).
  // This lets the button appear in non-Chrome browsers that still support wireless display.
  const supportsRemotePlayback =
    typeof HTMLVideoElement !== 'undefined' && 'remote' in HTMLVideoElement.prototype;

  // Standard Google Cast / Chromecast icon — the one users universally recognise.
  function CastIcon({ className }: { className?: string }) {
    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 24 24"
        fill="currentColor"
        className={className}
        aria-hidden="true"
      >
        {/* Screen outline */}
        <path d="M1 18v3h3c0-1.66-1.34-3-3-3z" />
        <path d="M1 14v2c2.76 0 5 2.24 5 5h2c0-3.87-3.13-7-7-7z" />
        <path d="M1 10v2c4.97 0 9 4.03 9 9h2c0-6.08-4.93-11-11-11z" />
        <path d="M21 3H3C1.9 3 1 3.9 1 5v3h2V5h18v14h-7v2h7c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2z" />
      </svg>
    );
  }

  export function CastButton({ castState, onCast, className = '' }: CastButtonProps) {
    const chromecastAvailable = castState !== 'unavailable';

    // Show button if Chromecast SDK is loaded OR if Remote Playback API is supported
    if (!chromecastAvailable && !supportsRemotePlayback) return null;

    const isConnected = castState === 'connected';
    const isConnecting = castState === 'connecting';

    const handleClick = () => {
      if (chromecastAvailable) {
        onCast();
      } else {
        // Fallback: W3C Remote Playback API for Firefox, Samsung Browser, Opera, etc.
        const v = document.querySelector('video') as any;
        if (v?.remote) {
          v.remote.prompt().catch(() => {});
        }
      }
    };

    return (
      <button
        onClick={handleClick}
        disabled={isConnecting}
        className={`p-2.5 sm:p-3 rounded-full backdrop-blur transition-all ${
          isConnected
            ? 'bg-primary text-white ring-2 ring-white/30'
            : 'bg-black/40 text-white hover:bg-black/60'
        } ${isConnecting ? 'opacity-60 cursor-wait' : ''} ${className}`}
        title={isConnected ? 'Detener Cast al TV' : 'Enviar al TV'}
      >
        <CastIcon className="w-4 h-4 sm:w-5 sm:h-5" />
      </button>
    );
  }
  