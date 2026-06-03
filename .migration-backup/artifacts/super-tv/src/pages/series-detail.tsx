import { useLocation, useRoute } from 'wouter';
import { normalizeKey } from '@/lib/tv-remote';
import { useEffect, useState, useMemo, useRef } from 'react';
import { Play, ArrowLeft, Heart, ChevronDown, ChevronUp, Tv2, Lock, X, Clock, Film } from 'lucide-react';
import { useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { clearTokens } from '@/lib/auth';
import { fetchSeriesDetail } from '@/lib/api';
import type { SeriesDetail, Season, Episode } from '@/lib/api';
import { getEpisodeProgress, getSeriesProgress, toggleSeriesFavorite, getSeriesFavorites } from '@/lib/user-data';
import logo from '@assets/logo_supertv.png';
import { YouTubePlayerPage } from '@/components/YouTubePlayerPage';

function extractYtId(url: string): string | null {
  const m = url?.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s?#]+)/);
  return m ? m[1] : null;
}

type YtEpisodePlayer = {
  videoId: string;
  title: string;
  episodeId: number;
  seriesId: number;
  seasonId: number;
  seasonNumber: number;
  episodeNumber: number;
  startFrom?: number;
  nextEp: { ep: Episode; season: Season } | null;
};

function fmtDuration(secs: number): string {
  const m = Math.floor(secs / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

function fmtProgress(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

type SdZone = 'buttons' | 'seasons' | 'episodes';

export default function SeriesDetail() {
  const [location, setLocation] = useLocation();
  const [, params] = useRoute('/serie/:id');
  const id = Number(params?.id);
  const autoplay = new URLSearchParams(location.split('?')[1] ?? '').get('autoplay') === '1';

  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeSeason, setActiveSeason] = useState<number>(0);
  const [isFav, setIsFav] = useState(false);
  const [showExpiredOverlay, setShowExpiredOverlay] = useState(true);

  const [sdZone, setSdZone] = useState<SdZone>('buttons');
  const [btnIdx, setBtnIdx] = useState(0);
  const [epIdx, setEpIdx] = useState(0);
  const focusedEpRef = useRef<HTMLDivElement | null>(null);
  const [ytPlayer, setYtPlayer] = useState<YtEpisodePlayer | null>(null);

  const { data: session, isError: sessionError } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false } });

  useEffect(() => {
    if (sessionError) { clearTokens(); setLocation('/'); }
  }, [sessionError, setLocation]);

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    fetchSeriesDetail(id)
      .then(s => { setSeries(s); setLoading(false); })
      .catch(() => { setLoading(false); });
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setIsFav(getSeriesFavorites().includes(id));
  }, [id]);

  // Auto-play last-watched episode when coming from "Seguir viendo"
  useEffect(() => {
    if (!autoplay || !series || loading) return;
    const progress = getSeriesProgress(id);
    if (!progress?.time || !progress.seasonId || !progress.episodeId) return;
    const season = series.seasons.find(s => s.id === progress.seasonId);
    const episode = season?.episodes.find(e => e.id === progress.episodeId);
    if (season && episode) handlePlayEpisode(episode, season, progress.time);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoplay, series, loading]);

  useEffect(() => {
    if (sdZone === 'episodes' && focusedEpRef.current) {
      focusedEpRef.current.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
    }
  }, [sdZone, epIdx]);

  const daysLeft = (() => {
    if (!session?.expiresAt) return null;
    return Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  })();
  const isExpired = session?.type === 'user' && daysLeft !== null && daysLeft <= 0;

  const seriesProgress = useMemo(() => series ? getSeriesProgress(id) : null, [series, id]);
  const currentSeason = series?.seasons?.[activeSeason];
  const episodes = currentSeason?.episodes ?? [];

  const hasPlayBtn = !!(seriesProgress?.time && seriesProgress.time > 10) || !!(series?.seasons[0]?.episodes[0]);
  const numBtns = (hasPlayBtn ? 1 : 0) + 1;

  const handlePlayEpisode = (episode: Episode, season: Season, startFrom?: number) => {
    if (isExpired) { setShowExpiredOverlay(true); return; }
    const url = episode.filePath ?? '';
    const isYouTube = url.includes('youtube.com/') || url.includes('youtu.be/');
    if (isYouTube) {
      const videoId = extractYtId(url);
      if (videoId) {
        const nextEp = getNextEpisode(season, episode, series!);
        setYtPlayer({
          videoId,
          title: episode.title,
          episodeId: episode.id,
          seriesId: id,
          seasonId: season.id,
          seasonNumber: season.seasonNumber,
          episodeNumber: episode.episodeNumber,
          startFrom,
          nextEp: nextEp && extractYtId(nextEp.ep.filePath ?? '') ? nextEp : null,
        });
        return;
      }
    }
    const p = new URLSearchParams({
      url,
      title: episode.title,
      type: 'episode',
      episodeId: String(episode.id),
      seriesId: String(id),
      seasonId: String(season.id),
      seasonNumber: String(season.seasonNumber),
      episodeNumber: String(episode.episodeNumber),
      seriesTitle: series?.title || '',
    });
    if ((episode as any).videoFormat) p.set('format', (episode as any).videoFormat);
    if (startFrom !== undefined) p.set('startFrom', String(startFrom));
    const nextEp = getNextEpisode(season, episode, series!);
    if (nextEp) {
      p.set('nextEpisodeId', String(nextEp.ep.id));
      p.set('nextSeasonId', String(nextEp.season.id));
      p.set('nextEpisodeTitle', nextEp.ep.title);
      p.set('nextEpisodeUrl', nextEp.ep.filePath);
      p.set('nextSeasonNumber', String(nextEp.season.seasonNumber));
      p.set('nextEpisodeNumber', String(nextEp.ep.episodeNumber));
      if ((nextEp.ep as any).videoFormat) p.set('nextEpisodeFormat', (nextEp.ep as any).videoFormat);
    }
    setLocation(`/vod-player?${p.toString()}`);
  };

  const handleContinueFromProgress = () => {
    if (!seriesProgress || !series) return;
    const season = series.seasons.find(s => s.id === seriesProgress.seasonId);
    const episode = season?.episodes.find(e => e.id === seriesProgress.episodeId);
    if (season && episode) handlePlayEpisode(episode, season, seriesProgress.time);
  };

  const handleToggleFav = () => {
    const added = toggleSeriesFavorite(id);
    setIsFav(added);
  };

  useEffect(() => {
    if (!series) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (sdZone === 'buttons') {
        switch (normalizeKey(e)) {
          case 'ArrowLeft':
            e.preventDefault();
            if (btnIdx > 0) setBtnIdx(p => p - 1);
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (btnIdx < numBtns - 1) setBtnIdx(p => p + 1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (series.seasons.length > 1) { setSdZone('seasons'); }
            else { setSdZone('episodes'); setEpIdx(0); }
            break;
          case 'ArrowUp':
            e.preventDefault();
            break;
          case 'MediaPlayPause':
          case 'Enter':
            e.preventDefault();
            if (btnIdx === 0 && hasPlayBtn) {
              if (seriesProgress?.time && seriesProgress.time > 10) handleContinueFromProgress();
              else if (series.seasons[0]?.episodes[0]) handlePlayEpisode(series.seasons[0].episodes[0], series.seasons[0]);
            } else {
              handleToggleFav();
            }
            break;
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            setLocation('/home?tab=series');
            break;
        }

      } else if (sdZone === 'seasons') {
        switch (normalizeKey(e)) {
          case 'ArrowLeft':
            e.preventDefault();
            if (activeSeason > 0) setActiveSeason(p => p - 1);
            else setSdZone('buttons');
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (activeSeason < series.seasons.length - 1) setActiveSeason(p => p + 1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            setSdZone('episodes'); setEpIdx(0);
            break;
          case 'ArrowUp':
            e.preventDefault();
            setSdZone('buttons');
            break;
          case 'MediaPlayPause':
          case 'Enter':
            e.preventDefault();
            setSdZone('episodes'); setEpIdx(0);
            break;
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            setSdZone('buttons');
            break;
        }

      } else {
        // episodes zone
        switch (normalizeKey(e)) {
          case 'ArrowDown':
            e.preventDefault();
            if (epIdx < episodes.length - 1) setEpIdx(p => p + 1);
            break;
          case 'ArrowUp':
            e.preventDefault();
            if (epIdx > 0) setEpIdx(p => p - 1);
            else { if (series.seasons.length > 1) setSdZone('seasons'); else setSdZone('buttons'); }
            break;
          case 'MediaPlayPause':
          case 'Enter': {
            e.preventDefault();
            const ep = episodes[epIdx];
            if (ep) {
              const prog = getEpisodeProgress(ep.id);
              handlePlayEpisode(ep, currentSeason!, prog?.time);
            }
            break;
          }
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            if (series.seasons.length > 1) setSdZone('seasons');
            else setSdZone('buttons');
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sdZone, btnIdx, epIdx, activeSeason, currentSeason, episodes, series, seriesProgress, isExpired, hasPlayBtn, numBtns, isFav]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!series) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center gap-4 px-4">
        <Tv2 className="w-16 h-16 text-muted-foreground/30" />
        <p className="text-muted-foreground">Serie no encontrada</p>
        <button onClick={() => setLocation('/home?tab=series')} className="text-primary hover:underline text-sm">Volver</button>
      </div>
    );
  }

  const bgImage = series.banner || series.poster;
  const playBtnFocused = sdZone === 'buttons' && btnIdx === 0 && hasPlayBtn;
  const favBtnFocused = sdZone === 'buttons' && (hasPlayBtn ? btnIdx === 1 : btnIdx === 0);

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col select-none">
      <header className="sticky top-0 z-50 bg-background/95 backdrop-blur border-b border-border px-3 sm:px-4 py-2 sm:py-3 flex items-center gap-3">
        <button
          onClick={() => setLocation('/home?tab=series')}
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-sm flex-shrink-0"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">Volver</span>
        </button>
        <img src={logo} alt="Super TV" className="h-7 sm:h-8 w-auto" />
      </header>

      <div className="relative w-full" style={{ aspectRatio: '16/7', maxHeight: '420px' }}>
        {bgImage ? (
          <img src={bgImage} alt={series.title} className="w-full h-full object-cover" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-900 to-slate-800" />
        )}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-transparent to-black/20" />
        <div className="absolute bottom-0 left-0 p-4 sm:p-8 max-w-xl space-y-1 sm:space-y-2">
          <div className="flex gap-2 text-xs text-white/60">
            {series.genre && <span>{series.genre}</span>}
            {series.year && <span>{series.year}</span>}
            <span className="px-1.5 py-0.5 bg-primary/80 rounded text-white text-[10px] font-bold uppercase">Serie</span>
          </div>
          <h1 className="text-2xl sm:text-4xl font-extrabold text-white drop-shadow-lg line-clamp-2">{series.title}</h1>
        </div>
      </div>

      <main className="flex-1 max-w-5xl mx-auto w-full px-4 py-6 space-y-8">
        <div className="flex flex-col sm:flex-row gap-6">
          {series.poster && (
            <div className="flex-shrink-0 mx-auto sm:mx-0 w-36 sm:w-44 rounded-xl overflow-hidden shadow-2xl border border-border aspect-[2/3] hidden sm:block">
              <img src={series.poster} alt={series.title} className="w-full h-full object-cover" />
            </div>
          )}
          <div className="flex-1 space-y-4">
            {series.description && (
              <p className="text-sm sm:text-base text-muted-foreground leading-relaxed">{series.description}</p>
            )}
            <div className="flex flex-wrap gap-2">
              {series.category && (
                <span className="px-3 py-1 bg-primary/10 text-primary rounded-full text-xs font-medium border border-primary/20">{series.category}</span>
              )}
              {series.seasons.length > 0 && (
                <span className="px-3 py-1 bg-secondary rounded-full text-xs text-muted-foreground">{series.seasons.length} temporada{series.seasons.length !== 1 ? 's' : ''}</span>
              )}
              {series.seasons.reduce((acc, s) => acc + s.episodes.length, 0) > 0 && (
                <span className="px-3 py-1 bg-secondary rounded-full text-xs text-muted-foreground">{series.seasons.reduce((acc, s) => acc + s.episodes.length, 0)} episodios</span>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {seriesProgress && seriesProgress.time > 10 ? (
                <button
                  onClick={handleContinueFromProgress}
                  className={`flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-lg font-bold text-sm hover:bg-white/90 transition-all active:scale-95 shadow-lg ${playBtnFocused ? 'ring-4 ring-primary scale-105 shadow-[0_0_20px_rgba(220,38,38,0.5)]' : ''}`}
                >
                  {isExpired ? <Lock className="w-4 h-4" /> : <Play className="w-4 h-4 fill-black" />}
                  {isExpired ? 'Acceso vencido' : `Continuar T${seriesProgress.seasonNumber} E${seriesProgress.episodeNumber}`}
                </button>
              ) : series.seasons[0]?.episodes[0] && (
                <button
                  onClick={() => handlePlayEpisode(series.seasons[0].episodes[0], series.seasons[0])}
                  className={`flex items-center gap-2 px-6 py-2.5 bg-white text-black rounded-lg font-bold text-sm hover:bg-white/90 transition-all active:scale-95 shadow-lg ${playBtnFocused ? 'ring-4 ring-primary scale-105 shadow-[0_0_20px_rgba(220,38,38,0.5)]' : ''}`}
                >
                  {isExpired ? <Lock className="w-4 h-4" /> : <Play className="w-4 h-4 fill-black" />}
                  {isExpired ? 'Acceso vencido' : 'Reproducir'}
                </button>
              )}
              <button
                onClick={handleToggleFav}
                className={`flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-sm transition-all active:scale-95 border ${isFav ? 'bg-red-500/10 border-red-500/40 text-red-400 hover:bg-red-500/20' : 'bg-secondary border-border text-muted-foreground hover:text-foreground'} ${favBtnFocused ? 'ring-4 ring-primary scale-105' : ''}`}
              >
                <Heart className={`w-4 h-4 ${isFav ? 'fill-red-400 text-red-400' : ''}`} />
                {isFav ? 'En favoritos' : 'Favorito'}
              </button>
            </div>

            {sdZone === 'buttons' && (
              <p className="text-muted-foreground/40 text-xs">◀▶ Navegar botones · ▼ Temporadas/Episodios · Enter Seleccionar</p>
            )}
          </div>
        </div>

        {isExpired && showExpiredOverlay && (
          <div className="relative flex items-start gap-3 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3">
            <Lock className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
            <p className="text-sm text-destructive flex-1">Tu código venció. Contacta a tu proveedor para activarlo.</p>
            <button onClick={() => setShowExpiredOverlay(false)} className="text-destructive/60 hover:text-destructive"><X className="w-4 h-4" /></button>
          </div>
        )}

        {series.seasons.length > 0 && (
          <section className="space-y-4">
            <div className="flex items-center gap-2 flex-wrap">
              {series.seasons.map((season, si) => (
                <button
                  key={season.id}
                  onClick={() => { setActiveSeason(si); setSdZone('episodes'); setEpIdx(0); }}
                  className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all ${activeSeason === si ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground hover:text-foreground'} ${sdZone === 'seasons' && activeSeason === si ? 'ring-4 ring-primary scale-105 shadow-[0_0_15px_rgba(220,38,38,0.4)]' : ''}`}
                >
                  {season.title || `Temporada ${season.seasonNumber}`}
                  <span className="ml-1.5 text-xs opacity-60">({season.episodes.length})</span>
                </button>
              ))}
            </div>

            {sdZone === 'seasons' && (
              <p className="text-muted-foreground/40 text-xs">◀▶ Cambiar temporada · ▼ Episodios · ▲ Volver</p>
            )}

            {currentSeason && (
              <div className="space-y-2">
                {sdZone === 'episodes' && (
                  <p className="text-muted-foreground/40 text-xs">▲▼ Navegar episodios · Enter Reproducir · Esc Volver</p>
                )}
                {currentSeason.episodes.map((ep, ei) => {
                  const prog = getEpisodeProgress(ep.id);
                  const progPct = prog && prog.duration > 0 ? Math.min(100, (prog.time / prog.duration) * 100) : 0;
                  const isFocusedEp = sdZone === 'episodes' && epIdx === ei;
                  return (
                    <div
                      key={ep.id}
                      ref={isFocusedEp ? (el) => { focusedEpRef.current = el; } : undefined}
                      onClick={() => handlePlayEpisode(ep, currentSeason, prog?.time)}
                      className={`flex items-center gap-3 p-3 rounded-xl bg-card border cursor-pointer transition-all group ${isFocusedEp ? 'border-primary bg-primary/5 ring-2 ring-primary shadow-[0_0_15px_rgba(220,38,38,0.3)] scale-[1.01]' : 'border-border hover:border-primary/40 hover:bg-card/80'}`}
                    >
                      <div className="flex-shrink-0 w-20 sm:w-28 aspect-video bg-muted rounded-lg overflow-hidden relative">
                        {ep.thumbnail ? (
                          <img src={ep.thumbnail} alt={ep.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <Film className="w-6 h-6 text-muted-foreground/30" />
                          </div>
                        )}
                        <div className={`absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity ${isFocusedEp ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                          <Play className="w-6 h-6 text-white fill-white" />
                        </div>
                        {progPct > 0 && (
                          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                            <div className="h-full bg-primary" style={{ width: `${progPct}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground flex-shrink-0">E{ep.episodeNumber}</span>
                          <h3 className="font-medium text-sm truncate">{ep.title}</h3>
                        </div>
                        {ep.description && <p className="text-xs text-muted-foreground line-clamp-1 sm:line-clamp-2 mt-0.5">{ep.description}</p>}
                        <div className="flex items-center gap-3 mt-1">
                          {ep.duration && <span className="text-xs text-muted-foreground flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDuration(ep.duration)}</span>}
                          {prog && prog.time > 10 && <span className="text-xs text-primary">Visto hasta {fmtProgress(prog.time)}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
                {currentSeason.episodes.length === 0 && (
                  <p className="text-muted-foreground text-sm text-center py-8">No hay episodios en esta temporada</p>
                )}
              </div>
            )}
          </section>
        )}

        {series.seasons.length === 0 && (
          <div className="text-center py-12">
            <Tv2 className="w-12 h-12 text-muted-foreground/30 mx-auto mb-3" />
            <p className="text-muted-foreground text-sm">Aún no hay episodios disponibles</p>
          </div>
        )}
      </main>

      {ytPlayer && (
        <YouTubePlayerPage
          videoId={ytPlayer.videoId}
          title={ytPlayer.title}
          onBack={() => setYtPlayer(null)}
          episodeId={ytPlayer.episodeId}
          seriesId={ytPlayer.seriesId}
          seasonId={ytPlayer.seasonId}
          seasonNumber={ytPlayer.seasonNumber}
          episodeNumber={ytPlayer.episodeNumber}
          startFrom={ytPlayer.startFrom}
          seriesTitle={series?.title}
          nextEpisodeId={ytPlayer.nextEp?.ep.id}
          nextEpisodeTitle={ytPlayer.nextEp?.ep.title}
          nextEpisodeNumber={ytPlayer.nextEp?.ep.episodeNumber}
          nextSeasonNumber={ytPlayer.nextEp?.season.seasonNumber}
          onNextEpisode={ytPlayer.nextEp ? () => {
            const { ep, season } = ytPlayer.nextEp!;
            handlePlayEpisode(ep, season);
          } : undefined}
        />
      )}
    </div>
  );
}

function getNextEpisode(currentSeason: Season, currentEpisode: Episode, series: SeriesDetail): { ep: Episode; season: Season } | null {
  const epIdx = currentSeason.episodes.findIndex(e => e.id === currentEpisode.id);
  if (epIdx >= 0 && epIdx < currentSeason.episodes.length - 1) {
    return { ep: currentSeason.episodes[epIdx + 1], season: currentSeason };
  }
  const seasonIdx = series.seasons.findIndex(s => s.id === currentSeason.id);
  if (seasonIdx >= 0 && seasonIdx < series.seasons.length - 1) {
    const nextSeason = series.seasons[seasonIdx + 1];
    if (nextSeason.episodes.length > 0) return { ep: nextSeason.episodes[0], season: nextSeason };
  }
  return null;
}
