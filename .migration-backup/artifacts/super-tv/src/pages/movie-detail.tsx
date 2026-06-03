import { useLocation, useRoute } from 'wouter';
import { normalizeKey } from '@/lib/tv-remote';
import { useListMovies, getListMoviesQueryKey, useGetMe, getGetMeQueryKey } from '@workspace/api-client-react';
import { apiBase } from '@/lib/api';
import { Play, ArrowLeft, Film, Tag, Search, X, Lock, Heart, Info } from 'lucide-react';
import { getProgress, toggleFavorite, getFavorites, toggleExternalFavorite, isExternalFavorite, addExternalHistory, type ExternalItem } from '@/lib/user-data';
import { clearTokens, getToken } from '@/lib/auth';
import { useEffect, useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import logo from '@assets/logo_supertv.png';
import { ContentCard, extractYouTubeId } from '@/components/ContentCard';
import { useTvKeyboard } from '@/hooks/use-tv-keyboard';

function formatProgress(secs: number): string {
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getMovieGridCols(): number {
  const w = window.innerWidth;
  if (w >= 1280) return 6;
  if (w >= 1024) return 5;
  if (w >= 768) return 4;
  if (w >= 640) return 3;
  return 2;
}

type MvZone = 'buttons' | 'catpills' | 'search' | 'grid';

type YtResult = { videoId: string; title: string; thumbnail: string; channel: string; year?: string; duration: string };
type ArchiveResult = { identifier: string; title: string; year?: string; creator?: string; thumbnail: string };

interface GridMovie {
  id: number;
  title: string;
  poster?: string | null;
  filePath?: string | null;
  category?: string | null;
  year?: number | null;
  genre?: string | null;
}

const GRID_EXPAND = 1.35;

function MovieGridCard({
  mv,
  isFocused,
  cardRef,
  onClick,
}: {
  mv: GridMovie;
  isFocused: boolean;
  cardRef?: (el: HTMLDivElement | null) => void;
  onClick: () => void;
}) {
  const [previewActive, setPreviewActive] = useState(false);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringRef = useRef(false);
  const innerRef = useRef<HTMLDivElement | null>(null);

  const ytId = mv.filePath ? extractYouTubeId(mv.filePath) : null;
  const isDirectVideo = !!(mv.filePath && !ytId);
  const canPreview = !!(ytId || isDirectVideo);

  const ytSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=1&mute=0&controls=0&loop=1&playlist=${ytId}&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&playsinline=1`
    : null;

  const startTimer = () => {
    if (!canPreview) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isHoveringRef.current) return;
      if (innerRef.current) setCardRect(innerRef.current.getBoundingClientRect());
      setPreviewActive(true);
    }, 1500);
  };

  const stopPreview = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPreviewActive(false);
    setCardRect(null);
  };

  useEffect(() => {
    if (isFocused) { isHoveringRef.current = true; startTimer(); }
    else { isHoveringRef.current = false; stopPreview(); }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  const handleMouseEnter = () => { isHoveringRef.current = true; startTimer(); };
  const handleMouseLeave = () => {
    isHoveringRef.current = false;
    if (!previewActive) stopPreview();
  };
  const handlePortalLeave = () => { isHoveringRef.current = false; stopPreview(); };

  const handleTouchStart = () => { isHoveringRef.current = true; startTimer(); };
  const handleTouchEnd = () => { isHoveringRef.current = false; if (!previewActive) stopPreview(); };
  const handleTouchCancel = () => { isHoveringRef.current = false; stopPreview(); };

  const previewPortal = previewActive && cardRect ? createPortal(
    <div
      className="fixed rounded-xl overflow-hidden cursor-pointer"
      style={{
        zIndex: 9999,
        top: cardRect.top - cardRect.height * (GRID_EXPAND - 1) / 2,
        left: cardRect.left - cardRect.width * (GRID_EXPAND - 1) / 2,
        width: cardRect.width * GRID_EXPAND,
        height: cardRect.height * GRID_EXPAND,
        boxShadow: '0 24px 80px rgba(0,0,0,0.95)',
        animation: 'fadeIn 0.35s ease-out',
      }}
      onMouseLeave={handlePortalLeave}
      onClick={() => { stopPreview(); onClick(); }}
    >
      {ytSrc ? (
        <iframe
          key={ytSrc}
          src={ytSrc}
          className="absolute pointer-events-none"
          style={{ width: '170%', height: '170%', top: '-35%', left: '-35%' }}
          allow="autoplay; encrypted-media"
          allowFullScreen={false}
          frameBorder="0"
          title={mv.title}
        />
      ) : mv.filePath ? (
        <video src={mv.filePath} autoPlay loop playsInline className="w-full h-full object-cover" onError={() => setPreviewActive(false)} />
      ) : null}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-transparent to-transparent pointer-events-none" />
      <div className="absolute bottom-2 left-3 right-3 pointer-events-none">
        <p className="text-white text-xs font-semibold leading-tight line-clamp-2 drop-shadow-lg">{mv.title}</p>
      </div>
    </div>,
    document.body,
  ) : null;

  return (
    <>
      <div
        ref={(el) => { innerRef.current = el; cardRef?.(el); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
        onClick={() => { stopPreview(); onClick(); }}
        className={`group flex flex-col rounded-xl overflow-hidden cursor-pointer transition-all duration-200 ${
          isFocused
            ? 'ring-4 ring-primary scale-105 shadow-[0_0_20px_rgba(220,38,38,0.5)] z-10'
            : 'hover:scale-105 hover:ring-1 hover:ring-white/20'
        }`}
      >
        <div className="aspect-video bg-white/5 relative flex items-center justify-center overflow-hidden rounded-xl">
          {mv.poster ? (
            <img
              src={mv.poster}
              alt={mv.title}
              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <Film className="w-8 h-8 text-white/15" />
          )}
          <div className={`absolute inset-0 bg-black/50 flex items-center justify-center transition-opacity ${isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
            <div className="p-2.5 rounded-full bg-white/20 backdrop-blur-sm border border-white/20">
              <Play className="w-5 h-5 text-white fill-white" />
            </div>
          </div>
          {mv.category && (
            <span className="absolute top-1.5 left-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[9px] rounded-md text-white/70 border border-white/10 z-10">{mv.category}</span>
          )}
          {mv.year && (
            <span className="absolute top-1.5 right-1.5 bg-black/60 backdrop-blur-sm px-1.5 py-0.5 text-[9px] rounded-md text-white/70 z-10">{mv.year}</span>
          )}
        </div>
        <div className="pt-2 px-0.5 pb-1">
          <h3 className={`font-medium text-xs truncate leading-tight transition-colors ${isFocused ? 'text-white' : 'text-white/80 group-hover:text-white'}`}>{mv.title}</h3>
          {mv.genre && <p className="text-[10px] text-white/35 mt-0.5 truncate">{mv.genre}</p>}
        </div>
      </div>
      {previewPortal}
    </>
  );
}

export default function MovieDetail() {
  const [, setLocation] = useLocation();
  const [, params] = useRoute('/pelicula/:id');
  const id = Number(params?.id);

  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState<string | null>(null);
  const [bgLoaded, setBgLoaded] = useState(false);

  const [mvZone, setMvZone] = useState<MvZone>('buttons');
  const [btnIndex, setBtnIndex] = useState(0);
  const [catPillIdx, setCatPillIdx] = useState(0);
  const [gridRow, setGridRow] = useState(0);
  const [gridCol, setGridCol] = useState(0);
  const focusedGridRef = useRef<HTMLDivElement | null>(null);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const { openKeyboard } = useTvKeyboard();

  // Ref holding latest keyboard-handler state so the listener registers only once
  const kbRef = useRef<{
    mvZone: MvZone;
    btnIndex: number; catPillIdx: number; gridRow: number; gridCol: number;
    related: Array<{ id: number; title: string; category?: string | null; [key: string]: unknown }>;
    actionButtons: Array<{ key: string; label: string; action: () => void }>;
    categories: string[]; allPills: (string | null)[];
    filterCat: string | null; search: string;
    openKeyboard: typeof openKeyboard;
    handleBack: () => void;
    setLocation: (path: string) => void;
  }>({
    mvZone: 'buttons', btnIndex: 0, catPillIdx: 0, gridRow: 0, gridCol: 0,
    related: [], actionButtons: [], categories: [], allPills: [],
    filterCat: null, search: '', openKeyboard, handleBack: () => {}, setLocation,
  });

  const [ytResults, setYtResults] = useState<YtResult[]>([]);
  const [archiveResults, setArchiveResults] = useState<ArchiveResult[]>([]);
  const [externalSearchLoading, setExternalSearchLoading] = useState(false);
  const externalSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const [externalPlayer, setExternalPlayer] = useState<{ type: string; videoId?: string; url?: string; title: string; thumbnail?: string } | null>(null);
  const [archiveLoading, setArchiveLoading] = useState<string | null>(null);

  const { data: session, isError: sessionError } = useGetMe({
    query: { queryKey: getGetMeQueryKey(), retry: false },
  });

  const { data: movies, isLoading } = useListMovies(undefined, {
    query: { queryKey: getListMoviesQueryKey() },
  });

  useEffect(() => {
    if (sessionError) { clearTokens(); setLocation('/'); }
  }, [sessionError, setLocation]);

  const movie = movies?.find(m => m.id === id);

  useEffect(() => {
    setBgLoaded(false);
    if (movie?.category) setFilterCat(movie.category);
    else setFilterCat(null);
    setSearch('');
    setMvZone('buttons');
    setBtnIndex(0);
    setCatPillIdx(0);
    setGridRow(0);
    setGridCol(0);
    setYtResults([]);
    setArchiveResults([]);
  }, [id, movie?.category]);

  const categories = useMemo(() => {
    if (!movies) return [];
    const cats = new Set(movies.map(m => m.category).filter(Boolean) as string[]);
    return Array.from(cats).sort();
  }, [movies]);

  const related = useMemo(() => {
    if (!movies) return [];
    const q = search.toLowerCase();
    return movies.filter(m => {
      if (m.id === id) return false;
      if (filterCat && m.category !== filterCat) return false;
      if (q && !m.title.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [movies, id, filterCat, search]);

  useEffect(() => {
    if (externalSearchTimer.current) clearTimeout(externalSearchTimer.current);
    const q = search.trim();
    if (!q || q.length < 2) {
      setYtResults([]);
      setArchiveResults([]);
      setExternalSearchLoading(false);
      return;
    }
    setExternalSearchLoading(true);
    externalSearchTimer.current = setTimeout(async () => {
      const token = getToken('user') || getToken('admin') || '';
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      try {
        const [ytRes, archRes] = await Promise.allSettled([
          fetch(`${apiBase}/api/user-search/youtube?q=${encodeURIComponent(q)}&type=movie`, { headers }).then(r => r.ok ? r.json() : { items: [] }),
          fetch(`${apiBase}/api/user-search/archive?q=${encodeURIComponent(q)}`, { headers }).then(r => r.ok ? r.json() : { items: [] }),
        ]);
        setYtResults(ytRes.status === 'fulfilled' ? (ytRes.value.items ?? []) : []);
        setArchiveResults(archRes.status === 'fulfilled' ? (archRes.value.items ?? []) : []);
      } catch {
        setYtResults([]);
        setArchiveResults([]);
      } finally {
        setExternalSearchLoading(false);
      }
    }, 700);
    return () => { if (externalSearchTimer.current) clearTimeout(externalSearchTimer.current); };
  }, [search]);

  const playArchive = useCallback((identifier: string, title: string, thumbnail?: string) => {
    setArchiveLoading(identifier);
    const token = getToken('user') || getToken('admin') || '';
    const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
    fetch(`${apiBase}/api/user-search/archive/video/${encodeURIComponent(identifier)}`, { headers })
      .then(r => r.json())
      .then(data => { if (data.url) setExternalPlayer({ type: 'archive', url: data.url, title: data.title || title, thumbnail }); })
      .finally(() => setArchiveLoading(null));
  }, []);

  const daysLeft = (() => {
    if (!session?.expiresAt) return null;
    const diff = new Date(session.expiresAt).getTime() - Date.now();
    return Math.ceil(diff / (1000 * 60 * 60 * 24));
  })();
  const isExpired = session?.type === 'user' && daysLeft !== null && daysLeft <= 0;
  const [showExpiredOverlay, setShowExpiredOverlay] = useState(true);
  const [isFav, setIsFav] = useState(() => getFavorites().includes(id));
  const savedProgress = movie ? getProgress(id) : null;

  useEffect(() => {
    if (isExpired) setShowExpiredOverlay(true);
  }, [isExpired]);

  useEffect(() => {
    setIsFav(getFavorites().includes(id));
  }, [id]);

  const hasContinue = !!(savedProgress && savedProgress.time > 10);

  const handlePlay = (startFrom?: number) => {
    if (isExpired) { setShowExpiredOverlay(true); return; }
    if (!movie) return;
    const url = movie.filePath ?? '';
    const p = new URLSearchParams({
      url,
      title: movie.title,
      type: 'movie',
      movieId: String(movie.id),
      category: movie.category || '',
    });
    if ((movie as any).videoFormat) p.set('format', (movie as any).videoFormat);
    if (startFrom !== undefined) p.set('startFrom', String(startFrom));
    setLocation(`/vod-player?${p.toString()}`);
  };

  const handleToggleFav = () => {
    const added = toggleFavorite(id);
    setIsFav(added);
  };

  const actionButtons = useMemo(() => {
    const btns: Array<{ key: string; label: string; action: () => void }> = [];
    if (hasContinue) {
      btns.push({ key: 'continue', label: `Continuar (${formatProgress(savedProgress!.time)})`, action: () => handlePlay(savedProgress!.time) });
      btns.push({ key: 'from-start', label: 'Desde el inicio', action: () => handlePlay(0) });
    } else {
      btns.push({ key: 'play', label: 'Ver ahora', action: () => handlePlay() });
    }
    btns.push({ key: 'fav', label: isFav ? 'En favoritos' : 'Favorito', action: handleToggleFav });
    btns.push({ key: 'info', label: 'Más información', action: () => {} });
    return btns;
  }, [hasContinue, savedProgress, isFav]);

  const handleBack = () => setLocation('/home?tab=movies');
  const bgImage = (movie as any)?.banner || movie?.poster;

  const allPills = useMemo(() => [null, ...categories], [categories]);

  // Keep ref up to date every render (synchronous, no stale closures in keyboard handler)
  kbRef.current = { mvZone, btnIndex, catPillIdx, gridRow, gridCol, related, actionButtons, categories, allPills, filterCat, search, openKeyboard, handleBack, setLocation };

  useEffect(() => {
    if (mvZone === 'buttons') {
      window.scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
    } else if (mvZone === 'catpills' || mvZone === 'search') {
      const el = document.querySelector('[data-mv-zone="catpills"]') as HTMLElement | null;
      if (el) el.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'nearest' });
    } else if (mvZone === 'grid' && focusedGridRef.current) {
      focusedGridRef.current.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'nearest', inline: 'nearest' });
    }
  }, [mvZone, gridRow, gridCol]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const { mvZone, btnIndex, catPillIdx, gridRow, gridCol, related, actionButtons, categories, allPills, filterCat, search, openKeyboard, handleBack, setLocation } = kbRef.current;
      const activeEl = document.activeElement;
      const isInputFocused = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || (activeEl instanceof HTMLElement && activeEl.isContentEditable);
      if (isInputFocused) {
        const key = normalizeKey(e);
        if (key === 'Escape' || key === 'Backspace') {
          e.preventDefault();
          (activeEl as HTMLElement).blur();
          setMvZone('search');
        }
        return;
      }
      if (mvZone === 'buttons') {
        switch (normalizeKey(e)) {
          case 'ArrowLeft':
            e.preventDefault();
            if (btnIndex > 0) setBtnIndex(p => p - 1);
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (btnIndex < actionButtons.length - 1) setBtnIndex(p => p + 1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (categories.length > 0) {
              const curPill = filterCat === null ? 0 : (categories.indexOf(filterCat) + 1);
              setCatPillIdx(Math.max(0, curPill));
              setMvZone('catpills');
            } else if (related.length > 0) {
              setMvZone('grid'); setGridRow(0); setGridCol(0);
            }
            break;
          case 'ArrowUp':
            e.preventDefault();
            break;
          case 'MediaPlayPause':
          case 'Enter':
            e.preventDefault();
            actionButtons[btnIndex]?.action();
            break;
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            handleBack();
            break;
        }
      } else if (mvZone === 'catpills') {
        switch (normalizeKey(e)) {
          case 'ArrowLeft':
            e.preventDefault();
            setCatPillIdx(p => Math.max(0, p - 1));
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (catPillIdx < allPills.length - 1) {
              setCatPillIdx(p => p + 1);
            } else {
              setMvZone('search');
            }
            break;
          case 'MediaPlayPause':
          case 'Enter': {
            e.preventDefault();
            const selected = allPills[catPillIdx] ?? null;
            setFilterCat(selected);
            setGridRow(0); setGridCol(0);
            break;
          }
          case 'ArrowDown':
            e.preventDefault();
            if (related.length > 0) { setMvZone('grid'); setGridRow(0); setGridCol(0); }
            break;
          case 'ArrowUp':
          case 'Escape':
            e.preventDefault();
            setMvZone('buttons');
            break;
        }
      } else if (mvZone === 'search') {
        switch (normalizeKey(e)) {
          case 'MediaPlayPause':
          case 'Enter':
            e.preventDefault();
            openKeyboard(searchInputRef.current, {
              value: search,
              onChange: v => setSearch(v),
              onConfirm: () => setMvZone('grid'),
              label: 'Buscar película...',
            });
            break;
          case 'ArrowLeft':
            e.preventDefault();
            setMvZone('catpills');
            setCatPillIdx(allPills.length - 1);
            break;
          case 'ArrowDown':
            e.preventDefault();
            if (related.length > 0) { setMvZone('grid'); setGridRow(0); setGridCol(0); }
            break;
          case 'ArrowUp':
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            setMvZone('catpills');
            break;
        }
      } else {
        const cols = getMovieGridCols();
        const totalItems = related.length;
        const totalRows = Math.ceil(totalItems / cols);
        const currentIdx = gridRow * cols + gridCol;
        switch (normalizeKey(e)) {
          case 'ArrowRight':
            e.preventDefault();
            if (gridCol < cols - 1 && currentIdx + 1 < totalItems) setGridCol(p => p + 1);
            break;
          case 'ArrowLeft':
            e.preventDefault();
            if (gridCol > 0) setGridCol(p => p - 1);
            else { setMvZone(categories.length > 0 ? 'catpills' : 'buttons'); }
            break;
          case 'ArrowDown': {
            e.preventDefault();
            const nextIdx = (gridRow + 1) * cols + gridCol;
            if (gridRow < totalRows - 1 && nextIdx < totalItems) {
              setGridRow(p => p + 1);
            } else if (gridRow < totalRows - 1) {
              setGridRow(p => p + 1);
              setGridCol(Math.min(gridCol, (totalItems - 1) % cols));
            }
            break;
          }
          case 'ArrowUp':
            e.preventDefault();
            if (gridRow > 0) setGridRow(p => p - 1);
            else setMvZone(categories.length > 0 ? 'catpills' : 'buttons');
            break;
          case 'MediaPlayPause':
          case 'Enter': {
            e.preventDefault();
            const idx = currentIdx;
            if (idx < related.length) setLocation(`/pelicula/${related[idx].id}`);
            break;
          }
          case 'Escape':
          case 'Backspace':
            e.preventDefault();
            setMvZone(categories.length > 0 ? 'catpills' : 'buttons');
            break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-[#141414] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!movie) {
    return (
      <div className="min-h-screen bg-[#141414] flex flex-col items-center justify-center gap-4 text-center px-4">
        <Film className="w-16 h-16 text-white/20" />
        <p className="text-white/50">Película no encontrada</p>
        <button onClick={handleBack} className="text-primary text-sm hover:underline">Volver al inicio</button>
      </div>
    );
  }

  const focusedItemIdx = mvZone === 'grid' ? gridRow * getMovieGridCols() + gridCol : -1;

  return (
    <div className="min-h-screen bg-[#141414] text-white flex flex-col select-none">

      {isExpired && showExpiredOverlay && (
        <div className="fixed inset-0 z-[100] bg-[#0a0a0a]/95 flex flex-col items-center justify-center gap-4 p-6 text-center">
          <button onClick={() => setShowExpiredOverlay(false)} className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 text-white/40"><X className="w-5 h-5" /></button>
          <Lock className="w-12 h-12 text-red-400" />
          <div>
            <h2 className="text-xl font-bold mb-1">Acceso vencido</h2>
            <p className="text-white/50 text-sm">Tu código venció. Contacta a tu proveedor para renovarlo.</p>
          </div>
        </div>
      )}

      {externalPlayer && externalPlayer.type === 'archive' && externalPlayer.url && (
        <div className="fixed inset-0 z-[90] bg-black flex flex-col items-center justify-center" onClick={() => setExternalPlayer(null)}>
          <div className="w-full max-w-3xl aspect-video" onClick={e => e.stopPropagation()}>
            <video src={externalPlayer.url} controls autoPlay className="w-full h-full rounded-lg bg-black" />
          </div>
          <button onClick={() => setExternalPlayer(null)} className="mt-4 text-white/50 hover:text-white text-sm flex items-center gap-1"><X className="w-4 h-4" /> Cerrar</button>
        </div>
      )}

      <div className="relative w-full" style={{ minHeight: '70vh', maxHeight: '85vh' }}>
        {bgImage && (
          <img
            src={bgImage}
            alt={movie.title}
            className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-150 ${bgLoaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setBgLoaded(true)}
            onError={() => setBgLoaded(true)}
          />
        )}
        {!bgImage && (
          <div className="absolute inset-0 bg-gradient-to-br from-slate-900 to-[#0a0a0a]" />
        )}

        <div className="absolute inset-0 bg-gradient-to-r from-black/95 via-black/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-transparent to-black/40" />

        <div className="absolute top-0 left-0 right-0 z-10 flex items-center gap-4 p-4 sm:p-6">
          <button
            onClick={handleBack}
            className="flex items-center gap-2 text-white/70 hover:text-white transition-colors text-sm bg-black/30 backdrop-blur-sm px-3 py-2 rounded-xl border border-white/10 hover:bg-black/50"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Volver</span>
          </button>
          <img src={logo} alt="Super TV" className="h-7 w-auto opacity-80" />
        </div>

        <div className="absolute bottom-0 left-0 p-6 sm:p-10 md:p-14 max-w-2xl space-y-3 sm:space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="px-2.5 py-0.5 bg-primary text-white text-[10px] font-bold rounded-lg uppercase tracking-widest">
              Película
            </span>
            {(movie as any).genre && (
              <span className="px-2.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded-lg border border-white/10">
                {(movie as any).genre}
              </span>
            )}
            {(movie as any).year && (
              <span className="px-2.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded-lg border border-white/10">
                {(movie as any).year}
              </span>
            )}
            {movie.category && (
              <span className="px-2.5 py-0.5 bg-white/10 text-white/70 text-[10px] rounded-lg border border-white/10 flex items-center gap-1">
                <Tag className="w-2.5 h-2.5" />{movie.category}
              </span>
            )}
          </div>

          <h1 className="text-3xl sm:text-5xl md:text-6xl font-extrabold text-white leading-tight drop-shadow-2xl line-clamp-3">
            {movie.title}
          </h1>

          {movie.description && (
            <p className="text-white/75 text-sm sm:text-base leading-relaxed line-clamp-3 max-w-lg">
              {movie.description}
            </p>
          )}

          {savedProgress && savedProgress.duration > 0 && (
            <div className="flex items-center gap-3 max-w-xs">
              <div className="flex-1 h-1 bg-white/20 rounded-full overflow-hidden">
                <div className="h-full bg-primary rounded-full" style={{ width: `${Math.min(100, (savedProgress.time / savedProgress.duration) * 100)}%` }} />
              </div>
              <span className="text-[11px] text-white/50">{formatProgress(savedProgress.time)}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-1">
            {hasContinue ? (
              <>
                <button
                  onClick={() => handlePlay(savedProgress!.time)}
                  className={`flex items-center gap-2.5 px-6 sm:px-8 py-3 bg-primary hover:bg-primary/80 text-white rounded-xl font-bold text-sm sm:text-base transition-all active:scale-95 shadow-lg shadow-primary/30 ${mvZone === 'buttons' && btnIndex === 0 ? 'ring-4 ring-white scale-105 shadow-[0_0_25px_rgba(220,38,38,0.6)]' : ''}`}
                >
                  {isExpired ? <Lock className="w-5 h-5" /> : <Play className="w-5 h-5 fill-white" />}
                  {isExpired ? 'Acceso vencido' : `Continuar (${formatProgress(savedProgress!.time)})`}
                </button>
                <button
                  onClick={() => handlePlay(0)}
                  className={`flex items-center gap-2 px-5 py-3 bg-white/15 hover:bg-white/25 text-white rounded-xl font-semibold text-sm transition-all active:scale-95 backdrop-blur-sm border border-white/15 ${mvZone === 'buttons' && btnIndex === 1 ? 'ring-4 ring-white scale-105 bg-white/25' : ''}`}
                >
                  <Play className="w-4 h-4" />
                  Desde el inicio
                </button>
                <button
                  onClick={handleToggleFav}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all active:scale-95 border backdrop-blur-sm ${isFav ? 'bg-primary/20 border-primary/40 text-primary/80 hover:bg-primary/30' : 'bg-white/10 border-white/15 text-white/70 hover:text-white hover:bg-white/20'} ${mvZone === 'buttons' && btnIndex === 2 ? 'ring-4 ring-white scale-105' : ''}`}
                >
                  <Heart className={`w-4 h-4 ${isFav ? 'fill-primary text-primary' : ''}`} />
                  {isFav ? 'En favoritos' : 'Favorito'}
                </button>
                <button
                  onClick={() => {}}
                  className={`flex items-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white/70 hover:text-white rounded-xl font-semibold text-sm transition-all active:scale-95 backdrop-blur-sm ${mvZone === 'buttons' && btnIndex === 3 ? 'ring-4 ring-white scale-105 bg-white/20' : ''}`}
                >
                  <Info className="w-4 h-4" />
                  <span className="hidden sm:inline">Más información</span>
                </button>
              </>
            ) : (
              <>
                <button
                  onClick={() => handlePlay()}
                  className={`flex items-center gap-2.5 px-7 sm:px-10 py-3 bg-primary hover:bg-primary/80 text-white rounded-xl font-bold text-sm sm:text-base transition-all active:scale-95 shadow-lg shadow-primary/30 ${mvZone === 'buttons' && btnIndex === 0 ? 'ring-4 ring-white scale-105 shadow-[0_0_25px_rgba(220,38,38,0.6)]' : ''}`}
                >
                  {isExpired ? <Lock className="w-5 h-5" /> : <Play className="w-5 h-5 fill-white" />}
                  {isExpired ? 'Acceso vencido' : 'Ver ahora'}
                </button>
                <button
                  onClick={handleToggleFav}
                  className={`flex items-center gap-2 px-5 py-3 rounded-xl font-semibold text-sm transition-all active:scale-95 border backdrop-blur-sm ${isFav ? 'bg-primary/20 border-primary/40 text-primary/80 hover:bg-primary/30' : 'bg-white/10 border-white/15 text-white/70 hover:text-white hover:bg-white/20'} ${mvZone === 'buttons' && btnIndex === 1 ? 'ring-4 ring-white scale-105' : ''}`}
                >
                  <Heart className={`w-4 h-4 ${isFav ? 'fill-primary text-primary' : ''}`} />
                  {isFav ? 'En favoritos' : 'Favorito'}
                </button>
                <button
                  onClick={() => {}}
                  className={`flex items-center gap-2 px-5 py-3 bg-white/10 hover:bg-white/20 border border-white/15 text-white/70 hover:text-white rounded-xl font-semibold text-sm transition-all active:scale-95 backdrop-blur-sm ${mvZone === 'buttons' && btnIndex === 2 ? 'ring-4 ring-white scale-105 bg-white/20' : ''}`}
                >
                  <Info className="w-4 h-4" />
                  <span className="hidden sm:inline">Más información</span>
                </button>
              </>
            )}
          </div>

          {mvZone === 'buttons' && (
            <p className="text-white/30 text-xs pt-1">◀▶ Navegar · Enter Seleccionar · ▼ Categorías</p>
          )}
          {mvZone === 'catpills' && (
            <p className="text-white/30 text-xs pt-1">◀▶ Categoría · ▶▶ Buscar · Enter Filtrar · ▼ Películas · ▲ Volver</p>
          )}
          {mvZone === 'search' && (
            <p className="text-white/30 text-xs pt-1">Enter Escribir · ◀ Categorías · ▼ Películas · ▲ Volver</p>
          )}
        </div>
      </div>

      {(movies?.length ?? 0) > 1 && (
        <section data-mv-zone="catpills" className="px-4 sm:px-8 md:px-14 py-8 space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="flex items-center gap-2 flex-1">
              <div className="w-1 h-6 bg-primary rounded-full" />
              <h2 className="text-lg sm:text-xl font-bold text-white">
                {filterCat ? `Más en "${filterCat}"` : 'Más películas'}
              </h2>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                onClick={() => { setFilterCat(null); setCatPillIdx(0); }}
                className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all
                  ${!filterCat ? 'bg-primary text-white' : 'bg-white/10 text-white/50 hover:text-white hover:bg-white/15'}
                  ${mvZone === 'catpills' && catPillIdx === 0 ? 'ring-2 ring-white scale-105' : ''}`}
              >
                Todas
              </button>
              {categories.map((cat, i) => (
                <button
                  key={cat}
                  onClick={() => { setFilterCat(cat === filterCat ? null : cat); setCatPillIdx(i + 1); }}
                  className={`flex-shrink-0 px-3 py-1 rounded-full text-xs font-medium transition-all
                    ${filterCat === cat ? 'bg-primary text-white' : 'bg-white/10 text-white/50 hover:text-white hover:bg-white/15'}
                    ${mvZone === 'catpills' && catPillIdx === i + 1 ? 'ring-2 ring-white scale-105' : ''}`}
                >
                  {cat}
                </button>
              ))}
            </div>

            <div className="relative">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30" />
              <input
                ref={searchInputRef}
                type="text"
                value={search}
                onChange={e => setSearch(e.target.value)}
                onFocus={() => setMvZone('search')}
                placeholder="Buscar película..."
                className={`pl-8 pr-8 py-1.5 text-sm bg-white/8 border rounded-xl w-full sm:w-48 text-white placeholder:text-white/30 focus:outline-none transition-all
                  ${mvZone === 'search' ? 'border-white/60 bg-white/12 ring-2 ring-white/40 scale-105' : 'border-white/10 focus:border-white/25'}`}
              />
              {search && (
                <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white">
                  <X className="w-3.5 h-3.5" />
                </button>
              )}
            </div>
          </div>

          {related.length === 0 && !search ? (
            <p className="text-white/30 text-sm py-8 text-center">No hay más películas en esta categoría</p>
          ) : (
            <>
              {mvZone === 'grid' && (
                <p className="text-white/30 text-xs">◀▶▲▼ Navegar · Enter Ver · Esc Categorías</p>
              )}
              {related.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-3 sm:gap-4">
                  {related.map((mv, idx) => {
                    const cols = getMovieGridCols();
                    const row = Math.floor(idx / cols);
                    const col = idx % cols;
                    const isFocused = mvZone === 'grid' && gridRow === row && gridCol === col;
                    return (
                      <MovieGridCard
                        key={mv.id}
                        mv={mv as GridMovie}
                        isFocused={isFocused}
                        cardRef={isFocused ? (el) => { focusedGridRef.current = el; } : undefined}
                        onClick={() => setLocation(`/pelicula/${mv.id}`)}
                      />
                    );
                  })}
                </div>
              )}

              {search.trim().length >= 2 && (
                <div className="space-y-6 mt-4">
                  {externalSearchLoading && (
                    <p className="text-xs text-white/30 animate-pulse">Buscando más resultados en línea...</p>
                  )}

                  {!externalSearchLoading && ytResults.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-base">🎬</span>
                        <h3 className="text-sm font-semibold text-white/70">Más resultados</h3>
                        <span className="text-xs text-white/25">{ytResults.length}</span>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                        {ytResults.map(item => (
                          <ContentCard
                            key={item.videoId}
                            title={item.title}
                            subtitle={item.year}
                            image={item.thumbnail}
                            badge={item.duration ?? null}
                            previewUrl={`https://www.youtube.com/watch?v=${item.videoId}`}
                            onClick={() => setExternalPlayer({ type: 'youtube', videoId: item.videoId, title: item.title, thumbnail: item.thumbnail })}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {!externalSearchLoading && archiveResults.length > 0 && (
                    <div>
                      <div className="flex items-center gap-2 mb-3">
                        <span className="text-base">🎞️</span>
                        <h3 className="text-sm font-semibold text-white/70">Clásicos disponibles</h3>
                        <span className="text-xs text-white/25">{archiveResults.length}</span>
                      </div>
                      <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                        {archiveResults.map(item => (
                          <ContentCard
                            key={item.identifier}
                            title={item.title}
                            subtitle={item.year}
                            image={item.thumbnail}
                            badge={archiveLoading === item.identifier ? '...' : null}
                            onClick={() => playArchive(item.identifier, item.title, item.thumbnail)}
                          />
                        ))}
                      </div>
                    </div>
                  )}

                  {!externalSearchLoading && related.length === 0 && ytResults.length === 0 && archiveResults.length === 0 && (
                    <p className="text-white/30 text-sm py-4 text-center">No se encontraron resultados para "{search}"</p>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}
    </div>
  );
}
