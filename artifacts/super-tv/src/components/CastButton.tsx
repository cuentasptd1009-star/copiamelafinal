import { CastIcon } from '@/components/CastIcon';
  import type { CastState } from '@/hooks/useChromecast';

  interface CastButtonProps {
    castState: CastState;
    onCast: () => void;
    className?: string;
  }

  // W3C Remote Playback API: supported in Chrome, Edge, Samsung Internet, Opera, Firefox (desktop).
  const supportsRemotePlayback =
    typeof HTMLVideoElement !== 'undefined' && 'remote' in HTMLVideoElement.prototype;

  export function CastButton({ castState, onCast, className = '' }: CastButtonProps) {
    const chromecastAvailable = castState !== 'unavailable';

    if (!chromecastAvailable && !supportsRemotePlayback) return null;

    const isConnected = castState === 'connected';
    const isConnecting = castState === 'connecting';

    const handleClick = () => {
      if (chromecastAvailable) {
        onCast();
      } else {
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
  