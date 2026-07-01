import { use  
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
      setTimeout(() => window.dispatchEvent(new Event('supertv:mini-enter-pip')), 400);
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

  const controls = useMemo(() => ['back', ...(hasChannels ? ['prevch'] : []), 'skipback', 'play', 'skipfwd', ...(hasChannels ? ['nextch'] : []), 'mute', 'minimize', 'cast', 'pip', 'fullscreen'], [hasChannels]);

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
            case 'minimize': handleMinimize(); break;
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
          <p className="text-white/60 max-w-xs">Tu cÃÂÃÂÃÂÃÂ³digo venciÃÂÃÂÃÂÃÂ³. Para renovarlo, contacta a tu proveedor para activarlo.</p>
        </div>
        <button onClick={() => setLocation('/home')} className="text-sm text-white/50 hover:text-white transition-colors underline underline-offset-4">
          Volver al inicio
        </button>
      </div>
    );
  }

  if (currentFormat === 'youtube' || detectFormat(currentUrl) === 'youtube') {
    const ytId = extractYouTubeId(currentUrl);
    if (!ytId) return <div className="flex items-center justify-center h-[100dvh] bg-black text-white/60 text-sm">URL de YouTube invÃÂÃÂÃÂÃÂ¡lida</div>;

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
            <span className="text-white/70 text-sm tracking-wide">CargandoÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¦</span>
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
                <p className="text-white/20 text-[10px]">Toca ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¸ abajo para pausar</p>
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
            <span className="text-orange-200">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ </span>
            <div>
              <div className="font-semibold">Canal eliminado</div>
              <div className="text-xs text-orange-100">SeguirÃÂÃÂÃÂÃÂ¡s viendo durante {minsLeft > 1 ? `${minsLeft} minutos mÃÂÃÂÃÂÃÂ¡s` : 'menos de 1 minuto'}. Luego volverÃÂÃÂÃÂÃÂ¡s a los canales.</div>
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
                {isLive && <span className="px-2 py-0.5 bg-red-600 text-white text-[9px] sm:text-[10px] rounded uppercase tracking-wider font-bold">ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ EN VIVO</span>}
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


            {type === 'channel' && (
              <button
                onClick={handleMinimize}
                className={`p-2.5 sm:p-3 rounded-full bg-black/40 text-white backdrop-blur transition-all ${ctrlIndex === controls.indexOf('minimize') ? 'ring-2 ring-primary scale-110' : 'hover:bg-black/60'}`}
                title="Minimizar"
              >
                <Minimize2 className="w-4 h-4 sm:w-5 sm:h-5" />
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
              ? 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ² Canal siguiente ÃÂÃÂÃÂÃÂ· ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¼ Canal anterior ÃÂÃÂÃÂÃÂ· ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂº Controles ÃÂÃÂÃÂÃÂ· Esc Minimizar'
              : isLive
                ? 'ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ²ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¼ Volumen ÃÂÃÂÃÂÃÂ· ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂº Controles ÃÂÃÂÃÂÃÂ· Esc Salir'
                : 'Espacio Reproducir ÃÂÃÂÃÂÃÂ· ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ²ÃÂÃÂ¢ÃÂÃÂÃÂÃÂ¼ Volumen ÃÂÃÂÃÂÃÂ· Shift+ÃÂÃÂ¢ÃÂÃÂÃÂÃÂÃÂÃÂ¢ÃÂÃÂÃÂÃÂº Saltar 30s ÃÂÃÂÃÂÃÂ· F Pantalla completa'}
          </p>
        </div>
      </div>
    </div>
  );
}
