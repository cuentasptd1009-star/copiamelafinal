import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { Play, Pause, ArrowLeft, Maximize2, Minimize2, SkipBack, SkipForward, Heart, ChevronRight } from 'lucide-react';
import { loadYouTubeApi } from '@/lib/youtube-api';
import { saveProgress, saveEpisodeProgress, saveExternalProgress, clearExternalProgress } from '@/lib/user-data';
import logo from '@assets/logo_supertv.png';

interface Props {
  videoId: string;
  title: string;
  onBack: () => void;
  isFav?: boolean;
  onFavToggle?: () => void;
  movieId?: number;
  startFrom?: number;
  onHideFromCatalog?: () => void;
  // Episode-specific (for series)
  episodeId?: number;
  seriesId?: number;
  seasonId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  // External video id (for standalone YouTube results, not tied to a movie/episode)
  externalId?: string;
  // Next episode
  nextEpisodeId?: number;
  nextEpisodeTitle?: string;
  nextEpisodeNumber?: number;
  nextSeasonNumber?: number;
  seriesTitle?: string;
  onNextEpisode?: () => void;
}

function formatTime(s: number): string {
  if (!isFinite(s) || s < 0) return '0:00';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function YouTubePlayerPage({ videoId, title, onBack, isFav, onFavToggle, movieId, startFrom, onHideFromCatalog, externalId, episodeId, seriesId, seasonId, seasonNumber, episodeNumber, nextEpisodeId, nextEpisodeTitle, nextEpisodeNumber, nextSeasonNumber, seriesTitle, onNextEpisode }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const playerDivRef = useRef<HTMLDivElement>(null);
  const ytPlayerRef = useRef<any>(null);
  const ctrlTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastSaveRef = useRef(0);

  const [hasStarted, setHasStarted] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [ytEnded, setYtEnded] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [endBtnIndex, setEndBtnIndex] = useState(0);
  const [ctrlVisible, setCtrlVisible] = useState(true);
  const [isNativeFullscreen, setIsNativeFullscreen] = useState(false);
  const [isCssFullscreen, setIsCssFullscreen] = useState(true);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [showNextEp, setShowNextEp] = useState(false);
  const [coverBars, setCoverBars] = useState(true);
  // D-pad control focus — built dynamically; -1=none
  const [ctrlFocusIdx, setCtrlFocusIdx] = useState(-1);
  // Controls list: back | (fav?) | skip-10 | play | skip+10 | fullscreen
  const ytControls = useMemo(
    () => ['back', ...(onFavToggle !== undefined ? ['fav'] : []), 'skip-10', 'play', 'skip+10', 'fullscreen'],
    [onFavToggle]
  );
  const ytPlayIdx = ytControls.indexOf('play');

  // Reset next-ep state whenever the video changes
  useEffect(() => {
    setShowNextEp(false);
    setCoverBars(true);
  }, [videoId]);

  // Once video starts, keep bars a moment longer then fade them out
  useEffect(() => {
    if (!hasStarted) return;
    const t = setTimeout(() => setCoverBars(false), 5000);
    return () => clearTimeout(t);
  }, [hasStarted]);

  const isFullscreen = isNativeFullscreen || isCssFullscreen;

  const flashControls = useCallback(() => {
    setCtrlVisible(true);
    setCtrlFocusIdx(ytPlayIdx); // default focus: play/pause button
    if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current);
    ctrlTimerRef.current = setTimeout(() => { setCtrlVisible(false); setCtrlFocusIdx(-1); }, 4000);
  }, [ytPlayIdx]);

  // Poll current time while playing + save progress every ~5s
  useEffect(() => {
    if (isPlaying) {
      pollRef.current = setInterval(() => {
        const yt = ytPlayerRef.current;
        if (!yt) return;
        const t = yt.getCurrentTime?.() ?? 0;
        const d = yt.getDuration?.() ?? 0;
        setCurrentTime(t);
        if (d > 0) setDuration(d);
        // Show next episode button 30 seconds before the end (never at start)
        if (nextEpisodeId && d > 60 && t > 30) {
          if (d - t <= 30) {
            setShowNextEp(true);
          } else if (d - t > 30) {
            setShowNextEp(false);
          }
        }
        // Save progress every 5 seconds
        if (t > 10 && t - lastSaveRef.current >= 5) {
          lastSaveRef.current = t;
          if (episodeId && seriesId && seasonId) {
            saveEpisodeProgress(seriesId, seasonId, seasonNumber ?? 1, episodeId, episodeNumber ?? 1, t, d, title);
          } else if (movieId) {
            saveProgress(movieId, t, d);
          } else if (externalId) {
            saveExternalProgress(externalId, t, d);
          }
        }
      }, 500);
    } else {
      if (pollRef.current) clearInterval(pollRef.current);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [isPlaying, movieId, episodeId, seriesId, seasonId, seasonNumber, episodeNumber, externalId, title]);

  useEffect(() => {
    let destroyed = false;

    loadYouTubeApi(() => {
      if (destroyed || !playerDivRef.current) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      ytPlayerRef.current = new (window as any).YT.Player(playerDivRef.current, {
        videoId,
        width: String(vw),
        height: String(vh),
        playerVars: {
          autoplay: 1,
          controls: 0,
          disablekb: 1,
          rel: 0,
          modestbranding: 1,
          iv_load_policy: 3,
          showinfo: 0,
          playsinline: 1,
          fs: 0,
        },
        events: {
          onReady: (e: any) => {
            if (!destroyed) {
              const d = e.target.getDuration?.() ?? 0;
              if (d > 0) setDuration(d);
              try {
                const iframe = e.target.getIframe() as HTMLIFrameElement | null;
                if (iframe) {
                  iframe.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;min-width:100%;min-height:100%;border:0;display:block;';
                }
                if (playerDivRef.current) {
                  playerDivRef.current.style.cssText = 'position:absolute;top:0;left:0;right:0;bottom:0;width:100%;height:100%;';
                }
              } catch {}
            }
          },
          onError: (e: any) => {
            if (destroyed) return;
            const code = e.data;
            if (code === 101 || code === 150) {
              setYtError('Este video no está disponible en tu país o el autor no permite reproducirlo externamente.');
            } else if (code === 100) {
              setYtError('Este video no existe o fue eliminado de YouTube.');
            } else {
              setYtError('No se pudo reproducir el video de YouTube (error ' + code + ').');
            }
            setHasStarted(true);
          },
          onStateChange: (e: any) => {
            if (destroyed) return;
            if (e.data === 1 || e.data === 3) {
              setHasStarted(true);
            }
            if (e.data === 1) {
              setIsPlaying(true);
              setYtEnded(false);
              const d = ytPlayerRef.current?.getDuration?.() ?? 0;
              if (d > 0) setDuration(d);
            }
            if (e.data === 2) setIsPlaying(false);
            if (e.data === 0) {
              setIsPlaying(false);
              setYtEnded(true);
              if (nextEpisodeId) setShowNextEp(true);
              // Clear saved progress when video finishes
              if (episodeId) {
                try { localStorage.removeItem(`supertv_eprog_${episodeId}`); } catch {}
              } else if (movieId) {
                try { localStorage.removeItem(`supertv_prog_${movieId}`); } catch {}
              } else if (externalId) {
                clearExternalProgress(externalId);
              }
            }
          },
        },
      });
    });

    flashControls();

    return () => {
      destroyed = true;
      try { ytPlayerRef.current?.destroy(); } catch {}
      ytPlayerRef.current = null;
      if (ctrlTimerRef.current) clearTimeout(ctrlTimerRef.current);
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [videoId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track native browser fullscreen state
  useEffect(() => {
    const handler = () => setIsNativeFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', handler);
    document.addEventListener('webkitfullscreenchange', handler);
    return () => {
      document.removeEventListener('fullscreenchange', handler);
      document.removeEventListener('webkitfullscreenchange', handler);
    };
  }, []);

  // Keep container focused so keyboard events never go to the YouTube iframe
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    el.focus();
    // Re-focus whenever window regains focus (e.g. after iframe interaction)
    const onFocus = () => el.focus();
    window.addEventListener('focus', onFocus);
    return () => window.removeEventListener('focus', onFocus);
  }, []);

  // Request native fullscreen as soon as possible (component mounted from a user gesture)
  useEffect(() => {
    const tryFullscreen = () => {
      const el = containerRef.current as any;
      if (!el) return;
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        try { el.webkitRequestFullscreen(); } catch {}
      } else if (el.mozRequestFullScreen) {
        try { el.mozRequestFullScreen(); } catch {}
      }
    };
    // Try immediately and after a short delay (some browsers need the DOM to settle)
    tryFullscreen();
    const t = setTimeout(tryFullscreen, 100);
    return () => clearTimeout(t);
  }, []);

  const togglePlay = useCallback(() => {
    const yt = ytPlayerRef.current;
    if (!yt) return;
    if (isPlaying) { yt.pauseVideo(); } else { yt.playVideo(); setHasStarted(true); }
    flashControls();
  }, [isPlaying, flashControls]);

  const skip = useCallback((secs: number) => {
    const yt = ytPlayerRef.current;
    if (!yt) return;
    const dur = yt.getDuration?.() ?? duration;
    const cur = yt.getCurrentTime?.() ?? currentTime;
    const newTime = Math.max(0, Math.min(dur, cur + secs));
    yt.seekTo(newTime, true);
    setCurrentTime(newTime);
    flashControls();
  }, [currentTime, duration, flashControls]);

  const handleSeekClick = useCallback((clientX: number, rect: DOMRect) => {
    const yt = ytPlayerRef.current;
    if (!yt || duration <= 0) return;
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const newTime = ratio * duration;
    yt.seekTo(newTime, true);
    setCurrentTime(newTime);
    flashControls();
  }, [duration, flashControls]);

  // iOS-safe fullscreen: try native API, fall back to CSS
  const doToggleFullscreen = useCallback(() => {
    if (isCssFullscreen) {
      setIsCssFullscreen(false);
      return;
    }
    if (isNativeFullscreen) {
      try { document.exitFullscreen?.(); } catch {}
      try { (document as any).webkitExitFullscreen?.(); } catch {}
      return;
    }
    const el = containerRef.current as any;
    if (!el) { setIsCssFullscreen(true); return; }
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => setIsCssFullscreen(true));
    } else if (el.webkitRequestFullscreen) {
      try { el.webkitRequestFullscreen(); } catch { setIsCssFullscreen(true); }
    } else {
      setIsCssFullscreen(true);
    }
  }, [isCssFullscreen, isNativeFullscreen]);

  const toggleFullscreen = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    doToggleFullscreen();
  }, [doToggleFullscreen]);

  const startPlayback = useCallback(() => {
    const yt = ytPlayerRef.current;
    if (!yt) return;
    if (startFrom && startFrom > 10) { yt.seekTo(startFrom, true); }
    yt.playVideo();
    setHasStarted(true);
    flashControls();
    // Auto-fullscreen on first play (requires user gesture — this click qualifies)
    const el = containerRef.current as any;
    if (el) {
      if (el.requestFullscreen) {
        el.requestFullscreen().catch(() => {});
      } else if (el.webkitRequestFullscreen) {
        try { el.webkitRequestFullscreen(); } catch {}
      } else if (el.mozRequestFullScreen) {
        try { el.mozRequestFullScreen(); } catch {}
      }
    }
  }, [flashControls, startFrom]);

  // Keyboard / D-pad navigation — capture: true so iframe never steals events
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (document.activeElement as HTMLElement)?.tagName?.toUpperCase();
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Keep our container focused
      containerRef.current?.focus({ preventScroll: true });

      // End-screen navigation
      if (ytEnded) {
        switch (e.key) {
          case 'ArrowLeft':  e.preventDefault(); setEndBtnIndex(0); break;
          case 'ArrowRight': e.preventDefault(); setEndBtnIndex(1); break;
          case 'Enter': case ' ':
            e.preventDefault();
            if (showNextEp && onNextEpisode) { onNextEpisode(); break; }
            if (endBtnIndex === 0) {
              ytPlayerRef.current?.seekTo(0, true);
              ytPlayerRef.current?.playVideo();
              setHasStarted(true); setYtEnded(false); setShowNextEp(false);
            } else { onBack(); }
            break;
          case 'Escape': case 'Backspace': e.preventDefault(); onBack(); break;
        }
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (ctrlFocusIdx >= 0) {
            setCtrlFocusIdx(p => Math.max(0, p - 1));
            flashControls();
          } else {
            skip(-10);
            flashControls();
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (ctrlFocusIdx >= 0) {
            setCtrlFocusIdx(p => Math.min(ytControls.length - 1, p + 1));
            flashControls();
          } else {
            skip(10);
            flashControls();
          }
          break;
        case 'ArrowUp':
          e.preventDefault();
          if (!isFullscreen) { doToggleFullscreen(); }
          flashControls();
          break;
        case 'ArrowDown':
          e.preventDefault();
          if (isFullscreen) { onBack(); }
          flashControls();
          break;
        case ' ':
        case 'Enter':
          e.preventDefault();
          if (ctrlFocusIdx >= 0) {
            switch (ytControls[ctrlFocusIdx]) {
              case 'back': onBack(); break;
              case 'fav': onFavToggle?.(); break;
              case 'skip-10': skip(-10); break;
              case 'play': if (!hasStarted) startPlayback(); else togglePlay(); break;
              case 'skip+10': skip(10); break;
              case 'fullscreen': doToggleFullscreen(); break;
            }
            flashControls();
          } else if (showNextEp && onNextEpisode) {
            onNextEpisode();
          } else if (!hasStarted) {
            startPlayback();
          } else {
            togglePlay();
            flashControls();
          }
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          doToggleFullscreen();
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          if (isNativeFullscreen) {
            try { document.exitFullscreen?.(); } catch {}
          } else if (isCssFullscreen) {
            setIsCssFullscreen(false);
            onBack();
          } else {
            onBack();
          }
          break;
      }
    };
    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ytEnded, endBtnIndex, hasStarted, showNextEp, ctrlFocusIdx, ytControls, skip, togglePlay, startPlayback, doToggleFullscreen, flashControls, isNativeFullscreen, isCssFullscreen, isFullscreen, onBack, onNextEpisode, onFavToggle]);

  const progress = duration > 0 ? (currentTime / duration) * 100 : 0;
  const ctrlBtn = 'w-11 h-11 rounded-xl bg-black/50 backdrop-blur border border-white/15 text-white flex items-center justify-center active:scale-95 transition-all';

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="bg-black overflow-hidden outline-none"
      style={isCssFullscreen
        ? { position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, width: '100vw', height: '100vh', zIndex: 9999, touchAction: 'none' }
        : { position: 'relative', width: '100vw', height: '100vh', touchAction: 'none' }}
      onMouseMove={() => { if (hasStarted) flashControls(); }}
      onTouchStart={() => { if (hasStarted) flashControls(); }}
      onClick={() => containerRef.current?.focus({ preventScroll: true })}
    >
      {/* YouTube iframe mounts here */}
      <div
        ref={playerDivRef}
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, width: '100%', height: '100%', minHeight: 0 }}
      />

      {/* Tap-to-start overlay — covers iframe and hides YouTube logo until user taps */}
      {!hasStarted && (
        <div
          className="absolute inset-0 z-20 cursor-pointer flex items-center justify-center"
          style={{ background: 'rgba(0,0,0,0.45)' }}
          onClick={e => { e.stopPropagation(); startPlayback(); containerRef.current?.focus({ preventScroll: true }); }}
          onTouchEnd={e => { e.preventDefault(); startPlayback(); containerRef.current?.focus({ preventScroll: true }); }}
        >
          <div className="w-20 h-20 rounded-full bg-white/10 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl hover:bg-white/20 transition-all active:scale-95">
            <Play className="w-9 h-9 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Click catcher to block YouTube UI when playing */}
      {hasStarted && (
        <div
          className="absolute inset-0 z-10 cursor-pointer"
          onClick={e => {
            e.stopPropagation();
            flashControls();
            togglePlay();
            containerRef.current?.focus({ preventScroll: true });
          }}
        />
      )}


      {/* ERROR OVERLAY */}
      {ytError && (
        <div className="absolute inset-0 z-40 bg-black/95 flex flex-col items-center justify-center gap-6 px-8">
          <img src={logo} alt="Super TV" className="w-40 h-auto opacity-70 mb-2" />
          <div className="w-16 h-16 rounded-full bg-red-900/60 border border-red-500/40 flex items-center justify-center">
            <span className="text-red-400 text-3xl font-bold">!</span>
          </div>
          <div className="text-center space-y-2 max-w-sm">
            <p className="text-white font-semibold text-lg">Video no disponible</p>
            <p className="text-white/60 text-sm leading-relaxed">{ytError}</p>
          </div>
          <div className="flex flex-col items-center gap-3">
            <button
              onClick={onBack}
              className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white/10 hover:bg-white/20 border border-white/15 text-white text-sm font-medium transition-all active:scale-95"
            >
              <ArrowLeft className="w-4 h-4" />
              Volver
            </button>
            {onHideFromCatalog && (
              <button
                onClick={onHideFromCatalog}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-900/40 hover:bg-red-900/60 border border-red-500/30 text-red-300 text-sm font-medium transition-all active:scale-95"
              >
                Ocultar del catálogo
              </button>
            )}
          </div>
        </div>
      )}

      {/* Black bars — cover YouTube title/channel (top) and controls/logo (bottom) during load */}
      <div
        className="absolute top-0 inset-x-0 h-16 z-[14] bg-black pointer-events-none transition-opacity duration-700"
        style={{ opacity: coverBars ? 1 : 0 }}
      />
      <div
        className="absolute bottom-0 inset-x-0 h-16 z-[14] bg-black pointer-events-none transition-opacity duration-700"
        style={{ opacity: coverBars ? 1 : 0 }}
      />



      {/* Center paused icon */}
      {hasStarted && !isPlaying && !ytEnded && (
        <div className="absolute inset-0 z-[22] flex items-center justify-center pointer-events-none">
          <div className="w-20 h-20 rounded-full bg-black/60 backdrop-blur-md border border-white/20 flex items-center justify-center shadow-2xl">
            <Play className="w-9 h-9 text-white fill-white ml-1" />
          </div>
        </div>
      )}

      {/* Persistent fullscreen button — always visible when controls are hidden */}
      {!ctrlVisible && hasStarted && (
        <button
          onClick={e => { e.stopPropagation(); if (isFullscreen) { onBack(); } else { doToggleFullscreen(); } }}
          className="absolute bottom-4 right-4 z-40 p-3 rounded-full bg-black/50 text-white backdrop-blur hover:bg-black/80 transition-all shadow-lg"
          title={isFullscreen ? 'Cerrar' : 'Pantalla completa'}
        >
          {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
        </button>
      )}

      {/* CUSTOM CONTROLS */}
      <div
        className={`absolute inset-0 z-30 pointer-events-none transition-opacity duration-300 ${ctrlVisible ? 'opacity-100' : 'opacity-0'}`}
      >
        {/* Top gradient + back button + fav */}
        <div className="absolute top-0 inset-x-0 h-28 bg-gradient-to-b from-black/80 via-black/30 to-transparent" />
        <div className={`absolute top-0 inset-x-0 flex items-center gap-3 px-4 pt-4 ${ctrlVisible ? 'pointer-events-auto' : ''}`}>
          <button
            onClick={e => { e.stopPropagation(); onBack(); }}
            className={`flex items-center gap-2 text-white/90 hover:text-white transition-colors rounded-lg px-1 py-1 ${ytControls[ctrlFocusIdx] === 'back' ? 'ring-2 ring-white scale-105 bg-white/10' : ''}`}
          >
            <ArrowLeft className="w-5 h-5" />
            <span className="text-sm font-medium truncate max-w-[160px] sm:max-w-sm">{title}</span>
          </button>
          {onFavToggle !== undefined && (
            <button
              onClick={e => { e.stopPropagation(); onFavToggle(); }}
              className={`ml-auto w-10 h-10 rounded-xl bg-black/50 backdrop-blur border border-white/15 flex items-center justify-center active:scale-95 transition-all ${isFav ? 'text-red-400 !border-red-400/40 !bg-red-500/20' : 'text-white'} ${ytControls[ctrlFocusIdx] === 'fav' ? 'ring-2 ring-white scale-110' : ''}`}
            >
              <Heart className={`w-5 h-5 ${isFav ? 'fill-red-400' : ''}`} />
            </button>
          )}
        </div>

        {/* Bottom gradient + seek bar + buttons */}
        <div
          className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent px-4 pt-10 space-y-2 ${ctrlVisible ? 'pointer-events-auto' : ''}`}
          style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
        >
          {/* Seek bar + time */}
          <div className="space-y-1.5">
            <div
              className="w-full h-3 flex items-center cursor-pointer group"
              onClick={e => {
                e.stopPropagation();
                handleSeekClick(e.clientX, e.currentTarget.getBoundingClientRect());
              }}
              onTouchEnd={e => {
                e.stopPropagation();
                const touch = e.changedTouches[0];
                handleSeekClick(touch.clientX, e.currentTarget.getBoundingClientRect());
              }}
            >
              <div className="w-full h-1.5 group-hover:h-2.5 bg-white/25 rounded-full relative transition-all duration-150">
                <div
                  className="h-full bg-red-500 rounded-full relative"
                  style={{ width: `${progress}%` }}
                >
                  <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 w-4 h-4 bg-white rounded-full shadow-md opacity-0 group-hover:opacity-100 transition-opacity" />
                </div>
              </div>
            </div>
            <div className="flex justify-between text-[11px] text-white/60 select-none">
              <span>{formatTime(currentTime)}</span>
              <span>{formatTime(duration)}</span>
            </div>
          </div>

          {/* Playback row */}
          <div className="flex items-center justify-between pb-1">
            <button
              onClick={e => { e.stopPropagation(); skip(-10); containerRef.current?.focus({ preventScroll: true }); }}
              className={`${ctrlBtn} ${ytControls[ctrlFocusIdx] === 'skip-10' ? 'ring-2 ring-white scale-110 bg-white/20' : ''}`}
              title="-10s"
            >
              <SkipBack className="w-5 h-5" />
            </button>

            <button
              onClick={e => { e.stopPropagation(); togglePlay(); containerRef.current?.focus({ preventScroll: true }); }}
              className={`w-14 h-14 rounded-full bg-red-600 text-white flex items-center justify-center shadow-lg active:scale-95 transition-all hover:bg-red-500 ${ytControls[ctrlFocusIdx] === 'play' ? 'ring-4 ring-white scale-110' : ''}`}
            >
              {isPlaying
                ? <Pause className="w-7 h-7 fill-white" />
                : <Play className="w-7 h-7 fill-white ml-0.5" />}
            </button>

            <button
              onClick={e => { e.stopPropagation(); skip(10); containerRef.current?.focus({ preventScroll: true }); }}
              className={`${ctrlBtn} ${ytControls[ctrlFocusIdx] === 'skip+10' ? 'ring-2 ring-white scale-110 bg-white/20' : ''}`}
              title="+10s"
            >
              <SkipForward className="w-5 h-5" />
            </button>

            {onNextEpisode && nextEpisodeId && (
              <button
                onClick={e => { e.stopPropagation(); onNextEpisode(); }}
                className={`flex items-center gap-1.5 px-3 py-2.5 rounded-xl text-xs font-semibold transition-all ${showNextEp ? 'bg-red-600 text-white ring-2 ring-red-400/60 hover:bg-red-500' : 'bg-black/50 backdrop-blur border border-white/15 text-white hover:bg-red-600/80'}`}
                title="Siguiente episodio"
              >
                <ChevronRight className="w-4 h-4" />
                <span className="hidden sm:inline">Siguiente</span>
              </button>
            )}

            <button
              onClick={e => { e.stopPropagation(); if (isFullscreen) { onBack(); } else { doToggleFullscreen(); } containerRef.current?.focus({ preventScroll: true }); }}
              className={`${ctrlBtn} ${ytControls[ctrlFocusIdx] === 'fullscreen' ? 'ring-2 ring-white scale-110 bg-white/20' : ''}`}
              title={isFullscreen ? 'Cerrar' : 'Pantalla completa'}
            >
              {isFullscreen ? <Minimize2 className="w-5 h-5" /> : <Maximize2 className="w-5 h-5" />}
            </button>
          </div>

          {/* D-pad hint */}
          {ctrlFocusIdx >= 0 && (
            <p className="text-center text-[10px] text-white/30 pb-1 select-none">
              ◄► Navegar · Enter Seleccionar · ↑ Pantalla completa · ↓ Minimizar
            </p>
          )}
        </div>
      </div>

      {/* Next episode overlay — only visible in the last 30 seconds */}
      {onNextEpisode && nextEpisodeId && showNextEp && (
        <div
          className="absolute bottom-28 right-4 z-40 backdrop-blur rounded-xl px-4 py-3 flex items-center gap-3 shadow-2xl transition-all duration-300 bg-black/90 border border-white/30 animate-pulse"
          onClick={e => e.stopPropagation()}
        >
          <div className="text-sm text-white leading-snug">
            <div className={`text-[11px] mb-0.5 ${showNextEp ? 'text-red-400 font-medium' : 'text-white/40'}`}>
              {showNextEp ? '⏭ Siguiente capítulo' : 'Siguiente capítulo'}
            </div>
            <div className="font-semibold truncate max-w-[180px]">{nextEpisodeTitle || `Capítulo ${nextEpisodeNumber}`}</div>
            {(nextSeasonNumber || nextEpisodeNumber) && (
              <div className="text-white/40 text-[10px] mt-0.5">
                {nextSeasonNumber ? `T${nextSeasonNumber}` : ''}{nextEpisodeNumber ? `E${nextEpisodeNumber}` : ''}
              </div>
            )}
          </div>
          <button
            onClick={e => { e.stopPropagation(); onNextEpisode(); }}
            className={`flex items-center gap-1 px-3 py-2 rounded-lg text-xs font-semibold active:scale-95 transition-all whitespace-nowrap flex-shrink-0 ${
              showNextEp
                ? 'bg-red-600 text-white hover:bg-red-500'
                : 'bg-white/15 text-white hover:bg-red-600/80'
            }`}
          >
            Siguiente <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* End-screen overlay */}
      {ytEnded && (
        <div
          className="absolute inset-0 z-40 bg-black/80 flex flex-col items-center justify-center gap-5"
          onClick={e => e.stopPropagation()}
        >
          <p className="text-white/80 text-lg font-semibold">Capítulo terminado</p>
          <div className="flex gap-3 flex-wrap justify-center">
            {onNextEpisode && nextEpisodeId && (
              <button
                onClick={e => { e.stopPropagation(); onNextEpisode(); }}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl bg-red-600 text-white font-semibold text-sm hover:bg-red-500 active:scale-95 transition-all ring-2 ring-red-400/60"
              >
                Siguiente capítulo <ChevronRight className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={e => {
                e.stopPropagation();
                ytPlayerRef.current?.seekTo(0, true);
                ytPlayerRef.current?.playVideo();
                setHasStarted(true);
                setYtEnded(false);
                setShowNextEp(false);
              }}
              className={`px-5 py-2.5 rounded-xl border text-sm font-medium transition-all ${endBtnIndex === 0 ? 'bg-white/30 border-white text-white ring-2 ring-white scale-105' : 'bg-white/15 border-white/20 text-white hover:bg-white/25'}`}
            >
              Volver a ver
            </button>
            <button
              onClick={e => { e.stopPropagation(); onBack(); }}
              className={`px-5 py-2.5 rounded-xl text-white font-semibold text-sm transition-all ${endBtnIndex === 1 ? 'bg-white/25 ring-2 ring-white scale-105' : 'bg-white/10 hover:bg-white/20'}`}
            >
              Cerrar
            </button>
          </div>
          <p className="text-white/30 text-xs">← → para navegar · Enter para seleccionar</p>
        </div>
      )}
    </div>
  );
}
