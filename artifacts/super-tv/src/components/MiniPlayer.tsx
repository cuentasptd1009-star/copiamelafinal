import { useEffect, useRef, useState, useCallback } from 'react';
import { useLocation } from 'wouter';
import { Maximize2, ChevronLeft, ChevronRight, Tv2 } from 'lucide-react';
import { getMiniPlayerState, setMiniPlayerState, subscribeMiniPlayer, updateMiniPlayerState } from '@/lib/mini-player-state';
import { getToken } from '@/lib/auth';
import { apiBase } from '@/lib/api';
import { liveBufferConfig, liveMasterUrl, channelHlsUrl, isLiveChannelEnabled, forgetLiveCapability } from '@/lib/live-playback';
const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

export function MiniPlayer() {
  const [, setLocation] = useLocation();
  const [state, setState] = useState(() => getMiniPlayerState());
  const videoRef = useRef<HTMLVideoElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const [showOsd, setShowOsd] = useState(false);
  const loadGenerationRef = useRef(0);
  const fallbackRef = useRef(false);
  const activeChannelRef = useRef<number | null>(null);
  const osdTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const actionsRef = useRef<{ flashOsd: () => void; handleMaximize: () => void; handleClose: () => void }>({
    flashOsd: () => {},
    handleMaximize: () => {},
    handleClose: () => {},
  });

  useEffect(() => {
    return subscribeMiniPlayer(() => setState(getMiniPlayerState()));
  }, []);

  useEffect(() => {
    const onFlash = () => actionsRef.current.flashOsd();
    const onMaximize = () => actionsRef.current.handleMaximize();
    const onClose = () => actionsRef.current.handleClose();
      window.addEventListener('supertv:mini-flash-osd', onFlash);
      window.addEventListener('supertv:mini-maximize', onMaximize);
      window.addEventListener('supertv:mini-close', onClose);
      return () => {
        window.removeEventListener('supertv:mini-flash-osd', onFlash);
        window.removeEventListener('supertv:mini-maximize', onMaximize);
        window.removeEventListener('supertv:mini-close', onClose);
      };
    }, []);

  const loadStream = useCallback(async (url: string) => {
    const video = videoRef.current;
    if (!video) return;
    const generation = ++loadGenerationRef.current;
    const activeChannel = getMiniPlayerState()?.channelId ?? null;
    if (activeChannel !== activeChannelRef.current) { activeChannelRef.current = activeChannel; fallbackRef.current = false; }
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    video.src = '';
    video.load();

    const lower = url.toLowerCase().split('?')[0];
    const isHls = lower.endsWith('.m3u8') || lower.includes('/hls/') || lower.includes('/hls-proxy');

    if (isHls) {
      try {
        const current = getMiniPlayerState();
        const token = getToken('user') || getToken('admin') || '';
        const enhanced = current?.channelId ? await isLiveChannelEnabled(current.channelId, token) : false;
        if (loadGenerationRef.current !== generation) return;
        if (enhanced && current?.channelId && !fallbackRef.current) url = liveMasterUrl(current.channelId, token);
        const Hls = (await import('hls.js')).default;
        if (loadGenerationRef.current !== generation) return;
        if (Hls.isSupported()) {
          const hls = new Hls({
            enableWorker: true,
            ...(enhanced ? liveBufferConfig : { lowLatencyMode: true, backBufferLength: 3, maxBufferLength: 8, maxMaxBufferLength: 15 }),
            startFragPrefetch: true,
            startLevel: -1,
            abrEwmaDefaultEstimate: 500_000,
            progressive: true,
            testBandwidth: true,
            fragLoadingTimeOut: 3000,
            manifestLoadingTimeOut: enhanced ? 50000 : 5000,
            levelLoadingTimeOut: 5000,
            fragLoadingMaxRetry: 5,
            manifestLoadingMaxRetry: 5,
            nudgeMaxRetry: 10,
            highBufferWatchdogPeriod: 1,
          });
          hls.loadSource(url);
          hls.attachMedia(video);
          hls.on(Hls.Events.MANIFEST_PARSED, () => {
            const selected = getMiniPlayerState()?.qualityPreference;
            const original = hls.levels.findIndex(level => String(level.name || '').includes('Original'));
            hls.loadLevel = selected === 'original' ? (original >= 0 ? original : hls.levels.length - 1) : typeof selected === 'number' ? hls.levels.findIndex(level => level.height === selected) : -1;
            video.play().catch(() => {});
          });
          hls.on(Hls.Events.ERROR, (_: unknown, data: { fatal?: boolean; type?: string }) => {
            const active = getMiniPlayerState();
            if (loadGenerationRef.current !== generation) return;
            if (data.fatal && data.type === 'networkError' && active?.channelId) {
              if (!url.includes('/api/live/')) { hls.startLoad(); return; }
              const t = getToken('user') || getToken('admin') || '';
              fallbackRef.current = true;
              forgetLiveCapability(active.channelId, t);
              hls.destroy();
              cleanupRef.current = null;
              const proxyUrl = `${apiBase}/api/channels/${active.channelId}/hls-proxy?token=${encodeURIComponent(t)}`;
              updateMiniPlayerState({ url: proxyUrl, streamFormat: 'hls' });
            }
          });
          cleanupRef.current = () => hls.destroy();
          return;
        }
      } catch {}
    }
    video.src = url;
    video.load();
    video.play().catch(() => {});
  }, []);

  useEffect(() => {
    if (state?.isMinimized && state.url) {
      loadStream(state.url);
    } else if (!state?.isMinimized) {
      loadGenerationRef.current++;
      const video = videoRef.current;
      if (video) { video.src = ''; video.load(); }
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    }
  }, [state?.isMinimized, state?.url, loadStream]);


    const handleMaximize = () => {
      if (!state) return;
      updateMiniPlayerState({ isMinimized: false });
      if (state.type === 'channel' && state.channelId) {
        setLocation(`${BASE_URL}/player?channelId=${state.channelId}&title=${encodeURIComponent(state.title)}&type=channel&fullscreen=1`);
      } else {
        setLocation(`${BASE_URL}/player?url=${encodeURIComponent(state.url)}&title=${encodeURIComponent(state.title)}&type=${state.type}${state.movieId ? `&movieId=${state.movieId}` : ''}&fullscreen=1`);
      }
    };
  const handleClose = () => {
    const video = videoRef.current;
    if (video) { video.src = ''; video.load(); }
    if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
    setMiniPlayerState(null);
  };

  const flashOsd = useCallback(() => {
    setShowOsd(true);
    if (osdTimerRef.current) clearTimeout(osdTimerRef.current);
    osdTimerRef.current = setTimeout(() => setShowOsd(false), 2500);
  }, []);

  actionsRef.current = { flashOsd, handleMaximize, handleClose };

  function buildProxyUrl(ch: { id: number; streamUrl: string }): { url: string; streamFormat: string } {
    if (ch.streamUrl.includes('youtube.com/') || ch.streamUrl.includes('youtu.be/')) {
      return { url: ch.streamUrl, streamFormat: 'youtube' };
    }
    const lower = ch.streamUrl.toLowerCase().split('?')[0];
    const isDash = lower.endsWith('.mpd') || lower.includes('/dash/');
    const isFlv = lower.endsWith('.flv');
    const token = getToken('user') || getToken('admin') || '';
    if (isDash) return { url: ch.streamUrl, streamFormat: 'dash' };
    if (isFlv) return { url: ch.streamUrl, streamFormat: 'flv' };
    return { url: channelHlsUrl(ch.id, token), streamFormat: 'hls' };
  }

  const handlePrev = () => {
    if (!state || state.channels.length === 0) return;
    const newIdx = (state.channelIndex - 1 + state.channels.length) % state.channels.length;
    const ch = state.channels[newIdx];
    const { url, streamFormat } = buildProxyUrl(ch);
    updateMiniPlayerState({ url, title: ch.name, channelId: ch.id, channelIndex: newIdx, streamFormat });
    flashOsd();
  };

  const handleNext = () => {
    if (!state || state.channels.length === 0) return;
    const newIdx = (state.channelIndex + 1) % state.channels.length;
    const ch = state.channels[newIdx];
    const { url, streamFormat } = buildProxyUrl(ch);
    updateMiniPlayerState({ url, title: ch.name, channelId: ch.id, channelIndex: newIdx, streamFormat });
    flashOsd();
  };

  if (!state?.isMinimized) return null;

  return (
    <div
      className={`fixed bottom-4 right-4 z-[300] shadow-2xl rounded-xl overflow-hidden border bg-black transition-all duration-150 ${
        state.isFocused ? 'border-primary ring-2 ring-primary ring-offset-2 ring-offset-black' : 'border-white/20'
      }`}
      style={{ width: 280, minHeight: 158 }}>
      <video
        ref={videoRef}
        className="w-full"
        style={{ aspectRatio: '16/9', display: 'block', background: '#000' }}
        playsInline
        muted={false}
        autoPlay
      />
      <div className="absolute top-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-b from-black/80 to-transparent">
        <span className="text-white text-[11px] font-semibold truncate max-w-[150px]">{state.title}</span>
        <div className="flex items-center gap-1">
          <button onClick={handleMaximize} className="p-1 rounded text-white/80 hover:text-white hover:bg-white/10 transition-all" title="Maximizar">
            <Maximize2 className="w-3.5 h-3.5" />
          </button>

        </div>
      </div>
      {state.type === 'channel' && state.channels.length > 1 && (
        <div className="absolute bottom-0 left-0 right-0 flex items-center justify-between px-2 py-1 bg-gradient-to-t from-black/80 to-transparent">
          <button onClick={handlePrev} className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-all">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-white/50 text-[9px]">â EN VIVO</span>
          <button onClick={handleNext} className="p-1 rounded text-white/70 hover:text-white hover:bg-white/10 transition-all">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      )}

      {state.type === 'channel' && state.channels.length > 1 && (
        <div className={`absolute inset-0 flex items-center justify-center pointer-events-none transition-opacity duration-300 ${showOsd ? 'opacity-100' : 'opacity-0'}`}>
          <div className="bg-black/75 backdrop-blur rounded-lg px-3 py-2 flex flex-col items-center gap-0.5">
            <Tv2 className="w-3 h-3 text-white/40" />
            <span className="text-primary text-2xl font-black tabular-nums leading-none">{String(state.channelIndex + 1).padStart(2, '0')}</span>
            <span className="text-white text-[10px] font-semibold truncate max-w-[100px] text-center">{state.title}</span>
          </div>
        </div>
      )}

      {state.isFocused && (
        <div className="absolute inset-0 flex items-end justify-center pb-8 pointer-events-none z-20">
          <div className="flex items-center gap-1.5 text-[9px] text-white/80 bg-black/75 backdrop-blur rounded-full px-2.5 py-1">
            {state.type === 'channel' && state.channels.length > 1 && (
              <>
                <span>ââ¶ Canal</span>
                <span className="text-white/30">â¢</span>
              </>
            )}
            <span>âµ Abrir</span>
            <span className="text-white/30">â¢</span>
            <span>â« Cerrar</span>
          </div>
        </div>
      )}
    </div>
  );
}
