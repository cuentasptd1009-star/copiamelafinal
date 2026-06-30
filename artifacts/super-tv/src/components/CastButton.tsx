import { Tv2 } from 'lucide-react';
import type { CastState } from '@/hooks/useChromecast';

interface CastButtonProps {
  castState: CastState;
  onCast: () => void;
  className?: string;
}

export function CastButton({ castState, onCast, className = '' }: CastButtonProps) {
  if (castState === 'unavailable') return null;

  const isConnected = castState === 'connected';
  const isConnecting = castState === 'connecting';

  return (
    <button
      onClick={onCast}
      disabled={isConnecting}
      className={`p-2.5 sm:p-3 rounded-full backdrop-blur transition-all ${
        isConnected
          ? 'bg-primary text-white ring-2 ring-white/30'
          : 'bg-black/40 text-white hover:bg-black/60'
      } ${isConnecting ? 'opacity-60 cursor-wait' : ''} ${className}`}
      title={isConnected ? 'Detener Cast al TV' : 'Enviar al TV (Chromecast)'}
    >
      <Tv2 className="w-4 h-4 sm:w-5 sm:h-5" />
    </button>
  );
}
