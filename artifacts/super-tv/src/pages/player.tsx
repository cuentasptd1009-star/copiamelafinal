import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, ArrowLeft, RotateCcw, SkipBack, SkipForward, AlertTriangle, Lock, ChevronLeft, ChevronRight, PictureInPicture2 } from 'lucide-react';
import { CastIcon } from '@/components/CastIcon';
import { YouTubePlayerPage } from '@/components/YouTubePlayerPage';
import { useChromecast } from '@/hooks/useChromecast';
import { CastButton } from '@/components/CastButton';
import logo from '@assets/logo_supertv.png';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { getProgress, saveProgress, addToHistory, saveEpisodeProgress, getEpisodeProgress } from '@/lib/user-data';
import { getMiniPlayerState, setMiniPlayerState, updateMiniPlayerState } from '@/lib/mini-player-state';
import { getToken } from '@/lib/auth';
import { apiBase } from '@/lib/api';
import { normalizeKey } from '@/lib/tv-remote';

type VideoFormat = 'hls' | 'dash' | 'flv' | 'native' | 'youtube';

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s?#]+)/);
  return m ? m[1] : null;
}

// Preload hls.js eagerly using idle time so it's ready before the user needs it
let _hlsPromise: Promise<typeof import('hls.js')> | null = null;
function getHls() {
  if (!_hlsPromise) _hlsPromise = import('hls.js');
  return _hlsPromise;
}
// Kick off the preload immediately in idle time
if (typeof requestIdleCallback !== 'undefined') {
  requestIdleCallback(() => getHls(), { timeout: 2000 });
} else {
  setTimeout(() => getHls(), 0);
}

function detectFormat(url: string): VideoFormat {
  if (url.includes('youtube.com/') || url.includes('youtu.be/')) return 'youtube';
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.m3u8') || clean.includes('/hls/') || clean.includes('manifest.m3u8') || clean.includes('.m3u8')) return 'hls';
  if (clean.endsWith('.mpd') || clean.includes('/dash/')) return 'dash';
  if (clean.endsWith('.flv')) return 'flv';
  return 'native';
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export default function PlayerPage() {
  const [, setLocation] = useLocation();
  const { data: session, isLoading: sessionLoading } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });
  const daysLeft = (() => {
    if (!session?.expiresAt) return null;
    return Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  })();
  const isExpired = !sessionLoading && session?.type === 'user' && daysLeft !== null && daysLeft <= 0;


  const searchParams = new URLSearchParams(window.location.search);
  const channelId = searchParams.get('channelId') || '';
  const miniState = getMiniPlayerState();
  const rawUrl = searchParams.get('url') || (channelId && miniState?.url ? miniState.url : '');
  const title = searchParams.get('title') || 'Reproduciendo';
  const type = searchParams.get('type') || 'channel';
  const movieId = searchParams.get('movieId');
  const category = searchParams.get('category');
  const startFrom = searchParams.get('startFrom');
  const episodeId = searchParams.get('episodeId');
  const requestFullscreenOnMount = searchParams.get('fullscreen') === '1' || (searchParams.get('type') || 'channel') === 'channel';
  const seriesId = searchParams.get('seriesId');
  const seasonId = searchParams.get('seasonId');
  const seasonNumber = searchParams.get('seasonNumber');
  const episodeNumber = searchParams.get('episodeNumber');
  const seriesTitle = searchParams.get('seriesTitle');
  const nextEpisodeId = searchParams.get('nextEpisodeId');
  const nextSeasonId = searchParams.get('nextSeasonId');
  const nextEpisodeTitle = searchParams.get('nextEpisodeTitle');
  const nextEpisodeUrl = searchParams.get('nextEpisodeUrl') || '';
  const nextEpisodeFormat = searchParams.get('nextEpisodeFormat') || '';
  const nextSeasonNumber = searchParams.get('nextSeasonNumber') || '';
  const nextEpisodeNumber = searchParams.get('nextEpisodeNumber') || '';

  const backUrl = episodeId && seriesId ? `/serie/${seriesId}` : movieId ? `/pelicula/${movieId}` : type === 'movie' ? '/home?tab=movies' : type === 'episode' ? '/home?tab=series' : type === 'channel' ? '/home?tab=channels' : '/home';

  const channels = miniState?.channels ?? [];
  const channelIndex = miniState?.channelIndex ?? 0;
  const hasChannels = type === 'channel' && channels.length > 1;

  const authToken = getToken('user') || getToken('admin') || '';

  function buildChannelUrl(chId: string | number, fmt: string, directUrl?: string): string {
    if (fmt === 'youtube' && directUrl) return directUrl;
    // HTTPS direct URLs can bypass the proxy (no mixed content issue on HTTPS page)
    if (directUrl && directUrl.startsWith('https://')) return directUrl;
    if (fmt === 'hls') {
      return `${apiBase}/api/channels/${chId}/hls-proxy?token=${encodeURIComponent(authToken)}`;
    }
    return `${apiBase}/api/channels/${chId}/stream?token=${encodeURIComponent(authToken)}`;
  }

  const storedFormat = searchParams.get('format') as VideoFormat | null;
  const initialFormat = miniState?.streamFormat || storedFormat || (rawUrl ? detectFormat(rawUrl) : 'native');
  const initialUrl = (type === 'channel' && channelId)
    ? buildChannelUrl(channelId, initialFormat, miniState?.url || rawUrl || undefined)
    : rawUrl;

  const [currentUrl, setCurrentUrl] = useState(initialUrl || rawUrl);
  const [currentFormat, setCurrentFormat] = useState(initialFormat);

  useEffect(() => {
    if (!initialUrl && !rawUrl && channelId) {
      fetch(`${apiBase}/api/channels/${channelId}`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      })
        .then(r => r.json())
        .then(ch => {
          const fmt = ch.streamFormat || detectFormat(ch.streamUrl || '');
          setCurrentFormat(fmt);
          // Use stream URL directly for HTTPS; HTTP needs proxy (mixed content)
          const directUrl = ch.streamUrl?.startsWith('https://') ? ch.streamUrl : undefined;
          setCurrentUrl(directUrl || buildChannelUrl(channelId, fmt));
        })
        .catch(() => {});
    }
  }, []);
  const [currentTitle, setCurrentTitle] = useState(title);

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const progressRef = useRef<HTMLDivElement>(null);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const savedTimeRef = useRef(0);
  const lastSaveRef = useRef(0);
  const movieNumIdRef = useRef<number | null>(null);
  const episodeNumIdRef = useRef<{ episodeId: number; seriesId: number; seasonId: number; seasonNumber: number; episodeNumber: number; title: string } | null>(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
    const [isPiP, setIsPiP] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isBuffering, setIsBuffering] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [ctrlIndex, setCtrlIndex] = useState(1);
  const [formatLabel, setFormatLabel] = useState('');
  const [showOsd, setShowOsd] = useState(false);
  const osdTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const volumeRef = useRef(volume);
  volumeRef.current = volume;
  const mutedRef = useRef(isMuted);
  mutedRef.current = isMuted;
  const playingRef = useRef(isPlaying);
  playingRef.current = isPlaying;
  const currentFormatRef = useRef(currentFormat);
  currentFormatRef.current = currentFormat;
  const currentUrlRef = useRef(currentUrl);
  currentUrlRef.current = currentUrl;
  const retryCountRef = useRef(0);
    const decodeRetryRef = useRef(0);   // retries for network/decode errors on slow connections
  // Throttle currentTime React state updates to max once per 500ms to avoid
  // constant re-renders (timeupdate fires ~4x/sec) while keeping the UI smooth
  const lastDisplayUpdateRef = useRef(0);
  const isLiveRef = useRef(type === 'channel');
  const autoFullscreenDoneRef = useRef(false);
  const requestFullscreenOnMountRef = useRef(requestFullscreenOnMount);
  const userMutedRef = useRef(false);

  // Grace period: set when backend reports the channel was deleted
  const [channelDeletedInfo, setChannelDeletedInfo] = useState<{ gracePeriodEnd: string } | null>(null);
  const [graceStopped, setGraceStopped] = useState(false);

  // Heartbeat: report "now playing" to backend every 30s so admin can see live activity.
  // Also polls channel status to detect if the channel was deleted (10-min grace period).
  useEffect(() => {
    if (type !== 'channel' || !channelId || !authToken) return;

    const sendHeartbeat = () => {
      fetch(`${apiBase}/api/channels/${channelId}/now-playing`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${authToken}` },
      }).catch(() => {});
    };

    const checkStatus = () => {
      fetch(`${apiBase}/api/channels/${channelId}/status`, {
        headers: authToken ? { Authorization: `Bearer ${authToken}` } : {},
      })
        .then(r => r.json())
        .then((data: { exists: boolean; deleted: boolean; gracePeriodEnd?: string }) => {
          if (data.deleted && data.gracePeriodEnd) {
            setChannelDeletedInfo({ gracePeriodEnd: data.gracePeriodEnd });
          }
          if (!data.exists) {
            setGraceStopped(true);
          }
        })
        .catch(() => {});
    };

    sendHeartbeat();
    checkStatus();
    const hbInterval = setInterval(sendHeartbeat, 30_000);
    const statusInterval = setInterval(checkStatus, 30_000);
    return () => { clearInterval(hbInterval); clearInterval(statusInterval); };
  }, [type, channelId, authToken]);

  // Redirect to channels when grace period expires
  useEffect(() => {
    if (!channelDeletedInfo) return;
    const end = new Date(channelDeletedInfo.gracePeriodEnd).getTime();
    const remaining = end - Date.now();
    if (remaining <= 0) { setLocation('/home?tab=channels'); return; }
    const timer = setTimeout(() => setLocation('/home?tab=channels'), remaining);
    return () => clearTimeout(timer);
  }, [channelDeletedInfo, setLocation]);

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 3000);
  }, []);

  const setupVideoEvents = useCallback((video: HTMLVideoElement) => {
    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      // Auto-unmute: video starts muted to bypass autoplay policy, unmute on first play
      if (!userMutedRef.current && video.muted) {
        video.muted = false;
      }
      // Auto-fullscreen on first play
        if (!autoFullscreenDoneRef.current) {
          autoFullscreenDoneRef.current = true;
          const vid = video as any;
          const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
          if (!isFull) {
            if (/iPad|iPhone|iPod/.test(navigator.userAgent) && vid?.webkitEnterFullscreen) {
              try { vid.webkitEnterFullscreen(); } catch {}
            } else if (requestFullscreenOnMountRef.current) {
              const el = containerRef.current as any;
              if (el) {
                const req = el.requestFullscreen || el.webkitRequestFullscreen;
                if (req) {
                  try {
                    const p = req.call(el);
                    if (p && typeof p.then === 'function') {
                      p.then(() => { try { screen.orientation?.lock('landscape').catch(() => {}); } catch {} }).catch(() => {});
                    } else { try { screen.orientation?.lock('landscape').catch(() => {}); } catch {} }
                  } catch {}
                }
              }
            }
          }
        }
      };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => { setIsBuffering(false); setIsLoading(false); };
    const onTimeUpdate = () => {
      const now = Date.now();
      // Only update React state every 500ms ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ live channels don't need time tracking at all
      if (!isLiveRef.current && now - lastDisplayUpdateRef.current > 500) {
        lastDisplayUpdateRef.current = now;
        setCurrentTime(video.currentTime);
      }
      if (now - lastSaveRef.current > 5000) {
        lastSaveRef.current = now;
        const t = video.currentTime;
        if (movieNumIdRef.current) {
          saveProgress(movieNumIdRef.current, t, video.duration || 0);
        }
        if (episodeNumIdRef.current) {
          saveEpisodeProgress(
            episodeNumIdRef.current.seriesId,
            episodeNumIdRef.current.seasonId,
            episodeNumIdRef.current.seasonNumber,
            episodeNumIdRef.current.episodeId,
            episodeNumIdRef.current.episodeNumber,
            t,
            video.duration || 0,
            episodeNumIdRef.current.title,
          );
        }
      }
    };
    const onDurationChange = () => { if (isFinite(video.duration)) setDuration(video.duration); };
    const onLoadedMetadata = () => {
      if (savedTimeRef.current > 0) {
        video.currentTime = savedTimeRef.current;
        savedTimeRef.current = 0;
      }
    };
    const onLoadedData = () => setIsLoading(false);
    const onVolumeChange = () => { setVolume(video.volume); setIsMuted(video.muted); };
    const onError = () => {
      const err = video.error;
      // Auto-retry with HLS proxy for channels whose URLs don't expose .m3u8
      // but are actually HLS streams (e.g. ESPN 3, many Latin IPTV providers)
      if (
        err?.code === 4 &&
        currentFormatRef.current === 'native' &&
        type === 'channel' &&
        retryCountRef.current === 0
      ) {
        const urlMatch = currentUrlRef.current.match(/\/channels\/(\d+)\/stream/);
        if (urlMatch) {
          retryCountRef.current = 1;
          const token = getToken('user') || getToken('admin') || '';
          const hlsUrl = `${apiBase}/api/channels/${urlMatch[1]}/hls-proxy?token=${encodeURIComponent(token)}`;
          setCurrentFormat('hls');
          setCurrentUrl(hlsUrl);
          return;
        }
      }
      let msg = 'No se pudo reproducir el video.';
      if (err) {
        if (err.code === 4) {
          if (type === 'movie' || type === 'episode') {
            // Detect format from URL to give specific advice
            const ext = currentUrlRef.current.split('?')[0].split('.').pop()?.toLowerCase() ?? '';
            if (['mkv', 'avi', 'wmv', 'vob', 'asf', 'rmvb', 'rm'].includes(ext)) {
              msg = `El formato .${ext.toUpperCase()} no es compatible con este navegador. Intenta usar Chrome o Edge, o convierte el archivo a MP4.`;
            } else {
              msg = 'Formato de video no soportado por este navegador. Intenta con Chrome o Edge.';
            }
          } else {
            msg = 'Formato no soportado. El canal puede no ser compatible con este navegador.';
          }
        } else if (err.code === 3 || err.code === 2) {
            // On slow connections the browser throws code 3 (decode) or 2 (network)
            // even when the stream is perfectly fine. Auto-retry up to 3 times with
            // back-off before showing an error screen, just like TikTok/YouTube do.
            const MAX_RETRIES = 3;
            if (decodeRetryRef.current < MAX_RETRIES) {
              decodeRetryRef.current += 1;
              setIsLoading(true);
              setError(null);
              const backoffMs = 2000 * decodeRetryRef.current; // 2 s, 4 s, 6 s
              setTimeout(() => {
                const v = videoRef.current;
                if (!v) return;
                const src = v.src || v.currentSrc;
                if (src) v.src = src;
                v.load();
                v.play().catch(() => {});
              }, backoffMs);
              return;
            }
            // All retries exhausted ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ show the real error
            msg = err.code === 3
              ? 'Error al decodificar el video. El archivo puede estar dañado o usar un codec no soportado.'
              : 'Error de red al cargar el video. Comprueba tu conexión e intenta de nuevo.';
          } else if (err.code === 1) msg = 'Reproducción interrumpida. Intenta de nuevo.';
        }
        setError(msg);
        setIsLoading(false);
    };

    video.addEventListener('play', onPlay);
    video.addEventListener('pause', onPause);
    video.addEventListener('waiting', onWaiting);
    video.addEventListener('canplay', onCanPlay);
    video.addEventListener('timeupdate', onTimeUpdate);
    video.addEventListener('durationchange', onDurationChange);
    video.addEventListener('loadedmetadata', onLoadedMetadata);
    video.addEventListener('loadeddata', onLoadedData);
    video.addEventListener('volumechange', onVolumeChange);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('play', onPlay);
      video.removeEventListener('pause', onPause);
      video.removeEventListener('waiting', onWaiting);
      video.removeEventListener('canplay', onCanPlay);
      video.removeEventListener('timeupdate', onTimeUpdate);
      video.removeEventListener('durationchange', onDurationChange);
      video.removeEventListener('loadedmetadata', onLoadedMetadata);
      video.removeEventListener('loadeddata', onLoadedData);
      video.removeEventListener('volumechange', onVolumeChange);
      video.removeEventListener('error', onError);
    };
  }, []);

  useEffect(() => {
    retryCountRef.current = 0;
    decodeRetryRef.current = 0;
    if (!currentUrl) { setLocation(backUrl); return; }
    const video = videoRef.current;
    if (!video) return;

    setError(null);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(0);

    if (episodeId && type === 'episode') {
      const epNum = Number(episodeId);
      let seekTo = 0;
      if (startFrom !== null) {
        seekTo = Number(startFrom) > 10 ? Number(startFrom) : 0;
      } else {
        const prog = getEpisodeProgress(epNum);
        seekTo = prog && prog.time > 10 ? prog.time : 0;
      }
      savedTimeRef.current = seekTo;
      movieNumIdRef.current = null;
      episodeNumIdRef.current = {
        episodeId: epNum,
        seriesId: Number(seriesId) || 0,
        seasonId: Number(seasonId) || 0,
        seasonNumber: Number(seasonNumber) || 1,
        episodeNumber: Number(episodeNumber) || 1,
        title: title,
      };
    } else if (movieId && type === 'movie') {
      let seekTo = 0;
      if (startFrom !== null) {
        seekTo = Number(startFrom) > 10 ? Number(startFrom) : 0;
      } else {
        const prog = getProgress(Number(movieId));
        seekTo = prog && prog.time > 10 ? prog.time : 0;
      }
      savedTimeRef.current = seekTo;
      movieNumIdRef.current = Number(movieId);
      episodeNumIdRef.current = null;
      addToHistory(Number(movieId), category || null);
    } else {
      savedTimeRef.current = 0;
      movieNumIdRef.current = null;
      episodeNumIdRef.current = null;
    }

    const removeEvents = setupVideoEvents(video);
    const fmt = type === 'channel' ? currentFormat : detectFormat(currentUrl);
    setFormatLabel(fmt.toUpperCase());

    let destroyed = false;

    const init = async () => {
      // React's `muted` JSX prop doesn't apply to the DOM ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ set imperatively so
      // the browser allows autoplay (muted autoplay is universally permitted)
      video.muted = true;
      try {
        if (fmt === 'hls') {
          // iOS Safari: use native HLS directly ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ hls.js uses MediaSource API
          // which AirPlay cannot stream. Native HLS on iOS supports AirPlay natively.
          if (isIOS && video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = currentUrl;
            video.play().catch(() => {});
          } else {
          const Hls = (await getHls()).default;
          if (Hls.isSupported()) {
            const isChannel = type === 'channel';
            const hls = new Hls({
              enableWorker: true,
              lowLatencyMode: false, // Regular HLS streams; LL-HLS not used here
              // For channels: tiny buffer = instant start; for VOD: bigger = smooth
              backBufferLength: isChannel ? 2 : 5,
              maxBufferLength: isChannel ? 4 : 10,
              maxMaxBufferLength: isChannel ? 8 : 20,
              startFragPrefetch: true,
              // Start at lowest quality immediately for channels (ramps up fast),
              // auto-select for VOD so we don't waste time on a bad first segment
              startLevel: isChannel ? 0 : -1,
              // Assume 2Mbps connection so ABR doesn't waste time probing bandwidth
              abrEwmaDefaultEstimate: 2_000_000,
              progressive: true,
              // Skip bandwidth test on channels ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ we want immediate playback
              testBandwidth: !isChannel,
              // Tight timeouts: fail fast so proxy fallback kicks in quickly
              // Higher timeouts to survive Vercel cold starts (3-5s) and large 4K segments
              fragLoadingTimeOut: isChannel ? 15000 : 5000,
              manifestLoadingTimeOut: isChannel ? 10000 : 6000,
              levelLoadingTimeOut: isChannel ? 10000 : 6000,
              fragLoadingMaxRetry: 6,
              manifestLoadingMaxRetry: 5,
              nudgeMaxRetry: 6,
              nudgeOffset: 0.1,
              highBufferWatchdogPeriod: 1,
              // Skip stall recovery delay for channels ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ jump immediately
              stallReported: isChannel ? 0.3 : 1,
            });
            hls.loadSource(currentUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (!destroyed) {
                if (savedTimeRef.current > 0) {
                  video.currentTime = savedTimeRef.current;
                  savedTimeRef.current = 0;
                }
                video.play().catch(() => {});
              }
            });
            hls.on(Hls.Events.ERROR, (_, data) => {
              if (data.fatal) {
                if (data.type === Hls.ErrorTypes.NETWORK_ERROR && retryCountRef.current === 0 && type === 'channel' && channelId) {
                  // Direct stream failed (CORS or network) ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ fall back to server proxy
                  retryCountRef.current = 1;
                  cleanupRef.current = null;
                  hls.destroy();
                  const t = getToken('user') || getToken('admin') || '';
                  setCurrentUrl(`${apiBase}/api/channels/${channelId}/hls-proxy?token=${encodeURIComponent(t)}`);
                } else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                  hls.startLoad();
                } else if (data.type === Hls.ErrorTypes.MEDIA_ERROR) {
                  hls.recoverMediaError();
                } else {
                  setError('No se pudo cargar el stream. El canal puede estar sin señal.');
                  setIsLoading(false);
                }
              }
            });
            cleanupRef.current = () => hls.destroy();
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = currentUrl;
            video.play().catch(() => {});
          } else {
            setError('Tu navegador no soporta este formato de video.');
            setIsLoading(false);
          }
          } // end non-iOS HLS branch
        } else if (fmt === 'dash') {
          const dashjs = await import('dashjs');
          const player = dashjs.MediaPlayer().create();
          player.initialize(video, currentUrl, true);
          player.updateSettings({
            streaming: {
              buffer: { fastSwitchEnabled: true },
              abr: { autoSwitchBitrate: { video: true, audio: true } },
            },
          });
          cleanupRef.current = () => player.destroy();
        } else if (fmt === 'flv') {
          const flvjs = (await import('flv.js')).default;
          if (flvjs.isSupported()) {
            const flvPlayer = flvjs.createPlayer({
              type: 'flv',
              url: currentUrl,
              isLive: type === 'channel',
            });
            flvPlayer.attachMediaElement(video);
            flvPlayer.load();
            flvPlayer.play();
            flvPlayer.on(flvjs.Events.ERROR, () => {
              setError('Error al reproducir FLV. El archivo puede no ser compatible.');
              setIsLoading(false);
            });
            cleanupRef.current = () => flvPlayer.destroy();
          } else {
            setError('Tu navegador no soporta FLV nativo.');
            setIsLoading(false);
          }
        } else if (fmt === 'youtube') {
          setIsLoading(false);
          setIsPlaying(true);
        } else {
          video.src = currentUrl;
          video.load();
          video.play().catch(() => {});
        }
      } catch (e) {
        if (!destroyed) {
          setError('No se pudo inicializar el reproductor.');
          setIsLoading(false);
        }
      }
    };

    init();

    return () => {
      destroyed = true;
      if (movieNumIdRef.current && video.currentTime > 0) {
        saveProgress(movieNumIdRef.current, video.currentTime, video.duration || 0);
      }
      removeEvents();
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
      video.src = '';
      video.load();
    };
  }, [currentUrl]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (playingRef.current) v.pause(); else v.play().catch(() => {});
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    userMutedRef.current = !mutedRef.current;
    v.muted = !mutedRef.current;
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const handleVolumeChange = useCallback((val: number) => {
    const v = videoRef.current;
    const newVol = Math.min(1, Math.max(0, val));
    if (v) { v.volume = newVol; v.muted = newVol === 0; }
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    v.currentTime = pct * v.duration;
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const skip = useCallback((secs: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + secs));
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent) && !/iPad|iPhone|iPod/.test(navigator.userAgent);

  // AirPlay is supported on ALL iOS browsers (Safari, Chrome, Edge, Firefox on iOS all
  // use WebKit which exposes webkitShowPlaybackTargetPicker) and macOS Safari.
  // We feature-detect once ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ no need to wait for any event.
  const supportsAirPlay = (() => {
    try { return 'webkitShowPlaybackTargetPicker' in document.createElement('video'); } catch { return false; }
  })();

  const { castState, castIsPlaying, castMedia, stopCasting, castTogglePlay } = useChromecast();

  // Pause/stop handling when leaving the page.
  // visibilitychange (tab hidden): only pause LOCAL video ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ do NOT stop the
  //   Chromecast session because Chromecast is independent of the browser tab.
  //   This way the user can switch to WhatsApp and the TV keeps playing.
  // pagehide (persisted=false): real navigation away ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ end cast session.
  // beforeunload: tab/window actually closing ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ end cast session.
  useEffect(() => {
    // Pause local video when tab is hidden (e.g. user switches to WhatsApp).
      // Do NOT end the Chromecast session ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ the TV is independent of the browser
      // tab, so reload or navigation should keep the TV playing.
      const onVisibilityChange = () => {
          if (!document.hidden) return;
          // On PC/desktop do not pause when the user switches apps or windows.
          // Only pause automatically on mobile (iOS / Android).
          if (!/iPad|iPhone|iPod|Android/i.test(navigator.userAgent)) return;
          try {
            const video = videoRef.current;
            if (!video) return;
            // Don't pause if AirPlay (iOS wireless playback) is active ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ AirPlay needs
            // the video element to keep playing to maintain the stream to the TV.
            const isAirPlaying =
              (video as any).webkitCurrentPlaybackTargetIsWireless === true ||
              (video as any).remote?.state === 'connected';
            const isInPiP = document.pictureInPictureElement != null;
            if (!isAirPlaying && !isInPiP) video.pause();
          } catch {}
        };
      document.addEventListener('visibilitychange', onVisibilityChange);
      return () => {
        document.removeEventListener('visibilitychange', onVisibilityChange);
      };
    }, []);

  // Save player URL whenever cast is active so the home cast button can navigate back
  useEffect(() => {
    if (castState === 'connected') {
      sessionStorage.setItem('castPlayerUrl', window.location.href);
    }
  }, [castState]);

    // Silence local video while casting ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ also fires on channel change so audio stops
    useEffect(() => {
      if (castState !== 'connected') return;
      const v = videoRef.current;
      if (!v) return;
      v.muted = true;
      if (!v.paused) v.pause();
    }, [castState, currentUrl]);

    // Keep refs so retry callbacks always read the latest live values
    const castStateRef2 = useRef(castState);
    castStateRef2.current = castState;
    const castMediaRef2 = useRef(castMedia);
    castMediaRef2.current = castMedia;
    const currentTitleRef2 = useRef(currentTitle);
    currentTitleRef2.current = currentTitle;
    const currentFormatRef2 = useRef(currentFormat);
    currentFormatRef2.current = currentFormat;

    // Auto-cast: fires whenever the active URL changes (new channel or fresh mount).
    // The Cast SDK reconnects asynchronously after SPA back-navigation, so we retry
    // at 300 ms and 1 200 ms to cover the full async-reconnect window.
    useEffect(() => {
      if (!currentUrl || currentFormatRef2.current === 'youtube') return;
      let cancelled = false;
      const trycast = () => {
        if (cancelled) return;
        if (castStateRef2.current === 'connected') {
          castMediaRef2.current(currentUrl, currentTitleRef2.current, currentFormatRef2.current);
        }
      };
      trycast();
      const t1 = setTimeout(trycast, 300);
      const t2 = setTimeout(trycast, 1200);
      return () => { cancelled = true; clearTimeout(t1); clearTimeout(t2); };
    }, [currentUrl]); // eslint-disable-line react-hooks/exhaustive-deps
  

  const handleCast = useCallback(() => {
    if (castState === 'connected') { stopCasting(); return; }
    castMedia(currentUrl, currentTitle, currentFormat);
  }, [castState, castMedia, stopCasting, currentUrl, currentTitle, currentFormat]);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current as any;
    const vid = videoRef.current as any;
    if (!el) return;
    const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    if (!isFull) {
      if (isIOS) {
        // iOS Safari: fullscreen only works via webkitEnterFullscreen on the video element
        if (vid?.webkitEnterFullscreen) { try { vid.webkitEnterFullscreen(); return; } catch {} }
      } else if (isAndroid) {
          // Android Chrome: requestFullscreen on the container div hides browser bars
          // AND keeps our custom controls visible (unlike using the video element directly).
          const req = el.requestFullscreen || el.webkitRequestFullscreen;
          if (req) {
            try {
              const p = req.call(el);
              const lockLandscape = () => { try { screen.orientation?.lock('landscape').catch(() => {}); } catch {} };
              if (p && typeof p.then === 'function') { p.then(lockLandscape).catch(() => {}); } else { lockLandscape(); }
              return;
            } catch {}
          }
          // Fallback if API unavailable
          try { screen.orientation?.lock('landscape').catch(() => {}); } catch {}
          setIsFullscreen(true);
          return;
        } else {
        // Desktop: use requestFullscreen on the container + force landscape orientation
        const req = el.requestFullscreen || el.webkitRequestFullscreen;
        const target = el;
        if (req) {
          try {
            const p = req.call(target);
            const lockLandscape = () => {
              try { screen.orientation?.lock('landscape').catch(() => {}); } catch {}
            };
            if (p && typeof p.then === 'function') { p.then(lockLandscape).catch(() => {}); } else { lockLandscape(); }
            return;
          } catch {}
        }
        setIsFullscreen(true);
      }
    } else {
      fsExitByToggleRef.current = true;
      try { screen.orientation?.unlock(); } catch {}
      if (isAndroid) {
          // Exit real fullscreen if active
          const exitFn = (document as any).exitFullscreen || (document as any).webkitExitFullscreen;
          if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
            try { exitFn?.call(document); } catch {}
          }
          setIsFullscreen(false);
          return;
        }
      const exit = (document as any).exitFullscreen || (document as any).webkitExitFullscreen;
      if (exit) { try { exit.call(document); return; } catch {} }
      if (vid?.webkitExitFullscreen) { try { vid.webkitExitFullscreen(); return; } catch {} }
      fsExitByToggleRef.current = false;
      setIsFullscreen(false);
    }
    showControlsTemporarily();
  }, [showControlsTemporarily, isIOS, isAndroid, isFullscreen]);

  
  useEffect(() => {
    const vid = videoRef.current as any;
    const onFsChange = () => {
      const isNowFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
      setIsFullscreen(isNowFull);
      if (isNowFull) {
        // Lock orientation to landscape as soon as fullscreen is confirmed active
        try { screen.orientation?.lock('landscape').catch(() => {}); } catch {}
      } else {
        try { screen.orientation?.unlock(); } catch {}
        if (!fsExitByToggleRef.current) {
          handleBackRef.current();
        }
      }
      fsExitByToggleRef.current = false;
    };
    const onIosEnter = () => setIsFullscreen(true);
    const onIosExit = () => {
      setIsFullscreen(false);
      if (!fsExitByToggleRef.current) {
        handleBackRef.current();
      }
      fsExitByToggleRef.current = false;
    };
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    vid?.addEventListener('webkitbeginfullscreen', onIosEnter);
    vid?.addEventListener('webkitendfullscreen', onIosExit);
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      vid?.removeEventListener('webkitbeginfullscreen', onIosEnter);
      vid?.removeEventListener('webkitendfullscreen', onIosExit);
    };
  }, []);


    const handleMinimize = useCallback(() => {
    if (type === 'channel' && currentUrl) {
      updateMiniPlayerState({ isMinimized: true, url: currentUrl, title: currentTitle });
      setLocation(backUrl);
    } else {
      setLocation(backUrl);
    }
  }, [type, currentUrl, currentTitle, backUrl, setLocation]);

  const handleBack = useCallback(() => {
      // Hard navigation when casting so the Cast SDK re-initialises cleanly on
      // home and the next channel selection reliably switches the TV.
      if (castState === 'connected') {
        window.location.href = backUrl;
        return;
      }
      setLocation(backUrl);
    }, [castState, backUrl, setLocation]);

  const handleMinimizeRef = useRef(handleMinimize);
  handleMinimizeRef.current = handleMinimize;
  const handleBackRef = useRef(handleBack);
  handleBackRef.current = handleBack;
  const fsExitByToggleRef = useRef(false);

  const togglePiP = useCallback(() => {
    handleMinimizeRef.current();
  }, []);

  const showOsdBriefly = useCallback(() => {
    setShowOsd(true);
    if (osdTimeoutRef.current) clearTimeout(osdTimeoutRef.current);
    osdTimeoutRef.current = setTimeout(() => setShowOsd(false), 2800);
  }, []);

  const goToChannel = useCallback((newIdx: number) => {
    if (!hasChannels) return;
    const ch = channels[newIdx];
    if (!ch) return;
    const fmt = detectFormat(ch.streamUrl || '');
    const proxyUrl = buildChannelUrl(ch.id, fmt, fmt === 'youtube' ? ch.streamUrl : undefined);
    updateMiniPlayerState({ channelIndex: newIdx, url: proxyUrl, title: ch.name, streamFormat: fmt });
    setCurrentFormat(fmt);
    setCurrentUrl(proxyUrl);
    setCurrentTitle(ch.name);
    // While casting: load the new channel on the existing Chromecast session
    // without disconnecting ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ phone stays as remote control for the new channel
    if (castState === 'connected') {
      castMedia(proxyUrl, ch.name, fmt);
    }
    showControlsTemporarily();
    showOsdBriefly();
  }, [hasChannels, channels, castState, castMedia, showControlsTemporarily, showOsdBriefly, authToken]);

  const goPrevChannel = useCallback(() => {
    goToChannel((channelIndex - 1 + channels.length) % channels.length);
  }, [goToChannel, channelIndex, channels.length]);

  const goNextChannel = useCallback(() => {
    goToChannel((channelIndex + 1) % channels.length);
  }, [goToChannel, channelIndex, channels.length]);

  const goNextEpisode = useCallback(() => {
    if (!nextEpisodeId || !seriesId) return;
    const params = new URLSearchParams({
      url: nextEpisodeUrl,
      title: nextEpisodeTitle || 'Episodio siguiente',
      type: 'episode',
      episodeId: nextEpisodeId,
      seriesId,
      seasonId: nextSeasonId || seasonId || '',
      seasonNumber: nextSeasonNumber || seasonNumber || '',
      episodeNumber: nextEpisodeNumber || '',
      seriesTitle: seriesTitle || '',
    });
    if (nextEpisodeFormat) params.set('format', nextEpisodeFormat);
    setLocation(`/player?${params.toString()}`);
  }, [nextEpisodeId, nextEpisodeUrl, nextEpisodeTitle, nextSeasonId, nextSeasonNumber, nextEpisodeNumber, nextEpisodeFormat, seriesId, seasonId, seasonNumber, seriesTitle]);

  // ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ Media Session API ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂ
  // Updates the Android/iOS notification bar with channel name + artwork and
  // registers prev/next channel handlers so the user can switch channels from
  // the notification shade or lock screen without reopening the browser.
  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({
      title: currentTitle,
      artist: type === 'channel' ? (hasChannels ? `Canal ${channelIndex + 1}` : 'En Vivo') : 'SuperTV',
      album: 'SuperTV',
    });
  }, [currentTitle, channelIndex, hasChannels, type]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    if (hasChannels) {
      navigator.mediaSession.setActionHandler('previoustrack', () => goPrevChannel());
      navigator.mediaSession.setActionHandler('nexttrack', () => goNextChannel());
    } else {
      navigator.mediaSession.setActionHandler('previoustrack', null);
      navigator.mediaSession.setActionHandler('nexttrack', null);
    }
    navigator.mediaSession.setActionHandler('play', () => { videoRef.current?.play().catch(() => {}); });
    navigator.mediaSession.setActionHandler('pause', () => { videoRef.current?.pause(); });
    navigator.mediaSession.setActionHandler('stop', () => { videoRef.current?.pause(); });
    return () => {
      try {
        navigator.mediaSession.setActionHandler('previoustrack', null);
        navigator.mediaSession.setActionHandler('nexttrack', null);
        navigator.mediaSession.setActionHandler('play', null);
        navigator.mediaSession.setActionHandler('pause', null);
        navigator.mediaSession.setActionHandler('stop', null);
      } catch {}
    };
  }, [hasChannels, goPrevChannel, goNextChannel]);

  useEffect(() => {
    if (!('mediaSession' in navigator)) return;
    navigator.mediaSession.playbackState = isPlaying ? 'playing' : 'paused';
  }, [isPlaying]);

  const controls = useMemo(() => ['back', ...(hasChannels ? ['prevch'] : []), 'skipback', 'play', 'skipfwd', ...(hasChannels ? ['nextch'] : []), 'mute', 'cast', 'pip', 'fullscreen'], [hasChannels]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      switch (normalizeKey(e)) {
        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) { skip(30); }
          else setCtrlIndex(p => Math.min(p + 1, controls.length - 1));
          showControlsTemporarily();
          break;
        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) { skip(-30); }
          else setCtrlIndex(p => Math.max(p - 1, 0));
          showControlsTemporarily();
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (hasChannels) goNextChannel();
          else handleVolumeChange(volumeRef.current + 0.1);
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (hasChannels) goPrevChannel();
          else handleVolumeChange(volumeRef.current - 0.1);
          break;
        case 'ChannelUp':
          e.preventDefault();
          if (hasChannels) goNextChannel();
          showControlsTemporarily();
          break;
        case 'ChannelDown':
          e.preventDefault();
          if (hasChannels) goPrevChannel();
          showControlsTemporarily();
          break;
        case 'Enter':
          e.preventDefault();
          switch (controls[ctrlIndex]) {
            case 'back': setLocation(backUrl); break;
            case 'prevch': goPrevChannel(); break;
            case 'skipback': skip(-10); break;
            case 'play': togglePlay(); break;
            case 'skipfwd': skip(10); break;
            case 'nextch': goNextChannel(); break;
            case 'mute': toggleMute(); break;
            case 'cast': handleCast(); break;
            case 'pip': togglePiP(); break;
              case 'fullscreen': toggleFullscreen(); break;
          }
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          if (document.fullscreenElement || (document as any).webkitFullscreenElement) {
            document.exitFullscreen?.().catch(() => handleBack());
          } else {
            handleBack();
          }
          break;
        case ' ':
        case 'MediaPlayPause':
          e.preventDefault();
          togglePlay();
          showControlsTemporarily();
          break;
        case 'MediaFastForward':
          e.preventDefault();
          skip(10);
          showControlsTemporarily();
          break;
        case 'MediaRewind':
          e.preventDefault();
          skip(-10);
          showControlsTemporarily();
          break;
        case 'VolumeUp':
          e.preventDefault();
          handleVolumeChange(volumeRef.current + 0.1);
          break;
        case 'VolumeDown':
          e.preventDefault();
          handleVolumeChange(volumeRef.current - 0.1);
          break;
        case 'VolumeMute':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [ctrlIndex, backUrl, togglePlay, toggleMute, toggleFullscreen, togglePiP, skip, handleVolumeChange, showControlsTemporarily, hasChannels, goPrevChannel, goNextChannel, handleMinimize, handleBack, controls]);

  useEffect(() => {
    showControlsTemporarily();
    return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); };
  }, []);

  const isLive = type === 'channel' || !isFinite(duration) || duration === 0;
  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (isExpired) {
    return (
      <div className="w-full h-[100dvh] bg-black flex flex-col items-center justify-center gap-6 text-center px-6">
        <div className="w-20 h-20 rounded-full bg-destructive/20 flex items-center justify-center">
          <Lock className="w-10 h-10 text-destructive" />
        </div>
        <div className="space-y-2">
          <h2 className="text-2xl font-bold text-white">Acceso vencido</h2>
          <p className="text-white/60 max-w-xs">Tu código venció. Para renovarlo, contacta a tu proveedor para activarlo.</p>
        </div>
        <button onClick={() => setLocation('/home')} className="text-sm text-white/50 hover:text-white transition-colors underline underline-offset-4">
          Volver al inicio
        </button>
      </div>
    );
  }

  if (currentFormat === 'youtube' || detectFormat(currentUrl) === 'youtube') {
    const ytId = extractYouTubeId(currentUrl);
    if (!ytId) return <div className="flex items-center justify-center h-[100dvh] bg-black text-white/60 text-sm">URL de YouTube inválida</div>;

    const handleHideFromCatalog = movieId ? async () => {
      try {
        const token = getToken('admin');
        if (!token) return;
        await fetch(`${apiBase}/api/movies/${movieId}/hidden`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ hidden: true }),
        });
        setLocation(backUrl);
      } catch {}
    } : undefined;

    return (
      <YouTubePlayerPage
        videoId={ytId}
        title={currentTitle}
        onBack={() => setLocation(backUrl)}
        movieId={movieId ? Number(movieId) : undefined}
        onHideFromCatalog={handleHideFromCatalog}
        episodeId={episodeId ? Number(episodeId) : undefined}
        seriesId={seriesId ? Number(seriesId) : undefined}
        seasonId={seasonId ? Number(seasonId) : undefined}
        seasonNumber={seasonNumber ? Number(seasonNumber) : undefined}
        episodeNumber={episodeNumber ? Number(episodeNumber) : undefined}
        seriesTitle={seriesTitle || undefined}
        nextEpisodeId={nextEpisodeId ? Number(nextEpisodeId) : undefined}
        nextEpisodeTitle={nextEpisodeTitle || undefined}
        nextEpisodeNumber={nextEpisodeNumber ? Number(nextEpisodeNumber) : undefined}
        nextSeasonNumber={nextSeasonNumber ? Number(nextSeasonNumber) : undefined}
        onNextEpisode={nextEpisodeId ? goNextEpisode : undefined}
      />
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[100dvh] bg-black overflow-hidden flex items-center justify-center select-none"
      style={isAndroid && isFullscreen ? { position: 'fixed', inset: 0, zIndex: 9999, width: '100vw', height: '100dvh' } : {}}
      onMouseMove={showControlsTemporarily}
      onTouchStart={showControlsTemporarily}
      onClick={e => {
        if (e.target === containerRef.current || e.target === videoRef.current) {
          const vid = videoRef.current as any;
          // iOS Safari: first tap goes fullscreen via webkitEnterFullscreen (needs user gesture)
          if (isIOS && !isFullscreen && vid?.webkitEnterFullscreen) {
            try { vid.webkitEnterFullscreen(); showControlsTemporarily(); return; } catch {}
          }
          togglePlay();
        }
        showControlsTemporarily();
      }}
    >
      <video
        ref={videoRef}
        className={`w-full h-full object-contain ${error || castState === 'connected' ? 'hidden' : ''}`}
        style={{ willChange: 'transform', contain: 'strict' }}
        autoPlay
        muted
        playsInline
        webkit-playsinline=""
        x-webkit-airplay="allow"
        controlsList="nofullscreen nodownload"
        onPlay={() => {
          // Guard: if casting is active, immediately stop local playback.
          // Prevents double audio when HLS reloads (e.g. on channel change).
          if (castState === 'connected') {
            const v = videoRef.current;
            if (v) { v.pause(); v.muted = true; }
          }
        }}
      />


      {isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none bg-black/60">
          <div className="flex flex-col items-center gap-4">
            <img src={logo} alt="Super TV" className="w-32 sm:w-40 h-auto drop-shadow-2xl" />
            <div className="relative w-14 h-14">
              <svg className="w-14 h-14 animate-spin" viewBox="0 0 56 56" fill="none">
                <circle cx="28" cy="28" r="24" stroke="white" strokeWidth="4" strokeOpacity="0.15" />
                <path d="M28 4 A24 24 0 0 1 52 28" stroke="url(#spinner-grad)" strokeWidth="4" strokeLinecap="round" />
                <defs>
                  <linearGradient id="spinner-grad" x1="28" y1="4" x2="52" y2="28" gradientUnits="userSpaceOnUse">
                    <stop offset="0%" stopColor="#ef4444" />
                    <stop offset="50%" stopColor="#3b82f6" />
                    <stop offset="100%" stopColor="#ffffff" />
                  </linearGradient>
                </defs>
              </svg>
            </div>
            <span className="text-white/70 text-sm tracking-wide">Cargando...</span>
          </div>
        </div>
      )}


      {castState === 'connected' && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-[15] bg-black/90">
          <button
            onClick={() => setLocation(backUrl)}
            className="absolute top-4 left-4 p-2.5 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-all"
            title="Volver"
          >
            <ArrowLeft className="w-5 h-5" />
          </button>
          <div className="flex flex-col items-center gap-5">
            <div className="relative">
              <CastIcon className="w-24 h-24 text-primary drop-shadow-[0_0_24px_rgba(239,68,68,0.6)]" />
              <span className="absolute top-0 right-0 w-4 h-4 rounded-full bg-green-400 border-2 border-black animate-pulse" />
            </div>
            <div className="flex flex-col items-center gap-1 text-center">
              <p className="text-white/50 text-xs uppercase tracking-widest">Reproduciendo en TV</p>
              {hasChannels && (
                <p className="text-primary text-[11px] font-bold uppercase tracking-widest">Canal {channelIndex + 1}</p>
              )}
              <p className="text-white text-base font-semibold max-w-[280px] truncate">{currentTitle}</p>
            </div>
            {hasChannels && (
              <div className="flex items-center gap-5">
                <button
                  onClick={goPrevChannel}
                  className="p-3.5 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-all"
                  title="Canal anterior"
                >
                  <ChevronLeft className="w-6 h-6" />
                </button>
                <span className="text-white/30 text-[11px]">cambiar canal</span>
                <button
                  onClick={goNextChannel}
                  className="p-3.5 rounded-full bg-white/10 text-white hover:bg-white/20 active:scale-95 transition-all"
                  title="Canal siguiente"
                >
                  <ChevronRight className="w-6 h-6" />
                </button>
              </div>
            )}
            <div className="flex flex-col items-center gap-2">
                <button
                  onClick={stopCasting}
                  className="px-6 py-2 rounded-full bg-white/10 border border-white/20 text-white/70 text-sm hover:bg-red-600/30 hover:text-red-300 hover:border-red-500/40 active:scale-95 transition-all"
                >
                  Desconectar TV
                </button>
                <p className="text-white/20 text-[10px]">Toca abajo para pausar</p>
              </div>
          </div>
        </div>
      )}

      {isBuffering && !isLoading && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <div className="relative w-10 h-10">
            <svg className="w-10 h-10 animate-spin" viewBox="0 0 40 40" fill="none">
              <circle cx="20" cy="20" r="16" stroke="white" strokeWidth="3" strokeOpacity="0.15" />
              <path d="M20 4 A16 16 0 0 1 36 20" stroke="url(#buf-grad)" strokeWidth="3" strokeLinecap="round" />
              <defs>
                <linearGradient id="buf-grad" x1="20" y1="4" x2="36" y2="20" gradientUnits="userSpaceOnUse">
                  <stop offset="0%" stopColor="#ef4444" />
                  <stop offset="50%" stopColor="#3b82f6" />
                  <stop offset="100%" stopColor="#ffffff" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      )}

      {hasChannels && (
        <div
          className={`absolute top-1/2 right-6 sm:right-10 -translate-y-1/2 z-30 pointer-events-none transition-all duration-300 ${showOsd ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-6'}`}
        >
          <div className="bg-black/80 backdrop-blur border border-white/15 rounded-2xl px-5 py-4 shadow-2xl flex flex-col items-end gap-1 min-w-[180px]">
            <span className="text-white/40 text-[10px] font-semibold uppercase tracking-[0.2em]">Canal</span>
            <span className="text-primary text-4xl font-black tabular-nums leading-none">{String(channelIndex + 1).padStart(2, '0')}</span>
            <span className="text-white text-sm font-semibold text-right leading-snug max-w-[160px] truncate">{currentTitle}</span>
            <div className="mt-1 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
              <span className="text-red-400 text-[9px] font-bold uppercase tracking-widest">En Vivo</span>
            </div>
          </div>
        </div>
      )}

      {channelDeletedInfo && !graceStopped && (() => {
        const end = new Date(channelDeletedInfo.gracePeriodEnd).getTime();
        const minsLeft = Math.max(0, Math.ceil((end - Date.now()) / 60_000));
        return (
          <div className="absolute top-4 left-1/2 -translate-x-1/2 z-30 bg-orange-600/90 text-white rounded-xl px-5 py-3 text-sm flex items-center gap-3 backdrop-blur shadow-lg max-w-[90vw]">
            <span className="text-orange-200">⚠</span>
            <div>
              <div className="font-semibold">Canal eliminado</div>
              <div className="text-xs text-orange-100">Seguirás viendo durante {minsLeft > 1 ? `${minsLeft} minutos más` : 'menos de 1 minuto'}. Luego volverás a los canales.</div>
            </div>
          </div>
        );
      })()}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-center p-6 gap-4">
          <AlertTriangle className="w-14 h-14 text-destructive" />
          <p className="text-white text-lg font-medium max-w-sm">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={() => { setError(null); setIsLoading(true); const v = videoRef.current; if (v) { v.load(); v.play().catch(() => {}); } }}
              className="flex items-center gap-2 px-5 py-2.5 bg-primary text-white rounded-lg text-sm hover:bg-primary/90 transition-colors"
            >
              <RotateCcw className="w-4 h-4" /> Reintentar
            </button>
            <button onClick={() => setLocation(backUrl)} className="px-5 py-2.5 bg-white/10 text-white rounded-lg text-sm hover:bg-white/20 transition-colors">
              Volver
            </button>
          </div>
        </div>
      )}

      <div className={`absolute inset-0 flex flex-col justify-between transition-opacity duration-300 z-10 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="bg-gradient-to-b from-black/80 to-transparent px-4 pt-4 pb-8">
          <div className="flex items-center gap-3">
            <button
              onClick={() => setLocation(backUrl)}
              className={`p-2.5 rounded-full bg-black/40 text-white backdrop-blur transition-all flex-shrink-0 ${ctrlIndex === controls.indexOf('back') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
            >
              <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm sm:text-lg font-semibold text-white truncate drop-shadow">{currentTitle}</h2>
              <div className="flex items-center gap-2 mt-0.5">
                {isLive && <span className="px-2 py-0.5 bg-red-600 text-white text-[9px] sm:text-[10px] rounded uppercase tracking-wider font-bold">EN VIVO</span>}
                <span className="text-white/40 text-[9px] sm:text-[10px] uppercase tracking-wide">{formatLabel}</span>
              </div>
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 sm:pb-6 space-y-3">
          {!isLive && duration > 0 && (
            <div className="space-y-1">
              <div
                ref={progressRef}
                className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer group relative"
                onClick={handleSeek}
              >
                <div
                  className="h-full bg-primary rounded-full relative transition-all"
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 w-3 h-3 bg-white rounded-full shadow opacity-0 group-hover:opacity-100 transition-opacity -translate-x-1/2" />
                </div>
              </div>
              <div className="flex justify-between text-[10px] text-white/50">
                <span>{formatTime(currentTime)}</span>
                <span>{formatTime(duration)}</span>
              </div>
            </div>
          )}

          <div className="flex items-center justify-center gap-2 sm:gap-4 flex-wrap">
            {hasChannels && (
              <button
                onClick={goPrevChannel}
                className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('prevch') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
                title="Canal anterior"
              >
                <ChevronLeft className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            {!isLive && (
              <button
                onClick={() => skip(-10)}
                className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('skipback') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
                title="-10s"
              >
                <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            <button
              onClick={castState === 'connected' ? castTogglePlay : togglePlay}
              className={`p-3.5 sm:p-5 rounded-full bg-primary text-white transition-all shadow-lg ${ctrlIndex === controls.indexOf('play') ? 'ring-4 ring-white scale-110' : 'hover:scale-105 hover:bg-primary/90'}`}
            >
              {(castState === 'connected' ? castIsPlaying : isPlaying)
                ? <Pause className="w-6 h-6 sm:w-8 sm:h-8 fill-current" />
                : <Play className="w-6 h-6 sm:w-8 sm:h-8 fill-current" />}
            </button>

            {!isLive && (
              <button
                onClick={() => skip(10)}
                className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('skipfwd') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
                title="+10s"
              >
                <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}

            {hasChannels && (
              <button
                onClick={goNextChannel}
                className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('nextch') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
                title="Canal siguiente"
              >
                <ChevronRight className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}


            {/* AirPlay ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ visible on ALL iOS browsers and macOS Safari (all use WebKit) */}
            {supportsAirPlay && (
              <button
                onClick={() => {
                  const v = videoRef.current as any;
                  if (v?.webkitShowPlaybackTargetPicker) v.webkitShowPlaybackTargetPicker();
                }}
                className={`p-2.5 sm:p-3 rounded-full backdrop-blur transition-all bg-black/40 text-white hover:bg-black/60 ${ctrlIndex === controls.indexOf('cast') ? 'ring-2 ring-primary scale-110' : ''}`}
                title="AirPlay al TV"
              >
                <CastIcon className="w-4 h-4 sm:w-5 sm:h-5" />
              </button>
            )}
            {/* Chromecast ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ only on non-AirPlay devices (Android/Desktop Chrome).
                On iOS/macOS Safari supportsAirPlay=true so this is hidden. */}
            {!supportsAirPlay && (
              <CastButton
                castState={castState}
                onCast={handleCast}
                className={ctrlIndex === controls.indexOf('cast') ? 'ring-2 ring-primary scale-110' : ''}
              />
            )}

            {(document as any).pictureInPictureEnabled && (
                <button
                  onClick={togglePiP}
                  className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('pip') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
                  title="Ventana flotante"
                >
                  <PictureInPicture2 className="w-4 h-4 sm:w-5 sm:h-5" />
                </button>
              )}

              <button
                onClick={toggleFullscreen}
                className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('fullscreen') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
              >
                {isFullscreen ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" /> : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>
          </div>

          <p className="text-center text-white/25 text-[9px] sm:text-[10px] pb-1">
            {hasChannels
              ? '↑ Canal siguiente · ↓ Canal anterior · ← → Controles · Esc Minimizar'
              : isLive
                ? '↑ ↓ Volumen · ← → Controles · Esc Salir'
                : 'Espacio: Reproducir · ↑↓ Volumen · Shift+←→ Saltar 30s · F: Pantalla completa'}
          </p>
        </div>
      </div>
    </div>
  );
}
