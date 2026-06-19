import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useLocation } from 'wouter';
import { Play, Pause, Volume2, VolumeX, Maximize, Minimize, ArrowLeft, RotateCcw, SkipBack, SkipForward, AlertTriangle, ChevronRight } from 'lucide-react';
import { YouTubePlayerPage } from '@/components/YouTubePlayerPage';
import logo from '@assets/logo_supertv.png';
import { getProgress, saveProgress, addToHistory, saveEpisodeProgress, getEpisodeProgress } from '@/lib/user-data';
import { getMiniPlayerState, updateMiniPlayerState } from '@/lib/mini-player-state';
import { normalizeKey } from '@/lib/tv-remote';

type VideoFormat = 'hls' | 'dash' | 'flv' | 'native' | 'youtube';

function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s?#]+)/);
  return m ? m[1] : null;
}

function detectFormat(url: string): VideoFormat {
  if (url.includes('youtube.com/') || url.includes('youtu.be/')) return 'youtube';
  const clean = url.toLowerCase().split('?')[0].split('#')[0];
  if (clean.endsWith('.m3u8') || clean.includes('/hls/') || clean.includes('manifest.m3u8')) return 'hls';
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

export default function VodPlayerPage() {
  const [, setLocation] = useLocation();

  const sp = new URLSearchParams(window.location.search);

  const rawUrl = sp.get('url') || '';
  const title = sp.get('title') || 'Reproduciendo';
  const type = sp.get('type') || 'movie';
  const movieId = sp.get('movieId');
  const seriesId = sp.get('seriesId');
  const seasonId = sp.get('seasonId');
  const episodeId = sp.get('episodeId');
  const category = sp.get('category');
  const startFrom = sp.get('startFrom');
  const seasonNumber = sp.get('seasonNumber');
  const episodeNumber = sp.get('episodeNumber');
  const seriesTitle = sp.get('seriesTitle');
  const nextEpisodeId = sp.get('nextEpisodeId');
  const nextSeasonId = sp.get('nextSeasonId');
  const nextEpisodeTitle = sp.get('nextEpisodeTitle');
  const nextEpisodeUrl = sp.get('nextEpisodeUrl') || '';
  const nextEpisodeFormat = sp.get('nextEpisodeFormat') || '';
  const nextSeasonNumber = sp.get('nextSeasonNumber') || '';
  const nextEpisodeNumber = sp.get('nextEpisodeNumber') || '';
  const storedFormat = sp.get('format') as VideoFormat | null;

  const backUrl = episodeId && seriesId
    ? `/serie/${seriesId}`
    : movieId ? `/pelicula/${movieId}`
    : type === 'movie' ? '/home?tab=movies' : '/home?tab=series';

  const format: VideoFormat = storedFormat || detectFormat(rawUrl);

  // D-pad controls order for the bottom bar
  const vodControls = useMemo(
    () => ['back', 'skipback', 'play', 'skipfwd', ...(nextEpisodeId ? ['nextepisode'] : []), 'mute', 'fullscreen'],
    [nextEpisodeId]
  );

  const videoRef = useRef<HTMLVideoElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const cleanupRef = useRef<(() => void) | null>(null);
  const savedTimeRef = useRef(0);
  const lastSaveRef = useRef(0);
  const retryCountRef = useRef(0);
  const controlsTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showNextEpRef = useRef(false);
  const autoFullscreenDoneRef = useRef(false);
  const userMutedRef = useRef(false);

  const [currentUrl, setCurrentUrl] = useState(rawUrl);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showControls, setShowControls] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isBuffering, setIsBuffering] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showNextEp, setShowNextEp] = useState(false);
  const [nextEpFocused, setNextEpFocused] = useState(false);
  const [nextEpCountdown, setNextEpCountdown] = useState(0);
  const [errorBtnIndex, setErrorBtnIndex] = useState(0);
  // D-pad control focus index: matches vodControls array below
  const [ctrlFocusIdx, setCtrlFocusIdx] = useState(2); // default: play button

  // Bug 3/4 fix: close mini-player when vod-player opens (prevents overlay during movie)
  useEffect(() => {
    const mini = getMiniPlayerState();
    if (mini?.isMinimized) updateMiniPlayerState({ isMinimized: false });
  }, []);

  useEffect(() => {
    showNextEpRef.current = showNextEp;
  }, [showNextEp]);

  useEffect(() => {
    setShowNextEp(false);
    setNextEpFocused(false);
    setNextEpCountdown(0);
    showNextEpRef.current = false;
  }, [episodeId, movieId]);

  const showControlsTemporarily = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current);
    controlsTimeoutRef.current = setTimeout(() => setShowControls(false), 4000);
  }, []);

  useEffect(() => {
    if (type === 'episode' && episodeId) {
      let seekTo = 0;
      if (startFrom !== null) {
        seekTo = Number(startFrom) > 10 ? Number(startFrom) : 0;
      } else {
        const prog = getEpisodeProgress(Number(episodeId));
        seekTo = prog && prog.time > 10 ? prog.time : 0;
      }
      savedTimeRef.current = seekTo;
    } else if (type === 'movie' && movieId) {
      let seekTo = 0;
      if (startFrom !== null) {
        seekTo = Number(startFrom) > 10 ? Number(startFrom) : 0;
      } else {
        const prog = getProgress(Number(movieId));
        seekTo = prog && prog.time > 10 ? prog.time : 0;
      }
      savedTimeRef.current = seekTo;
      addToHistory(Number(movieId), category || null);
    }
    showControlsTemporarily();
    return () => { if (controlsTimeoutRef.current) clearTimeout(controlsTimeoutRef.current); };
  }, []);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || !currentUrl) return;

    setError(null);
    setIsLoading(true);
    setIsBuffering(false);
    let destroyed = false;

    const onPlay = () => {
      setIsPlaying(true);
      setIsLoading(false);
      // Auto-unmute: video starts muted to bypass autoplay policy, unmute on first play
      if (!userMutedRef.current && video.muted) {
        video.muted = false;
      }
      // Auto-fullscreen on first play to hide browser chrome
      if (!autoFullscreenDoneRef.current) {
        autoFullscreenDoneRef.current = true;
        const el = containerRef.current as any;
        const vid = video as any;
        const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
        if (!isFull) {
          // iOS Safari requires webkitEnterFullscreen on the video element — try first
          if (vid?.webkitEnterFullscreen) { try { vid.webkitEnterFullscreen(); } catch {} }
          else {
            const req = el?.requestFullscreen || el?.webkitRequestFullscreen;
            if (req) { try { req.call(el); } catch {} }
          }
        }
      }
    };
    const onPause = () => setIsPlaying(false);
    const onWaiting = () => setIsBuffering(true);
    const onCanPlay = () => { setIsBuffering(false); setIsLoading(false); };
    const onDurationChange = () => { if (isFinite(video.duration)) setDuration(video.duration); };
    const onLoadedMetadata = () => {
      if (savedTimeRef.current > 0) {
        video.currentTime = savedTimeRef.current;
        savedTimeRef.current = 0;
      }
    };
    const onLoadedData = () => setIsLoading(false);
    const onVolumeChange = () => { setVolume(video.volume); setIsMuted(video.muted); };
    const onTimeUpdate = () => {
      const t = video.currentTime;
      setCurrentTime(t);
      if (nextEpisodeId && isFinite(video.duration) && video.duration > 60) {
        const timeLeft = video.duration - t;
        if (timeLeft <= 30 && t > 30) {
          setNextEpCountdown(Math.ceil(timeLeft));
          if (!showNextEp) {
            setShowNextEp(true);
            setNextEpFocused(true);
          }
        } else if (showNextEpRef.current && timeLeft > 30) {
          setShowNextEp(false);
          setNextEpFocused(false);
          setNextEpCountdown(0);
          showNextEpRef.current = false;
        }
      }
      const now = Date.now();
      if (now - lastSaveRef.current > 5000) {
        lastSaveRef.current = now;
        if (type === 'movie' && movieId) {
          saveProgress(Number(movieId), t, video.duration || 0);
        } else if (type === 'episode' && episodeId && seriesId && seasonId) {
          saveEpisodeProgress(
            Number(seriesId), Number(seasonId), Number(seasonNumber) || 1,
            Number(episodeId), Number(episodeNumber) || 1, t, video.duration || 0, title,
          );
        }
      }
    };
    const onEnded = () => {
      if (nextEpisodeId) { setShowNextEp(true); setNextEpFocused(true); }
    };
    const onError = () => {
      if (destroyed) return;
      if (retryCountRef.current === 0) {
        retryCountRef.current = 1;
        const sep = currentUrl.includes('?') ? '&' : '?';
        setCurrentUrl(`${currentUrl}${sep}_t=${Date.now()}`);
        return;
      }
      const err = video.error;
      let msg = 'No se pudo reproducir el video. Intenta de nuevo.';
      if (err?.code === 4) {
        msg = 'No se pudo cargar el video. Si es un archivo de Terabox, asegúrate de configurar las cookies de tu cuenta en Ajustes del admin. Pulsa Reintentar para intentar de nuevo.';
      } else if (err?.code === 3) {
        msg = 'Error al decodificar el video. El archivo puede estar dañado o usar un codec no compatible con este navegador.';
      } else if (err?.code === 2) {
        msg = 'Error de red al cargar el video. Comprueba tu conexión e intenta de nuevo.';
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
    video.addEventListener('ended', onEnded);

    const initVideo = async () => {
      // React's `muted` JSX prop doesn't apply to the DOM — set imperatively so
      // the browser allows autoplay (muted autoplay is universally permitted)
      video.muted = true;
      try {
        if (format === 'hls') {
          const Hls = (await import('hls.js')).default;
          if (destroyed) return;
          if (Hls.isSupported()) {
            const hls = new Hls({
              enableWorker: false,
              maxBufferLength: 30,
              maxMaxBufferLength: 60,
              startFragPrefetch: false,
            });
            hls.loadSource(currentUrl);
            hls.attachMedia(video);
            hls.on(Hls.Events.MANIFEST_PARSED, () => {
              if (destroyed) return;
              if (savedTimeRef.current > 0) { video.currentTime = savedTimeRef.current; savedTimeRef.current = 0; }
              video.play().catch(() => {});
            });
            hls.on(Hls.Events.ERROR, (_, data) => {
              if (data.fatal) {
                setError('No se pudo cargar el stream HLS.');
                setIsLoading(false);
              }
            });
            cleanupRef.current = () => hls.destroy();
          } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
            video.src = currentUrl;
            video.play().catch(() => {});
          } else {
            setError('Tu navegador no soporta HLS. Prueba con Chrome o Safari.');
            setIsLoading(false);
          }
        } else if (format === 'dash') {
          const dashjs = await import('dashjs');
          if (destroyed) return;
          const player = dashjs.MediaPlayer().create();
          player.initialize(video, currentUrl, true);
          player.updateSettings({
            streaming: { buffer: { fastSwitchEnabled: true } },
          });
          cleanupRef.current = () => player.destroy();
        } else if (format === 'flv') {
          const flvjs = (await import('flv.js')).default;
          if (destroyed) return;
          if (flvjs.isSupported()) {
            const flvPlayer = flvjs.createPlayer({ type: 'flv', url: currentUrl, isLive: false });
            flvPlayer.attachMediaElement(video);
            flvPlayer.load();
            flvPlayer.play();
            flvPlayer.on(flvjs.Events.ERROR, () => {
              setError('Error al reproducir FLV.');
              setIsLoading(false);
            });
            cleanupRef.current = () => flvPlayer.destroy();
          } else {
            setError('Tu navegador no soporta FLV.');
            setIsLoading(false);
          }
        } else if (format === 'youtube') {
          setIsLoading(false);
          setIsPlaying(true);
        } else {
          video.src = currentUrl;
          video.load();
          video.play().catch(() => {});
        }
      } catch {
        if (!destroyed) { setError('No se pudo inicializar el reproductor.'); setIsLoading(false); }
      }
    };

    initVideo();

    return () => {
      destroyed = true;
      if (type === 'movie' && movieId && video.currentTime > 0) {
        saveProgress(Number(movieId), video.currentTime, video.duration || 0);
      }
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
      video.removeEventListener('ended', onEnded);
      if (cleanupRef.current) { cleanupRef.current(); cleanupRef.current = null; }
      video.src = '';
      video.load();
    };
  }, [currentUrl]);

  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {}); else v.pause();
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    userMutedRef.current = !v.muted;
    v.muted = !v.muted;
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const skip = useCallback((secs: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.currentTime = Math.max(0, Math.min(v.duration || 0, v.currentTime + secs));
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const handleSeek = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const v = videoRef.current;
    if (!v || !isFinite(v.duration)) return;
    const rect = e.currentTarget.getBoundingClientRect();
    v.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * v.duration;
    showControlsTemporarily();
  }, [showControlsTemporarily]);

  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current as any;
    const vid = videoRef.current as any;
    if (!el) return;
    const isFull = !!(document.fullscreenElement || (document as any).webkitFullscreenElement);
    if (!isFull) {
      if (isIOS) {
        // iOS Safari: fullscreen solo funciona via webkitEnterFullscreen en el elemento video
        if (vid?.webkitEnterFullscreen) { try { vid.webkitEnterFullscreen(); return; } catch {} }
      } else {
        // Android Chrome / desktop: requestFullscreen + forzar orientacion horizontal
        const req = vid?.requestFullscreen || el.requestFullscreen || el.webkitRequestFullscreen;
        const target = vid?.requestFullscreen ? vid : el;
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
      try { screen.orientation?.unlock(); } catch {}
      const exit = (document as any).exitFullscreen || (document as any).webkitExitFullscreen;
      if (exit) { try { exit.call(document); return; } catch {} }
      if (vid?.webkitExitFullscreen) { try { vid.webkitExitFullscreen(); return; } catch {} }
      setIsFullscreen(false);
    }
  }, [isIOS]);

  useEffect(() => {
    const onFsChange = () => {
      setIsFullscreen(!!(document.fullscreenElement || (document as any).webkitFullscreenElement));
    };
    const onIosEnter = () => setIsFullscreen(true);
    const onIosExit = () => setIsFullscreen(false);
    const vid = videoRef.current as any;
    document.addEventListener('fullscreenchange', onFsChange);
    document.addEventListener('webkitfullscreenchange', onFsChange);
    if (vid) {
      vid.addEventListener('webkitbeginfullscreen', onIosEnter);
      vid.addEventListener('webkitendfullscreen', onIosExit);
    }
    return () => {
      document.removeEventListener('fullscreenchange', onFsChange);
      document.removeEventListener('webkitfullscreenchange', onFsChange);
      if (vid) {
        vid.removeEventListener('webkitbeginfullscreen', onIosEnter);
        vid.removeEventListener('webkitendfullscreen', onIosExit);
      }
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Error screen navigation
      if (error) {
        switch (e.key) {
          case 'ArrowLeft': case 'ArrowUp': e.preventDefault(); setErrorBtnIndex(0); break;
          case 'ArrowRight': case 'ArrowDown': e.preventDefault(); setErrorBtnIndex(1); break;
          case 'Enter': e.preventDefault();
            if (errorBtnIndex === 0) handleRetry();
            else setLocation(backUrl);
            break;
          case 'Escape': case 'Backspace': e.preventDefault(); setLocation(backUrl); break;
        }
        return;
      }
      const key = normalizeKey(e);

      // When next episode banner is focused, arrow keys control it
      if (showNextEp && nextEpFocused && nextEpisodeId) {
        switch (key) {
          case 'Enter':
          case 'ArrowRight':
          case 'MediaFastForward':
            e.preventDefault(); goNextEpisode(); return;
          case 'ArrowLeft':
          case 'Backspace':
            e.preventDefault(); setNextEpFocused(false); showControlsTemporarily(); return;
          case 'Escape':
            e.preventDefault(); setNextEpFocused(false); setShowNextEp(false); showControlsTemporarily(); return;
          default: break;
        }
      }

      switch (key) {
        case ' ':
        case 'MediaPlayPause':
          e.preventDefault(); togglePlay(); showControlsTemporarily(); break;

        case 'ArrowLeft':
          e.preventDefault();
          if (e.shiftKey) { skip(-30); showControlsTemporarily(); }
          else { setCtrlFocusIdx(p => Math.max(0, p - 1)); showControlsTemporarily(); }
          break;

        case 'ArrowRight':
          e.preventDefault();
          if (e.shiftKey) { skip(30); showControlsTemporarily(); }
          else if (showNextEp && nextEpisodeId && ctrlFocusIdx >= vodControls.length - 1) {
            setNextEpFocused(true); showControlsTemporarily();
          } else {
            setCtrlFocusIdx(p => Math.min(vodControls.length - 1, p + 1)); showControlsTemporarily();
          }
          break;

        case 'ArrowUp':
          e.preventDefault();
          { const v = videoRef.current; if (v) v.volume = Math.min(1, v.volume + 0.1); }
          showControlsTemporarily(); break;

        case 'ArrowDown':
          e.preventDefault();
          { const v = videoRef.current; if (v) v.volume = Math.max(0, v.volume - 0.1); }
          showControlsTemporarily(); break;

        case 'Enter':
          e.preventDefault();
          switch (vodControls[ctrlFocusIdx]) {
            case 'back': setLocation(backUrl); break;
            case 'skipback': skip(-10); break;
            case 'play': togglePlay(); break;
            case 'skipfwd': skip(10); break;
            case 'nextepisode': if (nextEpisodeId) goNextEpisode(); break;
            case 'mute': toggleMute(); break;
            case 'fullscreen': toggleFullscreen(); break;
          }
          showControlsTemporarily(); break;

        case 'MediaFastForward': e.preventDefault(); skip(10); showControlsTemporarily(); break;
        case 'MediaRewind': e.preventDefault(); skip(-10); showControlsTemporarily(); break;
        case 'VolumeUp': e.preventDefault(); { const v = videoRef.current; if (v) v.volume = Math.min(1, v.volume + 0.1); } break;
        case 'VolumeDown': e.preventDefault(); { const v = videoRef.current; if (v) v.volume = Math.max(0, v.volume - 0.1); } break;
        case 'VolumeMute': e.preventDefault(); toggleMute(); break;
        case 'f': case 'F': toggleFullscreen(); break;
        case 'm': case 'M': toggleMute(); break;
        case 'Escape': case 'Backspace':
          e.preventDefault();
          if (document.fullscreenElement) document.exitFullscreen();
          setLocation(backUrl);
          break;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [error, errorBtnIndex, showNextEp, nextEpFocused, nextEpisodeId, ctrlFocusIdx, vodControls, togglePlay, skip, toggleMute, toggleFullscreen, backUrl, setLocation, showControlsTemporarily]);

  const handleRetry = () => {
    retryCountRef.current = 0;
    setError(null);
    setIsLoading(true);
    setCurrentTime(0);
    setDuration(0);
    const sep = rawUrl.includes('?') ? '&' : '?';
    setCurrentUrl(`${rawUrl}${sep}_t=${Date.now()}`);
  };

  const goNextEpisode = () => {
    if (!nextEpisodeId || !seriesId) return;
    const params = new URLSearchParams({
      url: nextEpisodeUrl,
      title: nextEpisodeTitle || 'Episodio siguiente',
      type: 'episode',
      episodeId: nextEpisodeId,
      seriesId: seriesId,
      seasonId: nextSeasonId || seasonId || '',
      seasonNumber: nextSeasonNumber || seasonNumber || '',
      episodeNumber: nextEpisodeNumber || '',
      seriesTitle: seriesTitle || '',
    });
    if (nextEpisodeFormat) params.set('format', nextEpisodeFormat);
    setLocation(`/vod-player?${params.toString()}`);
  };

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;

  if (format === 'youtube') {
    const ytId = extractYouTubeId(currentUrl);
    if (!ytId) return <div className="flex items-center justify-center h-[100dvh] bg-black text-white/60 text-sm">URL de YouTube inválida</div>;
    // Compute effective startFrom: URL param → saved episode/movie progress → 0
    let ytStartFrom: number | undefined;
    if (startFrom !== null) {
      ytStartFrom = Number(startFrom) > 10 ? Number(startFrom) : undefined;
    } else if (type === 'episode' && episodeId) {
      const ep = getEpisodeProgress(Number(episodeId));
      ytStartFrom = ep && ep.time > 10 ? ep.time : undefined;
    } else if (type === 'movie' && movieId) {
      const mp = getProgress(Number(movieId));
      ytStartFrom = mp && mp.time > 10 ? mp.time : undefined;
    }
    return <YouTubePlayerPage
      videoId={ytId}
      title={title}
      onBack={() => setLocation(backUrl)}
      movieId={type !== 'episode' && movieId ? Number(movieId) : undefined}
      startFrom={ytStartFrom}
      episodeId={episodeId ? Number(episodeId) : undefined}
      seriesId={seriesId ? Number(seriesId) : undefined}
      seasonId={seasonId ? Number(seasonId) : undefined}
      seasonNumber={seasonNumber ? Number(seasonNumber) : undefined}
      episodeNumber={episodeNumber ? Number(episodeNumber) : undefined}
      nextEpisodeId={nextEpisodeId ? Number(nextEpisodeId) : undefined}
      nextEpisodeTitle={nextEpisodeTitle || undefined}
      nextEpisodeNumber={nextEpisodeNumber ? Number(nextEpisodeNumber) : undefined}
      nextSeasonNumber={nextSeasonNumber ? Number(nextSeasonNumber) : undefined}
      seriesTitle={seriesTitle || undefined}
      onNextEpisode={nextEpisodeId ? goNextEpisode : undefined}
    />;
  }

  return (
    <div
      ref={containerRef}
      className="relative w-full h-[100dvh] bg-black overflow-hidden flex items-center justify-center select-none"
      onMouseMove={showControlsTemporarily}
      onTouchStart={showControlsTemporarily}
      onClick={e => {
        if (e.target === containerRef.current || e.target === videoRef.current) {
          const vid = videoRef.current as any;
          // iOS Safari requires webkitEnterFullscreen to be called from a user gesture.
          // If the video isn't already fullscreen and the iOS API is available, go fullscreen
          // on this tap instead of toggling play — subsequent taps toggle play normally.
          if (!isFullscreen && vid?.webkitEnterFullscreen) {
            try { vid.webkitEnterFullscreen(); showControlsTemporarily(); return; } catch {}
          }
          togglePlay();
        }
        showControlsTemporarily();
      }}
    >
      <video
        ref={videoRef}
        className={`w-full h-full object-contain ${error ? 'hidden' : ''}`}
        autoPlay
        muted
        playsInline
        preload="auto"
      />


      {(isLoading || isBuffering) && !error && (
        <div className="absolute inset-0 flex items-center justify-center z-20 pointer-events-none">
          <svg className="w-10 h-10 animate-spin" viewBox="0 0 40 40" fill="none">
            <circle cx="20" cy="20" r="16" stroke="white" strokeWidth="3" strokeOpacity="0.15" />
            <path d="M20 4 A16 16 0 0 1 36 20" stroke="white" strokeWidth="3" strokeLinecap="round" />
          </svg>
        </div>
      )}

      {error && (
        <div className="absolute inset-0 flex flex-col items-center justify-center z-20 text-center p-6 gap-4">
          <AlertTriangle className="w-14 h-14 text-destructive" />
          <p className="text-white text-base font-medium max-w-sm leading-relaxed">{error}</p>
          <div className="flex gap-3">
            <button
              onClick={handleRetry}
              className={`flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm transition-colors ${errorBtnIndex === 0 ? 'bg-primary text-white ring-2 ring-white scale-105' : 'bg-primary/70 text-white hover:bg-primary/90'}`}
            >
              <RotateCcw className="w-4 h-4" /> Reintentar
            </button>
            <button
              onClick={() => setLocation(backUrl)}
              className={`px-5 py-2.5 rounded-lg text-sm text-white transition-colors ${errorBtnIndex === 1 ? 'bg-white/25 ring-2 ring-white scale-105' : 'bg-white/10 hover:bg-white/20'}`}
            >
              Volver
            </button>
          </div>
          <p className="text-white/30 text-xs mt-1">← → para navegar · Enter para seleccionar</p>
        </div>
      )}

      {nextEpisodeId && showNextEp && (
        <div
          className={`absolute bottom-28 right-4 z-30 backdrop-blur rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl transition-all duration-200 ${
            nextEpFocused
              ? 'bg-black/95 border-2 border-primary ring-2 ring-primary/50 scale-105'
              : showNextEp
                ? 'bg-black/90 border border-white/40 animate-pulse'
                : 'bg-black/60 border border-white/15'
          }`}
        >
          <div className="text-sm text-white">
            <div className={`text-xs mb-0.5 ${showNextEp ? 'text-primary font-medium' : 'text-white/40'}`}>
              {showNextEp ? '⏭ Siguiente episodio' : 'Siguiente episodio'}
            </div>
            <div className="font-medium truncate max-w-[180px]">{nextEpisodeTitle}</div>
            <div className={`text-[10px] mt-0.5 ${nextEpFocused ? 'text-primary font-semibold' : 'text-white/30'}`}>
              {nextEpFocused
                ? '► Enter / → para reproducir'
                : nextEpCountdown > 0
                  ? `En ${nextEpCountdown}s · Enter para reproducir`
                  : 'Enter para reproducir'}
            </div>
          </div>
          <button
            onClick={goNextEpisode}
            className={`flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap ${
              nextEpFocused
                ? 'bg-primary text-white scale-105 shadow-lg shadow-primary/40'
                : showNextEp
                  ? 'bg-primary text-white hover:bg-primary/90'
                  : 'bg-white/15 text-white hover:bg-primary/70'
            }`}
          >
            Reproducir <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}


      <div className={`absolute inset-0 flex flex-col justify-between z-10 transition-opacity duration-300 ${showControls ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
        <div className="bg-gradient-to-b from-black/80 to-transparent px-4 pt-4 pb-10">
          <div className="flex items-start gap-3">
            <button
              onClick={() => setLocation(backUrl)}
              className={`p-2.5 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60 transition-all flex-shrink-0 mt-0.5 ${vodControls[ctrlFocusIdx] === 'back' ? 'ring-2 ring-primary scale-105' : ''}`}
            >
              <ArrowLeft className="w-5 h-5 sm:w-6 sm:h-6" />
            </button>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm sm:text-lg font-semibold text-white truncate drop-shadow leading-tight">{title}</h2>
              {seriesTitle && (
                <p className="text-white/50 text-xs mt-0.5 truncate">
                  {seriesTitle}
                  {seasonNumber && episodeNumber ? ` · T${seasonNumber}E${episodeNumber}` : ''}
                </p>
              )}
            </div>
          </div>
        </div>

        <div className="bg-gradient-to-t from-black/90 to-transparent px-4 pb-4 sm:pb-6 space-y-3">
          {duration > 0 && (
            <div className="space-y-1">
              <div
                className="w-full h-1.5 bg-white/20 rounded-full cursor-pointer group relative"
                onClick={handleSeek}
              >
                <div
                  className="h-full bg-primary rounded-full relative transition-none"
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

          <div className="flex items-center justify-center gap-2 sm:gap-4">
            <button
              onClick={() => skip(-10)}
              className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60 transition-all ${vodControls[ctrlFocusIdx] === 'skipback' ? 'ring-2 ring-primary scale-110' : ''}`}
              title="-10s"
            >
              <SkipBack className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            <button
              onClick={togglePlay}
              className={`p-3.5 sm:p-5 rounded-full bg-primary text-white transition-all shadow-lg hover:scale-105 hover:bg-primary/90 ${vodControls[ctrlFocusIdx] === 'play' ? 'ring-4 ring-white scale-110' : ''}`}
            >
              {isPlaying
                ? <Pause className="w-6 h-6 sm:w-8 sm:h-8 fill-current" />
                : <Play className="w-6 h-6 sm:w-8 sm:h-8 fill-current" />}
            </button>

            <button
              onClick={() => skip(10)}
              className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60 transition-all ${vodControls[ctrlFocusIdx] === 'skipfwd' ? 'ring-2 ring-primary scale-110' : ''}`}
              title="+10s"
            >
              <SkipForward className="w-4 h-4 sm:w-5 sm:h-5" />
            </button>

            {nextEpisodeId && (
              <button
                onClick={goNextEpisode}
                className={`flex items-center gap-1.5 px-3 py-2 rounded-full text-xs font-semibold transition-all ${
                  nextEpFocused || vodControls[ctrlFocusIdx] === 'nextepisode'
                    ? 'bg-primary text-white ring-2 ring-white/50 scale-105'
                    : 'bg-primary/80 text-white hover:bg-primary'
                }`}
                title="Siguiente episodio"
              >
                <ChevronRight className="w-4 h-4" />
                <span className="hidden sm:inline">Siguiente</span>
              </button>
            )}

            <div className={`flex items-center gap-1.5 sm:gap-2 bg-black/40 rounded-full px-2.5 sm:px-3 py-1.5 sm:py-2 backdrop-blur ${vodControls[ctrlFocusIdx] === 'mute' ? 'ring-2 ring-primary' : ''}`}>
              <button onClick={toggleMute} className="p-1 sm:p-1.5 text-white">
                {isMuted || volume === 0
                  ? <VolumeX className="w-4 h-4 sm:w-5 sm:h-5" />
                  : <Volume2 className="w-4 h-4 sm:w-5 sm:h-5" />}
              </button>
              <input
                type="range" min="0" max="1" step="0.05"
                value={isMuted ? 0 : volume}
                onChange={e => {
                  const v = videoRef.current;
                  const val = parseFloat(e.target.value);
                  if (v) { v.volume = val; v.muted = val === 0; }
                }}
                className="w-14 sm:w-20 accent-primary"
              />
              <span className="text-[10px] text-white/50 w-7 text-right">{Math.round((isMuted ? 0 : volume) * 100)}%</span>
            </div>

            <button
              onClick={() => { if (isFullscreen) setLocation(backUrl); else toggleFullscreen(); }}
              className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur hover:bg-black/60 transition-all ${vodControls[ctrlFocusIdx] === 'fullscreen' ? 'ring-2 ring-primary scale-110' : ''}`}
            >
              {isFullscreen
                ? <Minimize className="w-4 h-4 sm:w-5 sm:h-5" />
                : <Maximize className="w-4 h-4 sm:w-5 sm:h-5" />}
            </button>
          </div>

          <p className="text-center text-white/25 text-[9px] sm:text-[10px] pb-1">
            ◄► Navegar · Enter Seleccionar · ↑↓ Volumen · Space Pausa · Shift+◄► ±30s
          </p>
        </div>
      </div>
    </div>
  );
}
