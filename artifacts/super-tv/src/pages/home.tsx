import { useState, useEffect, useRef, useCallback, useMemo, startTransition } from 'react';
import { normalizeKey } from '@/lib/tv-remote';
import { useLocation } from 'wouter';
import { apiBase } from '@/lib/api';
import { YouTubePlayerPage } from '@/components/YouTubePlayerPage';
import { ContentCard } from '@/components/ContentCard';
import {
  useListChannels, getListChannelsQueryKey,
  useListMovies, getListMoviesQueryKey,
  useListChannelCategories, getListChannelCategoriesQueryKey,
  useGetMe, getGetMeQueryKey,
  useListAvatars, getListAvatarsQueryKey,
  useUpdateProfile,
  type Channel,
} from '@workspace/api-client-react';

type SectionKey = 'channels' | 'movies' | 'series';

interface SectionConfig {
  order: SectionKey[];
  visibility: Record<SectionKey, boolean>;
}

const DEFAULT_SECTION_CONFIG: SectionConfig = {
  order: ['channels', 'movies', 'series'],
  visibility: { channels: true, movies: true, series: true },
};

function useSectionConfig(): SectionConfig {
  const [config, setConfig] = useState<SectionConfig>(DEFAULT_SECTION_CONFIG);
  useEffect(() => {
    fetch(`${apiBase}/api/settings/public`)
      .then(r => r.json())
      .then(d => {
        const order: SectionKey[] = Array.isArray(d.sectionOrder) ? d.sectionOrder : DEFAULT_SECTION_CONFIG.order;
        const visibility = d.sectionVisibility ?? DEFAULT_SECTION_CONFIG.visibility;
        setConfig({ order, visibility });
      })
      .catch(() => {});
  }, []);
  return config;
}
import { useQueryClient } from '@tanstack/react-query';
import { clearTokens, getToken } from '@/lib/auth';
import { setMiniPlayerState, updateMiniPlayerState, getMiniPlayerState, subscribeMiniPlayer } from '@/lib/mini-player-state';
import { useTvKeyboard } from '@/hooks/use-tv-keyboard';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Pause, LogOut, Search, Tv, Film, Tv2, X, Download, Share2, UserCircle2, AlertTriangle, Lock, Mic, MicOff, Home as HomeIcon, Smartphone, Menu, Heart, Clock, Trash2, Youtube, Maximize2, Minimize2 } from 'lucide-react';
import { getFavorites, getAllProgress, getHistory, toggleFavorite, getAllSeriesProgress, getExternalFavorites, getExternalHistory, toggleExternalFavorite, addExternalHistory, isExternalFavorite, removeExternalHistory, clearExternalHistory, type ExternalItem, getSearchHistory, addSearchHistory, removeSearchHistory, clearSearchHistory, getSeriesFavorites, toggleSeriesFavorite, getExternalProgress, getChannelFavorites, toggleChannelFavorite } from '@/lib/user-data';
import { useVoiceSearch } from '@/hooks/use-voice-search';
import logo from '@assets/logo_supertv.png';
import lettersLogo from '@assets/super-tv-letters-logo.png';
import { usePwaInstall } from '@/hooks/use-pwa-install';
import { ContentRow, isChannel } from '@/components/ContentRow';
import type { ContentItem, MovieItem } from '@/components/ContentRow';
import { MovieDetailSheet, type MovieInfo } from '@/components/MovieDetailSheet';
import { ProfileEditor } from '@/components/ProfileEditor';
import { HeroBanner, type HeroBannerItem } from '@/components/HeroBanner';
import { fetchSeries, type SeriesItem } from '@/lib/api';

type TabKey = 'home' | 'channels' | 'movies' | 'series' | 'favorites';
type NavZone = 'sidebar' | 'rows' | 'miniplayer' | 'hero' | 'catfilter';

const ADULT_RE = /\b(xxx|porno?|pornog\w*|sexo?|sexual\w*|er[oó]tic[ao]?|adulto?|nsfw|hentai|nude|desnud[ao]|naked|putit[ao]?|obscen\w*|escort|prostitu\w*)\b/i;


function getChannelGridCols(): number {
  const w = window.innerWidth;
  if (w >= 1536) return 7;
  if (w >= 1280) return 6;
  if (w >= 1024) return 5;
  if (w >= 768) return 4;
  if (w >= 640) return 3;
  return 2;
}

function getSearchGridCols(): number {
  const w = window.innerWidth;
  if (w >= 1024) return 6;
  if (w >= 768) return 5;
  if (w >= 640) return 4;
  return 3;
}

function isGridRow(rowId: string): boolean {
  return rowId === 'ext-yt' || rowId === 'ext-yt-movies' || rowId === 'ext-yt-others' || rowId === 'ext-arch';
}

function buildMiniProxyUrl(ch: { id: number; streamUrl: string }): { url: string; streamFormat: string } {
  if (ch.streamUrl.includes('youtube.com/') || ch.streamUrl.includes('youtu.be/')) {
    return { url: ch.streamUrl, streamFormat: 'youtube' };
  }
  const lower = ch.streamUrl.toLowerCase().split('?')[0];
  const token = getToken('user') || getToken('admin') || '';
  if (lower.endsWith('.m3u8') || lower.includes('/hls/')) {
    // Only try direct for HTTPS streams — HTTP streams are blocked as mixed content on HTTPS sites
    if (ch.streamUrl.startsWith('https://')) {
      return { url: ch.streamUrl, streamFormat: 'hls' };
    }
    // HTTP stream → use proxy immediately (no mixed-content attempt)
  }
  const isDash = lower.endsWith('.mpd') || lower.includes('/dash/');
  const isFlv = lower.endsWith('.flv');
  return { url: `${apiBase}/api/channels/${ch.id}/stream?token=${encodeURIComponent(token)}`, streamFormat: isDash ? 'dash' : isFlv ? 'flv' : 'native' };
}

interface ContentRowData {
  id: string;
  title: string;
  emoji: string;
  items: ContentItem[];
  showProgress?: boolean;
  showBadge?: boolean;
}

interface SeriesRowData {
  id: string;
  title: string;
  items: SeriesItem[];
}

function SeriesCard({ series, onClick, focused, onHover, onHoverEnd }: { series: SeriesItem; onClick: () => void; focused?: boolean; onHover?: () => void; onHoverEnd?: () => void }) {
  return (
    <div
      onClick={onClick}
      onMouseEnter={onHover}
      onMouseLeave={onHoverEnd}
      tabIndex={0}
      data-tv-focused={focused ? 'true' : undefined}
      className={`flex-shrink-0 w-36 sm:w-40 md:w-44 cursor-pointer group rounded-xl overflow-hidden border transition-all duration-200 ${focused ? 'border-primary ring-2 ring-primary scale-105 shadow-[0_0_15px_rgba(220,38,38,0.5)] z-10' : 'border-border hover:border-primary/60 hover:scale-[1.03]'}`}
    >
      <div className="relative aspect-[2/3] bg-muted overflow-hidden">
        {series.poster ? (
          <img src={series.poster} alt={series.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-2 p-2">
            <Tv2 className="w-8 h-8 text-muted-foreground/40" />
            <span className="text-[10px] text-muted-foreground/50 text-center leading-tight line-clamp-3">{series.title}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex items-end p-2">
          <Play className="w-6 h-6 text-white fill-white mx-auto" />
        </div>
        <div className="absolute top-1.5 left-1.5">
          <span className="px-1.5 py-0.5 bg-primary/90 text-white text-[9px] font-bold rounded uppercase tracking-wider">Serie</span>
        </div>
      </div>
      <div className="p-2 bg-card">
        <p className="text-xs font-medium truncate leading-tight">{series.title}</p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{[series.year, series.genre].filter(Boolean).join(' · ') || series.category || ''}</p>
      </div>
    </div>
  );
}

interface ContinueItemData {
  id: number;
  title: string;
  poster?: string | null;
  type: 'movie' | 'series' | 'external';
  time: number;
  duration: number;
  episodeInfo?: string;
  updatedAt: number;
  externalItem?: { id: string; source: 'youtube' | 'archive'; videoId?: string; url?: string; thumbnail?: string };
}

function ContinueWatchingCard({ item, onClick, focused }: { item: ContinueItemData; onClick: () => void; focused?: boolean }) {
  const isExternal = item.type === 'external';
  const pct = !isExternal && item.duration > 0 ? Math.min((item.time / item.duration) * 100, 100) : 0;
  const remaining = !isExternal && item.duration > item.time ? Math.round((item.duration - item.time) / 60) : 0;
  const poster = isExternal ? item.externalItem?.thumbnail : item.poster;
  return (
    <div
      onClick={onClick}
      tabIndex={0}
      data-tv-focused={focused ? 'true' : undefined}
      className={`flex-shrink-0 w-36 sm:w-40 md:w-44 cursor-pointer group rounded-xl overflow-hidden border transition-all duration-200 ${focused ? 'border-primary ring-2 ring-primary scale-105 shadow-[0_0_15px_rgba(220,38,38,0.5)] z-10' : 'border-border hover:border-primary/60 hover:scale-[1.03]'}`}
    >
      <div className={`relative bg-muted overflow-hidden ${isExternal ? 'aspect-video' : 'aspect-[2/3]'}`}>
        {poster ? (
          <img src={poster} alt={item.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300" onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }} />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-2 p-2">
            {item.type === 'series' ? <Tv2 className="w-8 h-8 text-muted-foreground/40" /> : <Film className="w-8 h-8 text-muted-foreground/40" />}
            <span className="text-[10px] text-muted-foreground/50 text-center leading-tight line-clamp-3">{item.title}</span>
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent flex items-end p-2 pb-4">
          <Play className="w-7 h-7 text-white fill-white mx-auto opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
        </div>
        <div className="absolute top-1.5 left-1.5">
          <span className={`px-1.5 py-0.5 text-[9px] font-bold rounded uppercase tracking-wider ${isExternal ? 'bg-primary/90 text-white' : item.type === 'series' ? 'bg-primary/90 text-white' : 'bg-primary/90 text-primary-foreground'}`}>
            {isExternal ? 'Online' : item.type === 'series' ? 'Serie' : 'Película'}
          </span>
        </div>
        {remaining > 0 && (
          <div className="absolute top-1.5 right-1.5">
            <span className="px-1.5 py-0.5 bg-black/70 text-white text-[9px] rounded">{remaining}m</span>
          </div>
        )}
        {!isExternal && (
          <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/40">
            <div className="h-full bg-primary transition-all duration-300 rounded-r-full" style={{ width: `${pct}%` }} />
          </div>
        )}
      </div>
      <div className="p-2 bg-card">
        <p className="text-xs font-medium truncate leading-tight">{item.title}</p>
        <p className="text-[10px] text-muted-foreground truncate mt-0.5">{item.episodeInfo ?? (isExternal ? '' : item.type === 'movie' ? 'Película' : '')}</p>
      </div>
    </div>
  );
}

function ChannelCard({ ch, onClick, focused }: { ch: Channel; onClick: () => void; focused?: boolean }) {
  return (
    <div
      onClick={onClick}
      data-tv-focused={focused ? 'true' : undefined}
      className={`relative rounded-xl cursor-pointer transition-all duration-200 overflow-hidden aspect-square bg-background ${focused ? 'ring-2 ring-primary scale-105 shadow-[0_0_16px_rgba(220,38,38,0.4)] z-10' : 'hover:scale-[1.04]'}`}
    >
      {ch.logo ? (
        <>
          <img
            src={ch.logo}
            alt={ch.name}
            className="w-full h-full object-cover"
            onError={e => {
              const img = e.target as HTMLImageElement;
              img.style.display = 'none';
              const fallback = img.parentElement?.querySelector('.logo-fallback') as HTMLElement | null;
              if (fallback) fallback.style.display = 'flex';
            }}
          />
          <div className="logo-fallback hidden w-full h-full items-center justify-center absolute inset-0">
            <Tv className="w-6 h-6 text-white/20" />
          </div>
          <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 to-transparent px-1.5 pt-4 pb-1">
            <p className="text-[9px] sm:text-[10px] text-center leading-tight w-full truncate text-white/90 font-medium">{ch.name}</p>
          </div>
        </>
      ) : (
        <>
          <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-1 px-2">
            <Tv2 className="w-6 h-6 text-white/20 flex-shrink-0" />
            <p className="text-[9px] sm:text-[10px] text-white/60 font-semibold text-center leading-tight line-clamp-2 drop-shadow">{ch.name}</p>
          </div>
        </>
      )}
    </div>
  );
}

function formatRelativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Ahora mismo';
  if (mins < 60) return `Hace ${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `Hace ${hrs}h`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'Ayer';
  if (days < 7) return `Hace ${days} días`;
  return new Date(ts).toLocaleDateString('es', { day: 'numeric', month: 'short' });
}

function HistoryCard({
  item,
  onClick,
  onRemove,
  focused,
}: {
  item: ExternalItem;
  onClick: () => void;
  onRemove: (e: React.MouseEvent) => void;
  focused?: boolean;
}) {
  const [imgError, setImgError] = useState(false);
  return (
    <div
      onClick={onClick}
      className={`flex-shrink-0 w-40 sm:w-44 md:w-48 group cursor-pointer select-none transition-transform duration-200 ease-out hover:scale-[1.04] z-10 ${focused ? 'scale-[1.04]' : ''}`}
    >
      <div className={`aspect-video rounded-lg overflow-hidden relative shadow-md transition-[box-shadow,ring] duration-200 group-hover:shadow-[0_8px_40px_rgba(0,0,0,0.9)] group-hover:ring-1 group-hover:ring-white/20 ${focused ? 'ring-2 ring-white shadow-[0_8px_40px_rgba(0,0,0,0.9)]' : ''}`}>
        {item.thumbnail && !imgError ? (
          <img
            src={item.thumbnail}
            alt={item.title}
            loading="lazy"
            className="w-full h-full object-cover scale-100 group-hover:scale-105 transition-transform duration-300"
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex flex-col items-center justify-center gap-2 px-3">
            <Film className="w-6 h-6 text-white/20 flex-shrink-0" />
            <p className="text-white/70 text-[10px] font-semibold text-center leading-snug line-clamp-3 drop-shadow">{item.title}</p>
          </div>
        )}
        <div className="absolute inset-0 transition-opacity duration-300 opacity-0 group-hover:opacity-100">
          <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="p-2.5 rounded-full bg-white/25 border border-white/30 scale-100 group-hover:scale-110 transition-transform duration-200">
              <Play className="w-5 h-5 sm:w-6 sm:h-6 text-white fill-white drop-shadow-lg" />
            </div>
          </div>
          <div className="absolute bottom-2 left-2 right-8">
            <p className="text-white text-[11px] font-semibold leading-tight line-clamp-2 drop-shadow-lg">{item.title}</p>
          </div>
        </div>
        <button
          onClick={onRemove}
          className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/70 text-white/50 hover:text-white hover:bg-black/85 hover:scale-110 opacity-0 group-hover:opacity-100 transition-[opacity,transform] duration-150 z-10"
          title="Quitar del historial"
        >
          <X className="w-3 h-3 sm:w-3.5 sm:h-3.5" />
        </button>
        <span className="absolute bottom-1.5 left-1.5 bg-black/70 text-[9px] text-white/60 px-1.5 py-0.5 rounded font-medium flex items-center gap-1">
          <Clock className="w-2.5 h-2.5 flex-shrink-0" />
          {formatRelativeTime(item.updatedAt)}
        </span>
      </div>
      <div className="mt-1.5 px-0.5">
        <p className="text-xs font-medium truncate leading-snug text-muted-foreground group-hover:text-foreground transition-colors duration-200">{item.title}</p>
      </div>
    </div>
  );
}

function ExternalPlayerModal({ player, onClose, onHistoryUpdate, onFavsUpdate }: {
  player: { type: 'youtube' | 'archive'; videoId?: string; url?: string; title: string; thumbnail?: string };
  onClose: () => void;
  onHistoryUpdate: () => void;
  onFavsUpdate: () => void;
}) {
  const extId = player.type === 'youtube' ? `yt_${player.videoId}` : `arch_${player.url}`;
  const [isFav, setIsFav] = useState(() => isExternalFavorite(extId));
  const [ctrlVisible, setCtrlVisible] = useState(true);
  const hideTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const item: ExternalItem = { id: extId, source: player.type, title: player.title, thumbnail: player.thumbnail ?? '', videoId: player.videoId, url: player.url, updatedAt: Date.now() };
    addExternalHistory(item);
    onHistoryUpdate();
  }, [extId]); // eslint-disable-line react-hooks/exhaustive-deps

  const flashControls = useCallback(() => {
    setCtrlVisible(true);
    if (hideTimer.current) clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setCtrlVisible(false), 3500);
  }, []);

  useEffect(() => {
    flashControls();
    return () => { if (hideTimer.current) clearTimeout(hideTimer.current); };
  }, [flashControls]);

  const handleToggleFav = useCallback(() => {
    const item: ExternalItem = { id: extId, source: player.type, title: player.title, thumbnail: player.thumbnail ?? '', videoId: player.videoId, url: player.url, updatedAt: Date.now() };
    const nowFav = toggleExternalFavorite(item);
    setIsFav(nowFav);
    onFavsUpdate();
  }, [extId, player, onFavsUpdate]);

  const ctrlBtn = 'p-3 rounded-2xl bg-black/55 backdrop-blur-md border border-white/10 text-white/90 hover:bg-black/75 hover:text-white active:scale-95 transition-all duration-150 shadow-lg';

  if (player.type === 'youtube' && player.videoId) {
    const savedTime = getExternalProgress(extId)?.time ?? 0;
    return (
      <YouTubePlayerPage
        videoId={player.videoId}
        title={player.title}
        onBack={onClose}
        isFav={isFav}
        onFavToggle={handleToggleFav}
        externalId={extId}
        startFrom={savedTime > 10 ? savedTime : 0}
      />
    );
  }

  return (
    <div className="fixed inset-0 z-[100] bg-black flex flex-col" onMouseMove={flashControls} onTouchStart={flashControls}>
      <div className="relative flex-1 bg-black">
        <video
          src={player.url}
          controls
          autoPlay
          className="absolute inset-0 w-full h-full object-contain"
        />
        <div className={`absolute top-0 inset-x-0 z-10 flex items-center gap-2.5 px-4 pt-4 transition-opacity duration-300 ${ctrlVisible ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}`}>
          <div className="absolute top-0 inset-x-0 h-24 bg-gradient-to-b from-black/70 to-transparent -z-10" />
          <p className="text-sm text-white font-semibold truncate flex-1 drop-shadow">{player.title}</p>
          <button onClick={handleToggleFav} className={`${ctrlBtn} ${isFav ? '!bg-primary/50 !text-primary' : ''}`}>
            <Heart className={`w-5 h-5 ${isFav ? 'fill-primary' : ''}`} />
          </button>
          <button onClick={onClose} className={ctrlBtn}>
            <X className="w-5 h-5" />
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Home() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { canInstall, install, showInstallButton, isIosSafari } = usePwaInstall();
  const { openKeyboard } = useTvKeyboard();
  const [showHint, setShowHint] = useState(false);
  const [showShortcutHint, setShowShortcutHint] = useState(false);
  const [showProfile, setShowProfile] = useState(false);
  const [sidebarMouseOpen, setSidebarMouseOpen] = useState(false);
  const sidebarHoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [selectedChannelCategory, setSelectedChannelCategory] = useState<string | null>(null);
  const [catFilterIdx, setCatFilterIdx] = useState(0);
  const [expiryBannerDismissed, setExpiryBannerDismissed] = useState(() => {
    try { return localStorage.getItem('supertv_expiry_dismissed') === new Date().toDateString(); } catch { return false; }
  });

  const initialTab = (() => {
    try {
      const p = new URLSearchParams(window.location.search);
      const t = p.get('tab');
      if (t === 'movies') return 'movies';
      if (t === 'series') return 'series';
      if (t === 'channels') return 'channels';
      if (t === 'favorites') return 'favorites';
      return 'home';
    } catch { return 'home'; }
  })() as TabKey;

  const [activeTab, setActiveTab] = useState<TabKey>(initialTab);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchInput, setSearchInput] = useState('');
  const SEARCH_HINTS = ['películas', 'acción', 'terror', 'animados', 'comedia', 'drama', 'series', 'documentales', 'romance', 'suspenso', 'ciencia ficción'];
  const [searchHintIdx, setSearchHintIdx] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setSearchHintIdx(i => (i + 1) % SEARCH_HINTS.length), 2500);
    return () => clearInterval(id);
  }, []);
  const [zone, setZone] = useState<NavZone>('rows');
  const [inputMode, setInputMode] = useState<'mouse' | 'keyboard'>('mouse');
  const inputModeRef = useRef<'mouse' | 'keyboard'>('mouse');

  type YtResult = { videoId: string; title: string; thumbnail: string; channel: string; year?: string; duration: string };
  type ArchiveResult = { identifier: string; title: string; year?: string; creator?: string; thumbnail: string };
  type ExternalPlayer = { type: 'youtube'; videoId?: string; url?: string; title: string; thumbnail?: string } | { type: 'archive'; url?: string; videoId?: string; title: string; thumbnail?: string } | null;

  const [ytResults, setYtResults] = useState<YtResult[]>([]);
  const [archiveResults, setArchiveResults] = useState<ArchiveResult[]>([]);
  const [externalSearchLoading, setExternalSearchLoading] = useState(false);
  const [externalPlayer, setExternalPlayer] = useState<ExternalPlayer>(null);
  const [archiveLoading, setArchiveLoading] = useState<string | null>(null);
  const externalSearchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [tabIndex, setTabIndex] = useState(() => {
    if (initialTab === 'series') return 1;
    if (initialTab === 'movies') return 2;
    if (initialTab === 'channels') return 3;
    if (initialTab === 'favorites') return 4;
    return 0;
  });
  const [rowIndex, setRowIndex] = useState(0);
  const [colIndex, setColIndex] = useState(0);
  const [rowsFocusActive, setRowsFocusActive] = useState(false);
  const [sidebarIdx, setSidebarIdx] = useState(0);
  const [heroBtnIndex, setHeroBtnIndex] = useState(0);
  const [heroBannerIdx, setHeroBannerIdx] = useState(() => 0);
  const heroBannerInitialized = useRef(false);
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [seriesList, setSeriesList] = useState<SeriesItem[]>([]);
  const [seriesLoading, setSeriesLoading] = useState(false);
  const [hoveredHero, setHoveredHero] = useState<HeroBannerItem | null>(null);
  const rowRefs = useRef<(HTMLElement | null)[]>([]);
  const searchRef = useRef<HTMLInputElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);

  const sectionConfig = useSectionConfig();

  const sectionDefs: Record<SectionKey, { key: TabKey; label: string; icon: typeof Tv }> = {
    channels: { key: 'channels', label: 'En vivo', icon: Tv },
    movies: { key: 'movies', label: 'Películas', icon: Film },
    series: { key: 'series', label: 'Series', icon: Tv2 },
  };

  const navItems = [
    { key: 'home' as TabKey, label: 'Inicio', icon: HomeIcon },
    ...sectionConfig.order
      .filter(s => sectionConfig.visibility[s])
      .map(s => sectionDefs[s]),
    { key: 'favorites' as TabKey, label: 'Favoritos', icon: Heart },
  ];

  const tabs = navItems;

  const { isListening, isSupported: voiceSupported, startListening, stopListening } = useVoiceSearch({
    onResult: (transcript) => { setSearchQuery(transcript); setSearchInput(transcript); setRowIndex(0); setColIndex(0); setVoiceError(null); searchRef.current?.focus(); },
    onError: (err) => { setVoiceError(err === 'not-allowed' ? 'Permiso de micrófono denegado' : 'No se pudo reconocer la voz'); setTimeout(() => setVoiceError(null), 3000); },
  });
  const searchPlaceholder = isListening ? 'Escuchando...' : `Buscar... ${SEARCH_HINTS[searchHintIdx]}`;

  const [favorites, setFavorites] = useState<number[]>(() => getFavorites());
  const [detailMovie, setDetailMovie] = useState<MovieInfo | null>(null);
  const [seriesFavIds, setSeriesFavIds] = useState<number[]>(() => getSeriesFavorites());
  const [channelFavIds, setChannelFavIds] = useState<number[]>(() => getChannelFavorites());

  const [allProgress, setAllProgress] = useState(() => getAllProgress());
  const [watchHistory, setWatchHistory] = useState(() => getHistory());
  const [externalFavs, setExternalFavs] = useState<ExternalItem[]>(() => getExternalFavorites());
  const [externalHistory, setExternalHistory] = useState<ExternalItem[]>(() => getExternalHistory());
  const [searchHistory, setSearchHistory] = useState<string[]>(() => getSearchHistory());

  const { data: session, isError: sessionError } = useGetMe({ query: { queryKey: getGetMeQueryKey(), retry: false, refetchInterval: 30000 } });
  const { data: avatars = [] } = useListAvatars({ query: { queryKey: getListAvatarsQueryKey() } });
  const updateProfileMutation = useUpdateProfile();
  const { data: allChannels = [], isLoading: channelsLoading } = useListChannels(undefined, { query: { queryKey: getListChannelsQueryKey() } });
  const { data: movies = [], isLoading: moviesLoading } = useListMovies(undefined, { query: { queryKey: getListMoviesQueryKey() } });
  const { data: categoriesFromApi = [] } = useListChannelCategories({ query: { queryKey: getListChannelCategoriesQueryKey() } });

  useEffect(() => { if (sessionError) { clearTokens(); setLocation('/'); } }, [sessionError, setLocation]);

  useEffect(() => {
    if ((activeTab === 'series' || activeTab === 'home' || activeTab === 'favorites') && seriesList.length === 0) {
      setSeriesLoading(true);
      fetchSeries().then(s => { setSeriesList(s); setSeriesLoading(false); }).catch(() => setSeriesLoading(false));
    }
  }, [activeTab]);

  const favSet = useMemo(() => new Set(favorites), [favorites]);
  const progressMap = useMemo(() => new Map(allProgress.map(p => [p.movieId, p])), [allProgress]);

  const continueWatching = useMemo(() => {
    if (!movies.length) return [];
    return allProgress.map(p => movies.find(m => m.id === p.movieId)).filter((m): m is typeof movies[0] => !!m).slice(0, 12);
  }, [movies, allProgress]);

  useEffect(() => {
    const hasSeriesProgress = getAllSeriesProgress().length > 0;
    if (hasSeriesProgress && seriesList.length === 0) {
      fetchSeries().then(s => setSeriesList(s)).catch(() => {});
    }
  }, []);

  const combinedContinueWatching = useMemo((): ContinueItemData[] => {
    const items: ContinueItemData[] = [];
    for (const p of allProgress) {
      const m = movies.find(mv => mv.id === p.movieId);
      if (m) items.push({ id: m.id, title: m.title, poster: (m as any).poster ?? null, type: 'movie', time: p.time, duration: p.duration, updatedAt: p.updatedAt });
    }
    const spList = getAllSeriesProgress();
    for (const p of spList) {
      const s = seriesList.find(sv => sv.id === p.seriesId);
      if (s) items.push({ id: s.id, title: s.title, poster: s.poster, type: 'series', time: p.time, duration: p.duration, episodeInfo: `T${p.seasonNumber}:E${p.episodeNumber}`, updatedAt: p.updatedAt });
    }
    for (const ext of externalHistory) {
      const extProgId = ext.source === 'youtube' ? `yt_${ext.videoId}` : `arch_${ext.url}`;
      const extProg = getExternalProgress(extProgId);
      items.push({ id: 0, title: ext.title, poster: ext.thumbnail, type: 'external', time: extProg?.time ?? 0, duration: extProg?.duration ?? 0, updatedAt: ext.updatedAt, externalItem: { id: ext.id, source: ext.source, videoId: ext.videoId, url: ext.url, thumbnail: ext.thumbnail } });
    }
    items.sort((a, b) => b.updatedAt - a.updatedAt);
    return items.slice(0, 14);
  }, [allProgress, movies, seriesList, externalHistory]);

  const favoriteMovies = useMemo(() => {
    if (!movies.length || !favorites.length) return [];
    return favorites.map(fid => movies.find(m => m.id === fid)).filter((m): m is typeof movies[0] => !!m).slice(0, 14);
  }, [movies, favorites]);

  const favoriteSeries = useMemo(() => {
    if (!seriesList.length || !seriesFavIds.length) return [];
    return seriesFavIds.map(sid => seriesList.find(s => s.id === sid)).filter((s): s is SeriesItem => !!s).slice(0, 14);
  }, [seriesList, seriesFavIds]);

  const recommendations = useMemo(() => {
    if (!movies.length) return [];
    const favCats = new Set(movies.filter(m => favSet.has(m.id)).map(m => m.category).filter(Boolean) as string[]);
    const watchedCats = new Set(watchHistory.map(h => h.category).filter(Boolean) as string[]);
    if (!favCats.size && !watchedCats.size) return [];
    const progressIds = new Set(allProgress.map(p => p.movieId));
    return movies.filter(m => !favSet.has(m.id) && !progressIds.has(m.id)).map(m => {
      let score = 0;
      if (m.category && favCats.has(m.category)) score += 3;
      if (m.category && watchedCats.has(m.category)) score += 1;
      return { m, score };
    }).filter(x => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 14).map(x => x.m);
  }, [movies, favSet, watchHistory, allProgress]);

  const recentMovies = useMemo(() => {
    if (!movies.length) return [];
    return [...movies].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 14);
  }, [movies]);

  const channelsByCategory = useMemo(() => {
    const map = new Map<string, typeof allChannels>();
    allChannels.forEach(ch => { const cat = ch.category || 'Sin categoría'; if (!map.has(cat)) map.set(cat, []); map.get(cat)!.push(ch); });
    return map;
  }, [allChannels]);

  const moviesByCategory = useMemo(() => {
    const map = new Map<string, typeof movies>();
    movies.forEach(m => { const cat = m.category || 'Sin categoría'; if (!map.has(cat)) map.set(cat, []); map.get(cat)!.push(m); });
    return map;
  }, [movies]);

  const sevenDaysAgo = useMemo(() => Date.now() - 7 * 24 * 60 * 60 * 1000, []);
  const isNew = useCallback((item: ContentItem) => {
    if (!('createdAt' in item)) return false;
    return new Date((item as typeof movies[0]).createdAt).getTime() > sevenDaysAgo;
  }, [sevenDaysAgo]);

  const daysLeft = (() => {
    if (!session?.expiresAt) return null;
    return Math.ceil((new Date(session.expiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24));
  })();
  const isExpired = session?.type === 'user' && daysLeft !== null && daysLeft <= 0;
  const [showExpiredOverlay, setShowExpiredOverlay] = useState(true);
  useEffect(() => { if (isExpired) setShowExpiredOverlay(true); }, [isExpired]);

  const heroBannerItems = useMemo((): HeroBannerItem[] => {
    const shuffle = <T,>(arr: T[]): T[] => {
      const copy = [...arr];
      for (let i = copy.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [copy[i], copy[j]] = [copy[j], copy[i]];
      }
      return copy;
    };
    const toMovie = (m: any): HeroBannerItem => ({ id: m.id, title: m.title, description: m.description, banner: m.banner, poster: m.poster, category: m.category, genre: m.genre, year: m.year, type: 'movie' as const, streamUrl: m.filePath ?? null, streamFormat: m.videoFormat ?? null });
    const toSeries = (s: any): HeroBannerItem => ({ id: s.id, title: s.title, description: s.description, banner: s.banner, poster: s.poster, category: s.category, genre: s.genre, year: s.year, type: 'series' as const });

    if (activeTab === 'home') {
      const pool = shuffle((movies as any[]).filter(m => m.banner || m.poster).map(toMovie));
      return pool;
    }
    if (activeTab === 'movies') {
      const pool = shuffle((movies as any[]).filter(m => m.banner || m.poster).map(toMovie));
      return pool;
    }
    if (activeTab === 'series' && seriesList.length > 0) {
      const pool = shuffle(seriesList.filter(s => s.banner || s.poster).map(toSeries));
      return pool;
    }
    return [];
  }, [activeTab, movies, seriesList]);

  useEffect(() => {
    if (heroBannerItems.length > 0) {
      setHeroBannerIdx(Math.floor(Math.random() * heroBannerItems.length));
      heroBannerInitialized.current = true;
    }
  }, [heroBannerItems.length]);

  const contentRows = useMemo((): ContentRowData[] => {
    const q = searchQuery.trim().toLowerCase();
    if (activeTab === 'favorites') return [];
    if (activeTab === 'channels') {
      if (q) {
        const results = allChannels.filter(ch => ch.name.toLowerCase().includes(q));
        return [{ id: 'search', title: `Resultados: "${searchQuery}"`, emoji: '🔍', items: results as ContentItem[] }];
      }
      return [];
    }
    if (q && activeTab !== 'series') {
      const rows: ContentRowData[] = [];
      // 1. Local imported movies (highest priority)
      const results = movies.filter(m => m.title.toLowerCase().includes(q));
      if (results.length > 0) rows.push({ id: 'search', title: `Resultados: "${searchQuery}"`, emoji: '🔍', items: results as ContentItem[] });
      // 2 & 3. YouTube — split into full movies vs other videos
      if (ytResults.length > 0) {
        const JUNK_RE = /\b(tr[aá]iler|trailer|reseña|resumen|cr[ií]tica|review|top\s*\d+|ranking|explicado|escenas|escena|capitulo|cap[ií]tulo|episodio|temporada|clip|making\s*of|behind|entrevista|interview|analisis|an[aá]lisis|banda\s*sonora|soundtrack|ost\b|music\s*video|lyric|en\s*\d+\s*minutos?|anuncio|avance|promo\b|react\w*|vlog|shorts?\b|teaser|featurette|blooper|fan\s*made|fanmade|parody|parodia|gameplay|speedrun)\b/i;
        const parseMins = (t: string) => { if (!t) return -1; const p = t.split(':').map(Number); if (p.some(isNaN)) return -1; return p.length === 3 ? p[0]*60+p[1]+p[2]/60 : p.length === 2 ? p[0]+p[1]/60 : -1; };
        const isFullMovie = (r: typeof ytResults[0]) => !JUNK_RE.test(r.title) && (parseMins(r.duration ?? '') === -1 || parseMins(r.duration ?? '') >= 60);
        const ytMovies = ytResults.filter(isFullMovie);
        const ytOthers = ytResults.filter(r => !isFullMovie(r));
        const toItem = (r: typeof ytResults[0], i: number) => ({ id: -(i + 1) * 100, title: r.title, poster: r.thumbnail, createdAt: '', _ytVideoId: r.videoId, _ytThumbnail: r.thumbnail, _ytDuration: r.duration }) as unknown as ContentItem;
        if (ytMovies.length > 0) rows.push({ id: 'ext-yt-movies', title: 'Más resultados', emoji: '🎬', items: ytMovies.map(toItem) });
        if (ytOthers.length > 0) rows.push({ id: 'ext-yt-others', title: 'Otros resultados', emoji: '🎬', items: ytOthers.map(toItem) });
      }
      // 4. Archive.org — last (classic/free movies)
      if (archiveResults.length > 0) {
        const archItems = archiveResults.map((r, i) => ({ id: -(i + 1) * 100 - 50, title: r.title, poster: r.thumbnail, createdAt: '', _archIdentifier: r.identifier, _archThumbnail: r.thumbnail })) as unknown as ContentItem[];
        rows.push({ id: 'ext-arch', title: 'Resultados adicionales', emoji: '🎬', items: archItems });
      }
      return rows;
    }
    if (activeTab === 'home') {
      const rows: ContentRowData[] = [];

      // 1. Continuar viendo
      if (combinedContinueWatching.length > 0) {
        rows.push({ id: 'continue', title: 'Continuar viendo', emoji: '▶', items: [] as ContentItem[], showProgress: true });
      }

      // 2. En vivo — primeros 14 canales
      const homeChannels = allChannels.slice(0, 14);
      if (homeChannels.length > 0) {
        rows.push({ id: 'home-live', title: 'En vivo', emoji: '📡', items: homeChannels as ContentItem[] });
      }

      // 3. Películas — más vistas primero, luego el resto
      const sortByViews = <T extends { viewCount?: number; createdAt?: string }>(arr: T[]) =>
        [...arr].sort((a, b) => {
          const vDiff = ((b as any).viewCount ?? 0) - ((a as any).viewCount ?? 0);
          if (vDiff !== 0) return vDiff;
          return new Date((b.createdAt ?? 0)).getTime() - new Date((a.createdAt ?? 0)).getTime();
        });

      const anyMovies = movies as any[];
      const topMovies = sortByViews(anyMovies).slice(0, 14);
      const topMovieIds = new Set(topMovies.map((m: any) => m.id));
      if (topMovies.length > 0) {
        rows.push({ id: 'home-top-movies', title: 'Películas más vistas', emoji: '🔥', items: topMovies as ContentItem[], showBadge: true });
      }
      const restMovies = sortByViews(anyMovies.filter((m: any) => !topMovieIds.has(m.id)));
      if (restMovies.length > 0) {
        rows.push({ id: 'home-movies', title: 'Más películas', emoji: '🎬', items: restMovies as ContentItem[], showBadge: true });
      }

      // 4. Series — más vistas primero
      if (seriesList.length > 0) {
        const sortedSeries = sortByViews(seriesList as any[]).map((s: any) => ({ ...s, _isSeries: true }));
        rows.push({ id: 'home-series', title: 'Series', emoji: '📺', items: sortedSeries as unknown as ContentItem[] });
      }

      // 5. Canales adicionales (si hay más de 14)
      if (allChannels.length > 14) {
        rows.push({ id: 'home-more-channels', title: 'Más canales', emoji: '📡', items: allChannels.slice(14) as ContentItem[] });
      }

      // 6. Historial externo
      if (externalHistory.length > 0) {
        rows.push({ id: 'ext-history', title: 'Historial de reproducción', emoji: '', items: externalHistory as unknown as ContentItem[] });
      }

      return rows;
    }
    const rows: ContentRowData[] = [];
    if (continueWatching.length > 0) rows.push({ id: 'continue', title: 'Seguir viendo', emoji: '▶', items: continueWatching as ContentItem[], showProgress: true });
    if (favoriteMovies.length > 0) rows.push({ id: 'favs', title: 'Mis favoritos', emoji: '❤️', items: favoriteMovies as ContentItem[] });
    if (recommendations.length > 0) rows.push({ id: 'recs', title: 'Para ti', emoji: '⭐', items: recommendations as ContentItem[] });

    const sortByViewCount = (arr: typeof movies) =>
      [...arr].sort((a, b) => ((b as any).viewCount ?? 0) - ((a as any).viewCount ?? 0));

    const topViewed = sortByViewCount(movies).filter(m => ((m as any).viewCount ?? 0) > 0).slice(0, 14);
    if (topViewed.length > 0) rows.push({ id: 'top-viewed', title: 'Más vistas', emoji: '🔥', items: topViewed as ContentItem[] });

    if (recentMovies.length > 0) rows.push({ id: 'recent', title: 'Recién agregadas', emoji: '🆕', items: recentMovies as ContentItem[], showBadge: true });
    const specialIds = new Set([...continueWatching.map(m => m.id), ...favoriteMovies.map(m => m.id), ...recommendations.map(m => m.id), ...topViewed.map(m => m.id)]);
    const movCatOrder = [...moviesByCategory.keys()].sort((a, b) => {
      if (a === 'Sin categoría') return 1; if (b === 'Sin categoría') return -1;
      return (moviesByCategory.get(b)?.length ?? 0) - (moviesByCategory.get(a)?.length ?? 0);
    });
    for (const cat of movCatOrder) {
      const items = (moviesByCategory.get(cat) ?? []).filter(m => !specialIds.has(m.id));
      if (items.length > 0) rows.push({ id: `mv-${cat}`, title: cat === 'Sin categoría' ? 'Todas las películas' : cat, emoji: '🎬', items: items as ContentItem[] });
    }
    if (rows.length === 0 && movies.length > 0) rows.push({ id: 'mv-all', title: 'Todas las películas', emoji: '🎬', items: sortByViewCount(movies) as ContentItem[] });
    if (!q && externalHistory.length > 0) rows.push({ id: 'ext-history', title: 'Historial de reproducción', emoji: '', items: externalHistory as unknown as ContentItem[] });
    return rows;
  }, [searchQuery, activeTab, allChannels, movies, ytResults, archiveResults, moviesByCategory, continueWatching, recentMovies, recommendations, favoriteMovies, combinedContinueWatching, seriesList, externalHistory]);

  const seriesRows = useMemo((): SeriesRowData[] => {
    if (activeTab !== 'series') return [];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const results = seriesList.filter(s => s.title.toLowerCase().includes(q));
      return [{ id: 'search', title: `Resultados: "${searchQuery}"`, items: results }];
    }
    const seriesByCat = new Map<string, SeriesItem[]>();
    seriesList.forEach(s => { const cat = s.category || 'Series'; if (!seriesByCat.has(cat)) seriesByCat.set(cat, []); seriesByCat.get(cat)!.push(s); });
    const rows: SeriesRowData[] = [];
    if (seriesList.length > 0) {
      const seriesProgress = getAllSeriesProgress();
      const inProgress = seriesProgress.map(p => seriesList.find(s => s.id === p.seriesId)).filter((s): s is SeriesItem => !!s).slice(0, 10);
      if (inProgress.length > 0) rows.push({ id: 'series-progress', title: 'Seguir viendo', items: inProgress });
    }
    const catOrder = [...seriesByCat.keys()].sort();
    for (const cat of catOrder) {
      const items = seriesByCat.get(cat) ?? [];
      if (items.length > 0) rows.push({ id: `sr-${cat}`, title: cat, items });
    }
    if (rows.length === 0 && seriesList.length > 0) rows.push({ id: 'sr-all', title: 'Todas las series', items: seriesList });
    return rows;
  }, [activeTab, seriesList, searchQuery]);

  const channelRows = useMemo(() => {
    if (activeTab !== 'channels') return [];
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      const results = allChannels.filter(ch => ch.name.toLowerCase().includes(q));
      return [{ id: 'search', title: `Resultados: "${searchQuery}"`, items: results }];
    }
    const rows: Array<{ id: string; title: string; items: typeof allChannels }> = [];
    const catOrder = categoriesFromApi.length > 0 ? categoriesFromApi : [...channelsByCategory.keys()].filter(c => c !== 'Sin categoría');
    for (const cat of catOrder) {
      const items = channelsByCategory.get(cat);
      if (items && items.length > 0) rows.push({ id: `ch-${cat}`, title: cat, items });
    }
    const uncategorized = channelsByCategory.get('Sin categoría');
    if (uncategorized && uncategorized.length > 0) rows.push({ id: 'ch-sincat', title: 'Sin categoría', items: uncategorized });
    if (rows.length === 0 && allChannels.length > 0) rows.push({ id: 'ch-all', title: 'Todos los canales', items: allChannels });
    return rows;
  }, [activeTab, allChannels, categoriesFromApi, channelsByCategory, searchQuery]);

  const activeRows = useMemo(() => {
    if (activeTab === 'channels') {
      // Return a single flat row matching exactly what the grid renders.
      // This ensures rowIndex stays at 0 and colIndex maps 1:1 to the visible grid items.
      const flatItems = selectedChannelCategory
        ? (channelRows.find(r => r.title === selectedChannelCategory)?.items ?? [])
        : channelRows.flatMap(r => r.items);
      return [{ id: 'channels-flat', title: 'Canales', emoji: '📺', items: flatItems as ContentItem[] }];
    }
    if (activeTab === 'series') return seriesRows.map(r => ({ id: r.id, title: r.title, emoji: '🎬', items: r.items as unknown as ContentItem[] }));
    return contentRows;
  }, [activeTab, channelRows, seriesRows, contentRows, selectedChannelCategory]);

  useEffect(() => { setRowIndex(0); setColIndex(0); setSelectedChannelCategory(null); setRowsFocusActive(false); }, [activeTab, searchQuery]);
  useEffect(() => {
    if (zone === 'hero') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } else if (zone === 'rows' && rowRefs.current[rowIndex]) {
      rowRefs.current[rowIndex]?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, [rowIndex, zone]);
  useEffect(() => {
    if (zone !== 'rows') return;
    const el = document.querySelector('[data-tv-focused="true"]') as HTMLElement | null;
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'center' });
  }, [rowIndex, colIndex, zone]);

  useEffect(() => {
    if (externalSearchRef.current) clearTimeout(externalSearchRef.current);
    const q = searchQuery.trim();
    if (!q || q.length < 2 || activeTab === 'channels' || activeTab === 'favorites') {
      setYtResults([]);
      setArchiveResults([]);
      setExternalSearchLoading(false);
      return;
    }
    if (ADULT_RE.test(q)) {
      setYtResults([]);
      setArchiveResults([]);
      setExternalSearchLoading(false);
      return;
    }
    setExternalSearchLoading(true);
    externalSearchRef.current = setTimeout(async () => {
      addSearchHistory(q);
      setSearchHistory(getSearchHistory());
      const token = getToken('user') || getToken('admin') || '';
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      try {
        const typeParam = '&type=movie';
        const [ytRes, archRes] = await Promise.allSettled([
          fetch(`${apiBase}/api/user-search/youtube?q=${encodeURIComponent(q)}${typeParam}`, { headers }).then(r => r.ok ? r.json() : { items: [] }),
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
    return () => { if (externalSearchRef.current) clearTimeout(externalSearchRef.current); };
  }, [searchQuery, activeTab]);
  useEffect(() => { return subscribeMiniPlayer(() => { const s = getMiniPlayerState(); if (!s?.isMinimized) setZone(prev => prev === 'miniplayer' ? 'rows' : prev); }); }, []);

  const playItem = useCallback((item: ContentItem) => {
    if (isExpired) { setShowExpiredOverlay(true); return; }
    if ((item as any)._ytVideoId) {
      setExternalPlayer({ type: 'youtube', videoId: (item as any)._ytVideoId, title: (item as any).title ?? '', thumbnail: (item as any)._ytThumbnail });
      return;
    }
    if ((item as any)._archIdentifier) {
      const identifier = (item as any)._archIdentifier;
      setArchiveLoading(identifier);
      const token = getToken('user') || getToken('admin') || '';
      const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
      fetch(`${apiBase}/api/user-search/archive/video/${encodeURIComponent(identifier)}`, { headers })
        .then(r => r.json())
        .then(data => { if (data.url) setExternalPlayer({ type: 'archive', url: data.url, title: data.title || (item as any).title || '', thumbnail: (item as any)._archThumbnail }); })
        .finally(() => setArchiveLoading(null));
      return;
    }
    if (isChannel(item)) {
      const channelList = allChannels.map(ch => ({ id: ch.id, streamUrl: ch.streamUrl ?? '', name: ch.name }));
      const idx = allChannels.findIndex(ch => ch.id === item.id);
      setMiniPlayerState({ url: item.streamUrl ?? '', title: item.name, type: 'channel', movieId: null, channelId: item.id, streamFormat: (item as any).streamFormat ?? null, isMinimized: false, channels: channelList, channelIndex: idx >= 0 ? idx : 0 });
      setLocation(`/player?channelId=${item.id}&title=${encodeURIComponent(item.name)}&type=channel&url=${encodeURIComponent((item as any).streamUrl ?? '')}&format=${(item as any).streamFormat || ''}`);
    } else if ((item as any)._isSeries) {
      const token = getToken('user') || getToken('admin') || '';
      if (token) fetch(`${apiBase}/api/series/${item.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      setLocation(`/serie/${item.id}`);
    } else {
      const mv = item as MovieItem;
      const token = getToken('user') || getToken('admin') || '';
      if (token) fetch(`${apiBase}/api/movies/${mv.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      const url = mv.filePath ?? '';
      if (!url) { setLocation(`/pelicula/${mv.id}`); return; }
      const isYouTube = url.includes('youtube.com/') || url.includes('youtu.be/');
      if (isYouTube) {
        const ytMatch = url.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([^&\s?#]+)/);
        const videoId = ytMatch?.[1] ?? null;
        if (videoId) { setExternalPlayer({ type: 'youtube', videoId, title: mv.title, thumbnail: mv.poster ?? undefined }); return; }
      }
      const saved = progressMap.get(mv.id);
      const p = new URLSearchParams({ url, title: mv.title, type: 'movie', movieId: String(mv.id), category: mv.category || '' });
      if ((mv as any).videoFormat) p.set('format', (mv as any).videoFormat);
      if (saved && saved.time > 10) p.set('startFrom', String(Math.floor(saved.time)));
      setLocation(`/vod-player?${p.toString()}`);
    }
  }, [setLocation, isExpired, allChannels, progressMap]);

  const playSeriesItem = useCallback((series: SeriesItem) => {
    if (isExpired) { setShowExpiredOverlay(true); return; }
    const token = getToken('user') || getToken('admin') || '';
    if (token) fetch(`${apiBase}/api/series/${series.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
    setLocation(`/serie/${series.id}`);
  }, [setLocation, isExpired]);

  const playHeroBannerItem = useCallback((item: HeroBannerItem) => {
    if (isExpired) { setShowExpiredOverlay(true); return; }
    const token = getToken('user') || getToken('admin') || '';
    if (item.type === 'series') {
      if (token) fetch(`${apiBase}/api/series/${item.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      setLocation(`/serie/${item.id}`);
    } else {
      if (token) fetch(`${apiBase}/api/movies/${item.id}/view`, { method: 'POST', headers: { Authorization: `Bearer ${token}` } }).catch(() => {});
      // Go directly to the player if we have a stream URL
      if (item.streamUrl) {
        const params = new URLSearchParams({
          url: item.streamUrl,
          title: item.title,
          type: 'movie',
          movieId: String(item.id),
          ...(item.category ? { category: item.category } : {}),
          ...(item.streamFormat ? { format: item.streamFormat } : {}),
        });
        setLocation(`/vod-player?${params.toString()}`);
      } else {
        setLocation(`/pelicula/${item.id}`);
      }
    }
  }, [setLocation, isExpired]);

  const openProfile = useCallback(() => setShowProfile(true), []);

  const handleSaveProfile = async (name: string, avatarId: number | null) => {
    await updateProfileMutation.mutateAsync({ data: { displayName: name.trim() || null, avatarId } });
    await queryClient.invalidateQueries({ queryKey: getGetMeQueryKey() });
    setShowProfile(false);
  };

  const showExpiryBanner = session?.type === 'user' && daysLeft !== null && daysLeft > 0 && daysLeft <= 3 && !expiryBannerDismissed;
  const dismissExpiryBanner = () => { try { localStorage.setItem('supertv_expiry_dismissed', new Date().toDateString()); } catch {} setExpiryBannerDismissed(true); };

  const refreshUserData = useCallback(() => { setFavorites(getFavorites()); setAllProgress(getAllProgress()); setWatchHistory(getHistory()); setExternalFavs(getExternalFavorites()); setExternalHistory(getExternalHistory()); }, []);
  useEffect(() => { window.addEventListener('focus', refreshUserData); return () => window.removeEventListener('focus', refreshUserData); }, [refreshUserData]);

  const openSidebarHover = useCallback(() => {
    if (sidebarHoverTimerRef.current) clearTimeout(sidebarHoverTimerRef.current);
    setSidebarMouseOpen(true);
  }, []);

  const closeSidebarHover = useCallback(() => {
    sidebarHoverTimerRef.current = setTimeout(() => setSidebarMouseOpen(false), 180);
  }, []);

  const doToggleFav = useCallback((movieId: number) => { toggleFavorite(movieId); setFavorites(getFavorites()); }, []);
  const handleInfoItem = useCallback((item: ContentItem) => {
    if (!isChannel(item)) {
      const mv = item as MovieItem;
      setDetailMovie({ id: mv.id, title: mv.title, poster: mv.poster, description: mv.description, genre: mv.genre, year: mv.year, category: mv.category, duration: mv.duration });
    }
  }, []);
  const handleLogout = () => { clearTokens(); setLocation('/'); };
  const [apkMsg, setApkMsg] = useState<string | null>(null);
  const handleInstall = useCallback(async () => {
    try {
      const res = await fetch(`${apiBase}/api/apk/info`);
      const data = await res.json();
      if (data.available && data.url) {
        window.open(data.url, '_blank');
      } else {
        setApkMsg('No hay enlace de descarga disponible por el momento. El administrador aún no ha configurado el enlace.');
      }
    } catch {
      setApkMsg('No se pudo verificar la disponibilidad. Intenta de nuevo más tarde.');
    }
  }, []);
  const handleShortcut = () => { if (canInstall) { install(); return; } setShowShortcutHint(true); };

  const actionButtons = useMemo(() => [
    ...(session?.type === 'user' ? [{ key: 'profile', label: 'Mi perfil', action: openProfile, icon: UserCircle2 }] : []),
    { key: 'install', label: 'Instalar app para Android', action: handleInstall, icon: Download },
    { key: 'shortcut', label: 'Acceso directo', action: handleShortcut, icon: Smartphone },
    { key: 'logout', label: 'Salir', action: handleLogout, icon: LogOut },
  ], [session, showInstallButton, openProfile, handleInstall, handleLogout]);

  type SidebarItemEntry =
    | { kind: 'profile' }
    | { kind: 'search' }
    | { kind: 'mic' }
    | { kind: 'tab'; tabIdx: number; key: TabKey }
    | { kind: 'action'; key: string };

  const sidebarItems = useMemo((): SidebarItemEntry[] => {
    const items: SidebarItemEntry[] = [];
    if (session?.type === 'user') items.push({ kind: 'profile' });
    items.push({ kind: 'search' });
    if (voiceSupported) items.push({ kind: 'mic' });
    navItems.forEach((item, i) => items.push({ kind: 'tab', tabIdx: i, key: item.key }));
    actionButtons.filter(b => b.key !== 'profile').forEach(btn => items.push({ kind: 'action', key: btn.key }));
    return items;
  }, [session, voiceSupported, navItems, actionButtons]);

  const showSidebar = zone === 'sidebar' || sidebarMouseOpen;

  useEffect(() => {
    if (zone !== 'sidebar') return;
    const si = sidebarItems[sidebarIdx];
    if (si?.kind === 'tab') {
      startTransition(() => { setActiveTab(si.key); setTabIndex(si.tabIdx); });
    }
  }, [sidebarIdx, zone]); // eslint-disable-line react-hooks/exhaustive-deps

  const isLoading = channelsLoading || moviesLoading || ((activeTab === 'series' || activeTab === 'home') && seriesLoading);
  const showHero = !searchQuery && heroBannerItems.length > 0 && activeTab !== 'channels';

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const nk = normalizeKey(e);
      const isBack = nk === 'Escape' || e.key === 'Backspace';

      // TV remote back button — close any open overlay/modal first
      if (isBack) {
        if (apkMsg) { e.preventDefault(); setApkMsg(null); return; }
        if (showShortcutHint) { e.preventDefault(); setShowShortcutHint(false); return; }
        if (showHint) { e.preventDefault(); setShowHint(false); return; }
        if (sidebarMouseOpen || zone === 'sidebar') { e.preventDefault(); setSidebarMouseOpen(false); setZone('rows'); return; }
      }

      if (showProfile || showHint || showShortcutHint) return;

      const activeEl = document.activeElement;
      const isInputFocused = activeEl instanceof HTMLInputElement || activeEl instanceof HTMLTextAreaElement || (activeEl instanceof HTMLElement && activeEl.isContentEditable);
      if (isInputFocused) {
        if (['Escape','Enter','ArrowUp','ArrowDown'].includes(e.key)) {
          e.preventDefault();
          (activeEl as HTMLElement).blur();
          setZone('rows');
          setRowIndex(0);
          setColIndex(0);
        }
        return;
      }

      // Blur any focused button/link so arrow keys always reach our handler
      if (['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)) {
        if (inputModeRef.current !== 'keyboard') { inputModeRef.current = 'keyboard'; setInputMode('keyboard'); }
        if (activeEl && activeEl !== document.body && (activeEl as HTMLElement).blur) {
          (activeEl as HTMLElement).blur();
        }
      }

      const goToSidebar = () => {
        const idx = sidebarItems.findIndex(it => it.kind === 'tab' && it.key === activeTab);
        setSidebarIdx(idx >= 0 ? idx : 0);
        setZone('sidebar');
        setSidebarMouseOpen(true);
      };

      if (zone === 'sidebar') {
        switch (normalizeKey(e)) {
          case 'ArrowDown':
            e.preventDefault();
            setSidebarIdx(p => Math.min(p + 1, sidebarItems.length - 1));
            break;
          case 'ArrowUp':
            e.preventDefault();
            setSidebarIdx(p => Math.max(p - 1, 0));
            break;
          case 'ArrowRight': {
            e.preventDefault();
            const si = sidebarItems[sidebarIdx];
            if (si?.kind === 'tab') {
              startTransition(() => { setActiveTab(si.key); setTabIndex(si.tabIdx); });
              setSearchQuery(''); setSearchInput('');
              setRowIndex(0); setColIndex(0);
              setSidebarMouseOpen(false); setZone('rows');
            } else if (showHero) { setZone('hero'); setHeroBtnIndex(0); }
            else { setSidebarMouseOpen(false); setZone('rows'); setRowIndex(0); setColIndex(0); }
            break;
          }
          case 'Enter': {
            e.preventDefault();
            const si = sidebarItems[sidebarIdx];
            if (!si) break;
            if (si.kind === 'profile') {
              openProfile(); setSidebarMouseOpen(false); setZone('rows');
            } else if (si.kind === 'search') {
              if (searchQuery.trim()) {
                setSidebarMouseOpen(false); setZone('rows'); setRowIndex(0); setColIndex(0);
              } else {
                openKeyboard(searchRef.current, { value: searchInput, onChange: (v) => { setSearchQuery(v); setSearchInput(v); setRowIndex(0); setColIndex(0); }, label: 'Buscar...' });
              }
            } else if (si.kind === 'mic') {
              isListening ? stopListening() : startListening();
            } else if (si.kind === 'tab') {
              startTransition(() => { setActiveTab(si.key); setTabIndex(si.tabIdx); });
              setSearchQuery(''); setSearchInput('');
              setRowIndex(0); setColIndex(0);
              setSidebarMouseOpen(false); setZone('rows');
            } else if (si.kind === 'action') {
              const btn = actionButtons.find(b => b.key === si.key);
              if (btn) btn.action();
            }
            break;
          }
          case 'Escape': case 'Backspace':
            e.preventDefault();
            setSidebarMouseOpen(false); setZone('rows');
            break;
        }

      } else if (zone === 'hero') {
        switch (normalizeKey(e)) {
          case 'ArrowLeft':
            e.preventDefault();
            if (heroBtnIndex > 0) setHeroBtnIndex(0);
            else goToSidebar();
            break;
          case 'ArrowRight':
            e.preventDefault();
            if (heroBtnIndex < 1) setHeroBtnIndex(1);
            else { setZone('rows'); setRowIndex(0); setColIndex(0); setRowsFocusActive(true); }
            break;
          case 'ArrowDown':
            e.preventDefault();
            setZone('rows'); setRowIndex(0); setColIndex(0); setRowsFocusActive(true);
            break;
          case 'ArrowUp':
            e.preventDefault();
            break;
          case 'MediaPlayPause':
          case 'Enter': {
            e.preventDefault();
            const heroItem = hoveredHero ?? heroBannerItems[heroBannerIdx] ?? heroBannerItems[0];
            if (heroItem) {
              if (heroBtnIndex === 0) playHeroBannerItem(heroItem);
              else { if (heroItem.type === 'series') setLocation(`/serie/${heroItem.id}`); else setLocation(`/pelicula/${heroItem.id}`); }
            }
            break;
          }
          case 'Escape': case 'Backspace':
            e.preventDefault();
            setZone('rows'); setRowIndex(0); setColIndex(0); setRowsFocusActive(true);
            break;
        }

      } else if (zone === 'miniplayer') {
        const mini = getMiniPlayerState();
        if (!mini?.isMinimized) { setZone('rows'); return; }
        switch (normalizeKey(e)) {
          case 'ArrowLeft': {
            e.preventDefault();
            if (mini.channels.length > 0) {
              const newIdx = (mini.channelIndex - 1 + mini.channels.length) % mini.channels.length;
              const ch = mini.channels[newIdx];
              const { url, streamFormat } = buildMiniProxyUrl(ch);
              updateMiniPlayerState({ url, title: ch.name, channelIndex: newIdx, streamFormat });
              window.dispatchEvent(new CustomEvent('supertv:mini-flash-osd'));
            }
            break;
          }
          case 'ArrowRight': {
            e.preventDefault();
            if (mini.channels.length > 0) {
              const newIdx = (mini.channelIndex + 1) % mini.channels.length;
              const ch = mini.channels[newIdx];
              const { url, streamFormat } = buildMiniProxyUrl(ch);
              updateMiniPlayerState({ url, title: ch.name, channelIndex: newIdx, streamFormat });
              window.dispatchEvent(new CustomEvent('supertv:mini-flash-osd'));
            }
            break;
          }
          case 'Enter': e.preventDefault(); updateMiniPlayerState({ isFocused: false }); window.dispatchEvent(new CustomEvent('supertv:mini-maximize')); setZone('rows'); break;
          case 'Backspace': case 'Delete': e.preventDefault(); updateMiniPlayerState({ isFocused: false }); window.dispatchEvent(new CustomEvent('supertv:mini-close')); setZone('rows'); break;
          case 'Escape': case 'ArrowUp': case 'ArrowDown': e.preventDefault(); updateMiniPlayerState({ isFocused: false }); setZone('rows'); break;
        }

      } else if (zone === 'catfilter') {
        // category filter pills navigation (channels tab only)
        const totalPills = channelRows.length + 1; // Todos + one per category
        switch (normalizeKey(e)) {
          case 'ArrowRight':
            e.preventDefault();
            setCatFilterIdx(p => Math.min(p + 1, totalPills - 1));
            break;
          case 'ArrowLeft':
            e.preventDefault();
            setCatFilterIdx(p => Math.max(p - 1, 0));
            break;
          case 'Enter': {
            e.preventDefault();
            if (catFilterIdx === 0) {
              setSelectedChannelCategory(null);
            } else {
              const cat = channelRows[catFilterIdx - 1]?.title ?? null;
              setSelectedChannelCategory(cat);
            }
            setZone('rows'); setRowIndex(0); setColIndex(0); setRowsFocusActive(true);
            break;
          }
          case 'ArrowDown':
            e.preventDefault();
            setZone('rows'); setRowIndex(0); setColIndex(0); setRowsFocusActive(true);
            break;
          case 'ArrowUp':
          case 'Escape':
            e.preventDefault();
            if (showHero) { setZone('hero'); setHeroBtnIndex(0); }
            break;
        }

      } else {
        // rows zone
        const currentRow = activeRows[rowIndex];
        const currentLen = currentRow?.items?.length ?? 0;
        switch (normalizeKey(e)) {
          case 'ArrowRight':
            e.preventDefault();
            setRowsFocusActive(true);
            setColIndex(p => Math.min(p + 1, currentLen - 1));
            break;
          case 'ArrowLeft': {
            e.preventDefault();
            setRowsFocusActive(true);
            const gridColsLeft = activeTab === 'channels'
              ? getChannelGridCols()
              : isGridRow(currentRow?.id ?? '') ? getSearchGridCols() : null;
            const atLeftEdge = colIndex === 0 || (gridColsLeft !== null && colIndex % gridColsLeft === 0);
            if (atLeftEdge) goToSidebar();
            else setColIndex(p => Math.max(p - 1, 0));
            break;
          }
          case 'ArrowDown': {
            e.preventDefault();
            setRowsFocusActive(true);
            const gridColsDown = activeTab === 'channels'
              ? getChannelGridCols()
              : isGridRow(currentRow?.id ?? '') ? getSearchGridCols() : null;
            if (gridColsDown !== null) {
              const newCol = colIndex + gridColsDown;
              if (newCol < currentLen) {
                setColIndex(newCol);
              } else if (rowIndex < activeRows.length - 1) {
                setRowIndex(p => p + 1); setColIndex(0);
              } else {
                const _mini = getMiniPlayerState();
                if (_mini?.isMinimized) { updateMiniPlayerState({ isFocused: true }); setZone('miniplayer'); }
              }
            } else {
              if (rowIndex < activeRows.length - 1) { setRowIndex(p => p + 1); setColIndex(0); }
              else { const _mini = getMiniPlayerState(); if (_mini?.isMinimized) { updateMiniPlayerState({ isFocused: true }); setZone('miniplayer'); } }
            }
            break;
          }
          case 'ArrowUp': {
            e.preventDefault();
            setRowsFocusActive(true);
            const gridColsUp = activeTab === 'channels'
              ? getChannelGridCols()
              : isGridRow(currentRow?.id ?? '') ? getSearchGridCols() : null;
            if (gridColsUp !== null) {
              const newCol = colIndex - gridColsUp;
              if (newCol >= 0) {
                setColIndex(newCol);
              } else if (rowIndex > 0) {
                setRowIndex(p => p - 1); setColIndex(0);
              } else if (activeTab === 'channels' && channelRows.length > 1 && !searchQuery) {
                const curIdx = selectedChannelCategory === null ? 0 : (channelRows.findIndex(r => r.title === selectedChannelCategory) + 1);
                setCatFilterIdx(Math.max(0, curIdx));
                setZone('catfilter');
              } else {
                if (showHero) { setZone('hero'); setHeroBtnIndex(0); }
              }
            } else {
              if (rowIndex > 0) { setRowIndex(p => p - 1); setColIndex(0); }
              else if (showHero) { setZone('hero'); setHeroBtnIndex(0); }
            }
            break;
          }
          case 'MediaPlayPause':
          case 'Enter': {
            e.preventDefault();
            if (activeTab === 'series') {
              const item = seriesRows[rowIndex]?.items[colIndex];
              if (item) playSeriesItem(item);
            } else {
              const item = currentRow?.items[colIndex];
              if (item) playItem(item);
            }
            break;
          }
          case 'Escape': case 'Backspace': e.preventDefault(); break;
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown, { capture: true });
    return () => window.removeEventListener('keydown', handleKeyDown, { capture: true });
  }, [zone, sidebarIdx, sidebarItems, rowIndex, colIndex, rowsFocusActive, heroBtnIndex, heroBannerIdx, activeRows, seriesRows, activeTab, playItem, playSeriesItem, actionButtons, showProfile, showHint, showShortcutHint, isListening, startListening, stopListening, showHero, hoveredHero, heroBannerItems, openKeyboard, searchQuery, openProfile, catFilterIdx, channelRows, selectedChannelCategory, apkMsg, sidebarMouseOpen]);  // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="min-h-screen bg-background text-white flex select-none" onMouseMove={() => { if (inputModeRef.current !== 'mouse') { inputModeRef.current = 'mouse'; setInputMode('mouse'); } }}>

      {/* ── EXPIRED OVERLAY ── */}
      {isExpired && showExpiredOverlay && (
        <div className="fixed inset-0 z-[200] bg-background flex flex-col items-center justify-center gap-6 text-center px-6" onClick={() => setShowExpiredOverlay(false)}>
          <button onClick={e => { e.stopPropagation(); setShowExpiredOverlay(false); }} className="absolute top-4 right-4 p-2 rounded-full hover:bg-white/10 transition-colors text-white/50 hover:text-white"><X className="w-5 h-5" /></button>
          <div className="flex flex-col items-center gap-4" onClick={e => e.stopPropagation()}>
            <div className="w-20 h-20 rounded-full bg-destructive/15 flex items-center justify-center"><Lock className="w-10 h-10 text-destructive" /></div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-white">Acceso vencido</h2>
              <p className="text-white/50 max-w-xs">Tu código venció. Para renovarlo, contacta a tu proveedor.</p>
            </div>
          </div>
          <button onClick={e => { e.stopPropagation(); handleLogout(); }} className="text-sm text-white/40 hover:text-white transition-colors underline underline-offset-4">Cerrar sesión</button>
        </div>
      )}

      {/* ── NARROW ICON RAIL (desktop, always visible) ── */}
      <div
        className="hidden md:flex fixed left-0 top-0 h-full z-50 w-16 bg-background border-r border-white/5 flex-col items-center py-4 gap-1"
      >
        <div className="mb-3 flex items-center justify-center w-10 h-10">
          <img src={logo} alt="Super TV" className="h-7 w-auto object-contain" />
        </div>
        <div className="w-8 h-px bg-white/8 mb-1" />
        {navItems.map((item, i) => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => { setSidebarMouseOpen(true); setZone('sidebar'); const idx = sidebarItems.findIndex(it => it.kind === 'tab' && it.key === item.key); setSidebarIdx(idx >= 0 ? idx : i); }}
              title={item.label}
              className={`w-10 h-10 flex items-center justify-center rounded-xl transition-all duration-150
                ${isActive ? 'bg-white/10 text-white' : 'text-white/35 hover:text-white hover:bg-white/8'}`}
            >
              <Icon className={`w-5 h-5 ${isActive ? 'text-primary' : ''}`} />
            </button>
          );
        })}
        <div className="flex-1" />
        <button
          onClick={() => { setSidebarMouseOpen(true); setZone('sidebar'); }}
          title="Buscar"
          className="w-10 h-10 flex items-center justify-center rounded-xl text-white/35 hover:text-white hover:bg-white/8 transition-all"
        >
          <Search className="w-5 h-5" />
        </button>
        {session?.type === 'user' && (
          <button
            onClick={() => openProfile()}
            title={session.displayName || 'Perfil'}
            className="w-10 h-10 flex items-center justify-center rounded-xl text-white/35 hover:text-white hover:bg-white/8 transition-all"
          >
            <div className="w-7 h-7 rounded-full overflow-hidden border border-white/15 flex items-center justify-center bg-white/8">
              {session.avatarUrl
                ? <img src={session.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                : <UserCircle2 className="w-4 h-4 text-white/40" />
              }
            </div>
          </button>
        )}
        <button
          onClick={handleLogout}
          title="Salir"
          className="w-10 h-10 flex items-center justify-center rounded-xl text-white/25 hover:text-red-400 hover:bg-red-500/10 transition-all mb-1"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>

      {/* ── FULL SIDEBAR OVERLAY ── */}
      {showSidebar && <div className="fixed inset-0 z-[340] bg-black/60 backdrop-blur-sm" onClick={() => { setSidebarMouseOpen(false); setZone('rows'); }} />}
      <aside
        className={`fixed left-0 top-0 h-full z-[350] bg-background border-r border-white/8 flex flex-col transition-all duration-300 w-72 shadow-2xl
          ${showSidebar ? 'translate-x-0' : '-translate-x-full'}`}
      >

        {/* Logo */}
        <div className="p-5 pb-4 flex items-center justify-between">
          <img src={lettersLogo} alt="Super TV" className="h-10 w-auto object-contain" style={{ filter: 'drop-shadow(0 0 8px rgba(255,255,255,0.08))' }} />
          <button className="p-1.5 rounded-lg hover:bg-white/10 text-white/50" onClick={() => { setSidebarMouseOpen(false); setZone('rows'); }}>
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* User info */}
        {session?.type === 'user' && (
          <button onClick={() => { openProfile(); setSidebarMouseOpen(false); setZone('rows'); }} className={`mx-3 mb-3 flex items-center gap-3 p-3 rounded-xl hover:bg-white/8 transition-colors text-left ${zone === 'sidebar' && sidebarItems[sidebarIdx]?.kind === 'profile' ? 'ring-2 ring-primary bg-white/8' : ''}`}>
            <div className="w-10 h-10 rounded-full overflow-hidden border-2 border-white/20 flex-shrink-0 bg-white/10 flex items-center justify-center">
              {session.avatarUrl
                ? <img src={session.avatarUrl} alt="Avatar" className="w-full h-full object-cover" />
                : <UserCircle2 className="w-6 h-6 text-white/50" />
              }
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold text-white truncate">{session.displayName || session.codeName || 'Usuario'}</p>
              {session.expiresAt && (
                <p className="text-[10px] text-white/40 truncate">Vence: {(() => { const d = new Date(session.expiresAt!); const m = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic']; return `${d.getDate()} ${m[d.getMonth()]} ${d.getFullYear()}`; })()}</p>
              )}
            </div>
          </button>
        )}

        {/* Search + voice — combined, below user */}
        <div className="px-3 pb-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-white/30 pointer-events-none" />
            <input
              ref={searchRef}
              value={searchInput}
              onChange={e => { setSearchQuery(e.target.value); setSearchInput(e.target.value); setRowIndex(0); setColIndex(0); }}
              onFocus={() => { setZone('sidebar'); const idx = sidebarItems.findIndex(it => it.kind === 'search'); if (idx >= 0) setSidebarIdx(idx); }}
              onKeyDown={e => { if (e.key === 'Enter' && searchQuery.trim()) { e.preventDefault(); e.stopPropagation(); setSearchInput(''); setSidebarMouseOpen(false); setZone('rows'); setRowIndex(0); setColIndex(0); (e.target as HTMLInputElement).blur(); } }}
              placeholder={searchPlaceholder}
              className={`w-full bg-white/7 border border-white/10 rounded-xl pl-9 ${voiceSupported ? 'pr-9' : 'pr-4'} py-2.5 text-sm text-white placeholder:text-white/30 focus:outline-none focus:border-white/20 transition-colors ${zone === 'sidebar' && sidebarItems[sidebarIdx]?.kind === 'search' ? 'border-white/25 bg-white/10' : ''} ${isListening ? 'border-red-500/50' : ''}`}
            />
            {(searchQuery || searchInput)
              ? <button onClick={() => { setSearchQuery(''); setSearchInput(''); }} className="absolute right-3 top-1/2 -translate-y-1/2 text-white/30 hover:text-white"><X className="w-3.5 h-3.5" /></button>
              : voiceSupported && (
                <button onClick={() => isListening ? stopListening() : startListening()}
                  className={`absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded-lg transition-colors
                    ${isListening ? 'text-red-400 bg-red-500/15' : 'text-white/35 hover:text-white hover:bg-white/10'}
                    ${zone === 'sidebar' && sidebarItems[sidebarIdx]?.kind === 'mic' ? 'ring-2 ring-primary text-white bg-white/10' : ''}`}>
                  {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
                </button>
              )
            }
          </div>
          {voiceError && <p className="text-[10px] text-red-400 mt-1 px-1">{voiceError}</p>}
        </div>

        <div className="mx-3 mb-3 h-px bg-white/8" />

        {/* Nav items */}
        <nav className="px-3 space-y-1">
          {navItems.map((item, i) => {
            const Icon = item.icon;
            const isActive = activeTab === item.key;
            const isFocused = inputMode === 'keyboard' && zone === 'sidebar' && sidebarItems[sidebarIdx]?.kind === 'tab' && (sidebarItems[sidebarIdx] as { kind: 'tab'; tabIdx: number; key: TabKey }).tabIdx === i;
            return (
              <button
                key={item.key}
                onClick={() => { setSidebarMouseOpen(false); setZone('rows'); startTransition(() => { setActiveTab(item.key); setTabIndex(i); setSearchQuery(''); setSearchInput(''); setRowIndex(0); setColIndex(0); }); }}
                className={`w-full flex items-center gap-3.5 px-4 py-3 rounded-xl text-sm font-medium transition-all duration-150
                  ${isActive ? 'bg-white/12 text-white' : 'text-white/55 hover:text-white hover:bg-white/7'}
                  ${isFocused ? 'ring-2 ring-primary/60' : ''}`}
              >
                <Icon className={`w-5 h-5 flex-shrink-0 transition-colors ${isActive ? 'text-primary' : ''}`} />
                {item.label}
                {isActive && <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />}
              </button>
            );
          })}
        </nav>

        <div className="mx-3 my-3 h-px bg-white/8" />

        {/* Actions */}
        <div className="px-3 pb-5 space-y-0.5">
          {actionButtons.filter(b => b.key !== 'profile').map((btn) => {
            const Icon = btn.icon;
            const isLogout = btn.key === 'logout';
            const isFocused = inputMode === 'keyboard' && zone === 'sidebar' && sidebarItems[sidebarIdx]?.kind === 'action' && (sidebarItems[sidebarIdx] as { kind: 'action'; key: string }).key === btn.key;
            return (
              <button key={btn.key} onClick={btn.action} className={`w-full flex items-center gap-3.5 px-4 py-2.5 rounded-xl text-sm font-medium transition-all ${isLogout ? 'text-white/35 hover:text-red-400 hover:bg-red-500/10' : 'text-white/45 hover:text-white hover:bg-white/7'} ${isFocused ? (isLogout ? 'ring-2 ring-red-400/60 text-red-400 bg-red-500/10' : 'ring-2 ring-primary/60 text-white bg-white/10') : ''}`}>
                <Icon className="w-4 h-4 flex-shrink-0" />
                {btn.label}
              </button>
            );
          })}
        </div>
      </aside>

      {/* ── MAIN CONTENT ── */}
      <main className="flex-1 min-h-screen flex flex-col pb-16 md:pb-0 overflow-x-hidden md:ml-16" ref={mainRef}>

        {/* Mobile top bar */}
        <div className="md:hidden sticky top-0 z-30 flex items-center gap-3 px-4 py-3 bg-background border-b border-white/5">
          <button onClick={() => { setSidebarMouseOpen(true); setZone('sidebar'); }} className="p-2 rounded-lg hover:bg-white/10 text-white/60 hover:text-white transition-colors">
            <Menu className="w-5 h-5" />
          </button>
          <img src={lettersLogo} alt="Super TV" className="h-5 w-auto object-contain flex-shrink-0" style={{ mixBlendMode: 'screen' }} />
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-white/30 pointer-events-none" />
            <input
              value={searchInput}
              onChange={e => { setSearchQuery(e.target.value); setSearchInput(e.target.value); setRowIndex(0); setColIndex(0); }}
              placeholder={searchPlaceholder}
              className="w-full bg-white/7 border border-white/10 rounded-lg pl-8 pr-3 py-1.5 text-xs text-white placeholder:text-white/30 focus:outline-none focus:border-white/20"
            />
          </div>
        </div>

        {/* Expiry warning */}
        {showExpiryBanner && (
          <div className={`flex items-center gap-3 px-5 py-2.5 text-sm font-medium ${daysLeft !== null && daysLeft <= 0 ? 'bg-red-600/20 text-red-300' : daysLeft === 1 ? 'bg-primary/15 text-primary/80' : 'bg-primary/10 text-primary/70'}`}>
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            <span className="flex-1 text-xs">{daysLeft !== null && daysLeft <= 0 ? 'Tu código venció. Contacta a tu proveedor para activarlo.' : daysLeft === 1 ? 'Tu acceso vence hoy. Renueva con tu proveedor.' : `Tu acceso vence en ${daysLeft} días.`}</span>
            <button onClick={dismissExpiryBanner} className="flex-shrink-0 opacity-60 hover:opacity-100"><X className="w-4 h-4" /></button>
          </div>
        )}

        {/* Hero Banner */}
        {showHero && (
          <div className="relative">
            <HeroBanner
              items={heroBannerItems}
              overrideItem={hoveredHero}
              onPlay={playHeroBannerItem}
              onInfo={item => item.type === 'series' ? setLocation(`/serie/${item.id}`) : setLocation(`/pelicula/${item.id}`)}
              focusedBtnIndex={inputMode === 'keyboard' && zone === 'hero' ? heroBtnIndex : null}
              currentIndex={heroBannerIdx}
              onCurrentChange={setHeroBannerIdx}
            />
            <div className="absolute bottom-0 left-0 right-0 h-20 bg-gradient-to-t from-background to-transparent pointer-events-none z-10" />
          </div>
        )}

        {/* Content area */}
        {isLoading ? (
          <div className="px-4 sm:px-6 py-6 space-y-8">
            {activeTab === 'channels' ? (
              <div className="space-y-6">
                {[1,2,3].map(i => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="h-5 w-32 rounded bg-white/5" />
                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-2">
                      {Array.from({ length: 16 }).map((_, j) => <Skeleton key={j} className="aspect-square rounded-xl bg-white/5" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="space-y-8">
                {[1,2,3].map(i => (
                  <div key={i} className="space-y-3">
                    <Skeleton className="h-5 w-40 rounded bg-white/5" />
                    <div className="flex gap-3 overflow-hidden">
                      {Array.from({ length: 6 }).map((_, j) => <div key={j} className="flex-shrink-0 w-44 space-y-2"><Skeleton className="aspect-video rounded-xl bg-white/5" /><Skeleton className="h-3 w-3/4 rounded bg-white/5" /></div>)}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : activeTab === 'channels' ? (
          <div className="px-4 sm:px-6 py-6 space-y-6">
            {channelRows.length === 0 ? (
              <div className="py-20 text-center text-white/30"><Tv className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="text-lg">Sin canales disponibles</p></div>
            ) : (
              <>
                {/* Category filter pills */}
                {channelRows.length > 1 && !searchQuery && (
                  <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide -mx-1 px-1">
                    <button
                      onClick={() => { setSelectedChannelCategory(null); setCatFilterIdx(0); }}
                      className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150
                        ${selectedChannelCategory === null ? 'bg-primary text-white shadow-[0_0_10px_rgba(220,38,38,0.4)]' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/90'}
                        ${zone === 'catfilter' && catFilterIdx === 0 ? 'ring-2 ring-white scale-105' : ''}`}
                    >
                      Todos
                    </button>
                    {channelRows.map((row, i) => (
                      <button
                        key={row.id}
                        onClick={() => { setSelectedChannelCategory(row.title); setCatFilterIdx(i + 1); }}
                        className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-medium transition-all duration-150
                          ${selectedChannelCategory === row.title ? 'bg-primary text-white shadow-[0_0_10px_rgba(220,38,38,0.4)]' : 'bg-white/10 text-white/60 hover:bg-white/20 hover:text-white/90'}
                          ${zone === 'catfilter' && catFilterIdx === i + 1 ? 'ring-2 ring-white scale-105' : ''}`}
                      >
                        {row.title}
                        <span className="ml-1.5 text-[10px] opacity-60">{row.items.length}</span>
                      </button>
                    ))}
                  </div>
                )}

                {/* Flat channel grid — ContentCard style matching movies */}
                <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 2xl:grid-cols-7 gap-3">
                  {(selectedChannelCategory
                    ? (channelRows.find(r => r.title === selectedChannelCategory)?.items ?? [])
                    : channelRows.flatMap(r => r.items)
                  ).map((ch, cIdx) => (
                    <ContentCard
                      key={ch.id}
                      title={ch.name}
                      image={ch.logo ?? null}
                      isChannel
                      isFocused={inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === 0 && colIndex === cIdx}
                        disableHover={inputMode === 'keyboard'}
                      onClick={() => playItem(ch as ContentItem)}
                    />
                  ))}
                </div>
              </>
            )}
          </div>
        ) : activeTab === 'series' ? (
          <div className="px-4 sm:px-6 py-5 space-y-6">
            {seriesRows.length === 0 && !searchQuery ? (
              <div className="py-20 text-center text-white/30"><Tv2 className="w-12 h-12 mx-auto mb-3 opacity-20" /><p className="text-lg">No hay series disponibles</p></div>
            ) : (
              <>
                {seriesRows.map((row, rIdx) => (
                  <section key={row.id} ref={(el) => { rowRefs.current[rIdx] = el; }}>
                    <div className="flex items-center gap-3 mb-3">
                      <h2 className="text-sm sm:text-base font-semibold text-white/70">{row.title}</h2>
                      <span className="text-xs text-white/25">{row.items.length}</span>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                      {row.items.map((s, cIdx) => (
                        <SeriesCard
                          key={s.id}
                          series={s}
                          onClick={() => playSeriesItem(s)}
                          focused={inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === rIdx && colIndex === cIdx}
                          onHover={inputMode !== 'keyboard' ? () => setHoveredHero({ id: s.id, title: s.title, description: s.description, banner: s.banner, poster: s.poster, category: s.category, genre: s.genre, year: s.year, type: 'series' }) : undefined}
                          onHoverEnd={inputMode !== 'keyboard' ? () => setHoveredHero(null) : undefined}
                        />
                      ))}
                    </div>
                  </section>
                ))}

                {/* ── EXTERNAL SEARCH SECTIONS for series ── */}
                {searchQuery.trim().length >= 2 && (
                  <>
                    <section>
                      <div className="flex items-center gap-3 mb-3">
                        <span className="text-base">🎬</span>
                        <h2 className="text-sm sm:text-base font-semibold text-white/70">Más resultados</h2>
                        {externalSearchLoading && <span className="text-[10px] text-white/30 animate-pulse">Buscando...</span>}
                        {!externalSearchLoading && ytResults.length === 0 && <span className="text-xs text-white/20">Sin resultados</span>}
                        {!externalSearchLoading && ytResults.length > 0 && <span className="text-xs text-white/25">{ytResults.length}</span>}
                      </div>
                      {ytResults.length > 0 && (
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                          {ytResults.map((item) => (
                            <ContentCard
                              key={item.videoId}
                              title={item.title}
                              subtitle={item.year}
                              image={item.thumbnail}
                              badge={item.duration ?? null}
                              onClick={() => setExternalPlayer({ type: 'youtube', videoId: item.videoId, title: item.title, thumbnail: item.thumbnail })}
                            />
                          ))}
                        </div>
                      )}
                    </section>
                  </>
                )}
              </>
            )}
          </div>
        ) : activeTab === 'favorites' ? (
          // Favorites tab
          <div className="px-4 sm:px-6 py-5 space-y-8">
            {favoriteMovies.length === 0 && favoriteSeries.length === 0 && externalFavs.length === 0 ? (
              <div className="py-24 text-center">
                <Heart className="w-14 h-14 mx-auto mb-4 text-white/10" />
                <p className="text-white/30 text-lg font-medium">Aún no tienes favoritos</p>
                <p className="text-white/20 text-sm mt-1">Pulsa ❤ en cualquier película o serie para guardarla aquí</p>
              </div>
            ) : (
              <>
                {favoriteMovies.length > 0 && (
                  <ContentRow
                    sectionRef={(el) => { rowRefs.current[0] = el; }}
                    title="Películas favoritas"
                    emoji="🎬"
                    items={favoriteMovies as ContentItem[]}
                    focusedIndex={colIndex}
                    isFocusedRow={inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === 0}
                    disableHover={inputMode === 'keyboard'}
                    onItemClick={playItem}
                    onFavoriteToggle={doToggleFav}
                    onInfoItem={handleInfoItem}
                    progressMap={progressMap}
                    favSet={favSet}
                  />
                )}
                {favoriteSeries.length > 0 && (
                  <section ref={(el) => { rowRefs.current[1] = el; }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-base">📺</span>
                      <h2 className="text-sm sm:text-base font-semibold text-white/70">Series favoritas</h2>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                      {favoriteSeries.map(s => (
                        <button
                          key={s.id}
                          onClick={() => setLocation(`/serie/${s.id}`)}
                          className="flex-shrink-0 w-36 group text-left focus:outline-none"
                        >
                          <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5 mb-2">
                            {s.poster
                              ? <img src={s.poster} alt={s.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                              : <div className="w-full h-full flex items-center justify-center"><Tv2 className="w-8 h-8 text-white/20" /></div>
                            }
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                              <div className="opacity-0 group-hover:opacity-100 w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                                <Play className="w-5 h-5 text-white ml-0.5" />
                              </div>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); toggleSeriesFavorite(s.id); setSeriesFavIds(getSeriesFavorites()); }}
                              className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Quitar de favoritos"
                            >
                              <Heart className="w-3.5 h-3.5 fill-current" />
                            </button>
                          </div>
                          <p className="text-xs text-white/70 font-medium leading-snug line-clamp-2">{s.title}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                )}
                {externalFavs.length > 0 && (
                  <section ref={(el) => { rowRefs.current[2] = el; }}>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-base">🌐</span>
                      <h2 className="text-sm sm:text-base font-semibold text-white/70">Favoritos online</h2>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                      {externalFavs.map(ext => (
                        <button
                          key={ext.id}
                          onClick={() => setExternalPlayer({ type: ext.source, videoId: ext.videoId, url: ext.url, title: ext.title, thumbnail: ext.thumbnail })}
                          className="flex-shrink-0 w-44 group text-left focus:outline-none"
                        >
                          <div className="relative aspect-video rounded-xl overflow-hidden bg-white/5 mb-2">
                            {ext.thumbnail
                              ? <img src={ext.thumbnail} alt={ext.title} className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-200" loading="lazy" />
                              : <div className="w-full h-full bg-gradient-to-br from-slate-800 to-slate-900 flex items-center justify-center"><Film className="w-8 h-8 text-white/20" /></div>
                            }
                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                              <div className="opacity-0 group-hover:opacity-100 w-10 h-10 rounded-full bg-white/20 backdrop-blur flex items-center justify-center">
                                <Play className="w-5 h-5 text-white ml-0.5" />
                              </div>
                            </div>
                            <button
                              onClick={e => { e.stopPropagation(); toggleExternalFavorite(ext); setExternalFavs(getExternalFavorites()); }}
                              className="absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/60 text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                              title="Quitar de favoritos"
                            >
                              <Heart className="w-3.5 h-3.5 fill-current" />
                            </button>
                          </div>
                          <p className="text-xs text-white/80 font-medium leading-snug line-clamp-2">{ext.title}</p>
                        </button>
                      ))}
                    </div>
                  </section>
                )}

                {/* ── WATCH HISTORY (Favorites tab) ── */}
                {externalHistory.length > 0 && (
                  <section>
                    <div className="flex items-center gap-3 mb-3">
                      <Clock className="w-4 h-4 text-white/40" />
                      <h2 className="text-sm sm:text-base font-semibold text-white/70">Historial de reproducción</h2>
                      <span className="text-xs text-white/25">{externalHistory.length}</span>
                      <button
                        onClick={() => { clearExternalHistory(); setExternalHistory([]); }}
                        className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/35 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                        title="Borrar historial"
                      >
                        <Trash2 className="w-3 h-3" />
                        Limpiar
                      </button>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                      {externalHistory.map(ext => (
                        <HistoryCard
                          key={ext.id}
                          item={ext}
                          onClick={() => setExternalPlayer({ type: ext.source, videoId: ext.videoId, url: ext.url, title: ext.title, thumbnail: ext.thumbnail })}
                          onRemove={e => { e.stopPropagation(); removeExternalHistory(ext.id); setExternalHistory(getExternalHistory()); }}
                        />
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        ) : (
          // Home + Movies tab
          <div className="px-4 sm:px-6 py-5 space-y-6">
            {contentRows.length === 0 && !searchQuery ? (
              <div className="py-20 text-center text-white/30">
                <p className="text-lg sm:text-xl">Sin resultados</p>
              </div>
            ) : (
              <>
                {contentRows.map((row, rIdx) => {
                  if (row.id === 'continue') {
                    return (
                      <section key="continue" ref={(el) => { rowRefs.current[rIdx] = el; }}>
                        <div className="flex items-center gap-3 mb-3">
                          <h2 className="text-sm sm:text-base font-semibold text-white/70">Seguir viendo</h2>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                          {combinedContinueWatching.map((item, cIdx) => (
                            <ContinueWatchingCard
                              key={`${item.type}-${item.id}`}
                              item={item}
                              focused={inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === rIdx && colIndex === cIdx}
                              onClick={() => {
                                if (isExpired) { setShowExpiredOverlay(true); return; }
                                if (item.type === 'external' && item.externalItem) {
                                  setExternalPlayer({ title: item.title, type: item.externalItem.source, videoId: item.externalItem.videoId, url: item.externalItem.url, thumbnail: item.externalItem.thumbnail });
                                } else if (item.type === 'series') setLocation(`/serie/${item.id}?autoplay=1`);
                                else setLocation(`/pelicula/${item.id}`);
                              }}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  }
                  if (row.id === 'ext-history') {
                    return (
                      <section key="ext-history" ref={(el) => { rowRefs.current[rIdx] = el; }}>
                        <div className="flex items-center gap-3 mb-3">
                          <Clock className="w-4 h-4 text-white/40" />
                          <h2 className="text-sm sm:text-base font-semibold text-white/70">Historial de reproducción</h2>
                          <span className="text-xs text-white/25">{externalHistory.length}</span>
                          <button
                            onClick={() => { clearExternalHistory(); setExternalHistory([]); }}
                            className="ml-auto flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] text-white/35 hover:text-red-400 hover:bg-red-500/10 transition-colors"
                            title="Borrar historial"
                          >
                            <Trash2 className="w-3 h-3" />
                            Limpiar
                          </button>
                        </div>
                        <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                          {externalHistory.map((ext, cIdx) => (
                            <HistoryCard
                              key={ext.id}
                              item={ext}
                              focused={inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === rIdx && colIndex === cIdx}
                              onClick={() => setExternalPlayer({ type: ext.source, videoId: ext.videoId, url: ext.url, title: ext.title, thumbnail: ext.thumbnail })}
                              onRemove={e => { e.stopPropagation(); removeExternalHistory(ext.id); setExternalHistory(getExternalHistory()); }}
                            />
                          ))}
                        </div>
                      </section>
                    );
                  }
                  const isExtRow = row.id === 'ext-yt' || row.id === 'ext-yt-movies' || row.id === 'ext-yt-others' || row.id === 'ext-arch';
                  if (isExtRow) {
                    const isArchRow = row.id === 'ext-arch';
                    const isYtOthers = row.id === 'ext-yt-others' || row.id === 'ext-yt';
                    return (
                      <section key={row.id} ref={(el) => { rowRefs.current[rIdx] = el; }}>
                        <div className="flex items-center gap-3 mb-3">
                          {row.emoji && <span className="text-base">{row.emoji}</span>}
                          <h2 className="text-sm sm:text-base font-semibold text-white/70">{row.title}</h2>
                          <span className="text-xs text-white/25">{row.items.length}</span>
                          {isYtOthers && (
                            <span className="text-[10px] text-white/30 ml-1">Puede incluir trailers o clips</span>
                          )}
                        </div>
                        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 gap-3">
                          {row.items.map((item, cIdx) => {
                            const ext = item as unknown as { id: number; title: string; poster?: string; _ytDuration?: string };
                            const isFocused = inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === rIdx && colIndex === cIdx;
                            return (
                              <ContentCard
                                key={item.id}
                                title={ext.title}
                                image={ext.poster ?? null}
                                isFocused={isFocused}
                                badge={isArchRow ? 'Película' : null}
                                duration={!isArchRow && ext._ytDuration ? ext._ytDuration : null}
                                onClick={() => playItem(item)}
                              />
                            );
                          })}
                        </div>
                      </section>
                    );
                  }
                  return (
                    <ContentRow
                      key={row.id}
                      sectionRef={(el) => { rowRefs.current[rIdx] = el; }}
                      title={row.title}
                      emoji={row.emoji}
                      items={row.items}
                      focusedIndex={colIndex}
                      isFocusedRow={inputMode === 'keyboard' && rowsFocusActive && zone === 'rows' && rowIndex === rIdx}
                      onItemClick={playItem}
                      onFavoriteToggle={doToggleFav}
                      progressMap={progressMap}
                      favSet={favSet}
                      isNewFn={row.showBadge ? isNew : undefined}
                      showProgress={row.showProgress}
                      onHoverItem={(item) => setHoveredHero(item ? { ...item, type: 'movie' } : null)}
                      onInfoItem={handleInfoItem}
                      disableHover={inputMode === 'keyboard'}
                    />
                  );
                })}

                {/* ── EXTERNAL FAVORITES (only when not searching) ── */}
                {!searchQuery.trim() && externalFavs.length > 0 && (
                  <section>
                    <div className="flex items-center gap-3 mb-3">
                      <span className="text-base">❤️</span>
                      <h2 className="text-sm sm:text-base font-semibold text-white/70">Favoritos online</h2>
                    </div>
                    <div className="flex gap-3 overflow-x-auto pb-3" style={{ scrollbarWidth: 'none' }}>
                      {externalFavs.map((ext) => (
                        <ContentCard
                          key={ext.id}
                          title={ext.title}
                          image={ext.thumbnail ?? null}
                          badge="Online"
                          onClick={() => setExternalPlayer({ type: ext.source, videoId: ext.videoId, url: ext.url, title: ext.title, thumbnail: ext.thumbnail })}
                        />
                      ))}
                    </div>
                  </section>
                )}


                {/* External search loading indicator */}
                {searchQuery.trim().length >= 2 && externalSearchLoading && (
                  <div className="flex items-center gap-2 py-2">
                    <span className="text-xs text-white/30 animate-pulse">Buscando más resultados...</span>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </main>

      {/* ── BOTTOM NAV (mobile) ── */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-black/98 border-t border-white/8 flex items-stretch">
        {navItems.map(item => {
          const Icon = item.icon;
          const isActive = activeTab === item.key;
          return (
            <button
              key={item.key}
              onClick={() => { setZone('rows'); startTransition(() => { setActiveTab(item.key); setSearchQuery(''); setSearchInput(''); setRowIndex(0); setColIndex(0); }); }}
              className={`flex-1 flex flex-col items-center gap-1 py-2.5 transition-all ${isActive ? 'text-white' : 'text-white/35 hover:text-white/60'}`}
            >
              <Icon className={`w-5 h-5 transition-colors ${isActive ? 'text-primary' : ''}`} />
              <span className="text-[9px] font-medium">{item.label}</span>
              {isActive && <div className="w-1 h-1 rounded-full bg-primary" />}
            </button>
          );
        })}
        <button onClick={handleLogout} className="flex-1 flex flex-col items-center gap-1 py-2.5 text-white/25 hover:text-white/50 transition-colors">
          <LogOut className="w-5 h-5" />
          <span className="text-[9px] font-medium">Salir</span>
        </button>
      </nav>

      {/* ── MODALS ── */}
      {showProfile && <ProfileEditor session={session ?? null} avatars={avatars} onClose={() => setShowProfile(false)} onSave={handleSaveProfile} />}

      {showHint && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/80 p-4" onClick={() => setShowHint(false)}>
          <div className="bg-card border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-4 shadow-2xl" onClick={e => e.stopPropagation()}>
            {isIosSafari ? (
              <>
                <div className="flex items-center gap-3"><Share2 className="w-6 h-6 text-primary flex-shrink-0" /><h2 className="text-base font-bold text-white">Instalar en iPhone / iPad</h2></div>
                <ol className="space-y-2 text-sm text-white/60 list-none">
                  <li className="flex items-start gap-2"><span className="text-primary font-bold">1.</span>Toca el botón <strong className="text-white mx-1">Compartir</strong><Share2 className="inline w-4 h-4 mx-0.5 flex-shrink-0" /> en Safari</li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold">2.</span>Toca <strong className="text-white">"Agregar a pantalla de inicio"</strong></li>
                  <li className="flex items-start gap-2"><span className="text-primary font-bold">3.</span>Toca <strong className="text-white">Agregar</strong></li>
                </ol>
              </>
            ) : (
              <>
                <div className="flex items-center gap-3"><Download className="w-6 h-6 text-primary flex-shrink-0" /><h2 className="text-base font-bold text-white">Instalar la aplicación</h2></div>
                <p className="text-sm text-white/60">Para instalar, abre en <strong className="text-white">Chrome</strong> o <strong className="text-white">Edge</strong> y vuelve a tocar el botón de instalar.</p>
              </>
            )}
            <button onClick={() => setShowHint(false)} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">Entendido</button>
          </div>
        </div>
      )}

      {showShortcutHint && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setShowShortcutHint(false)}>
          <div className="bg-card border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h2 className="text-base font-bold text-white">Acceso directo al escritorio</h2>
            <p className="text-sm text-white/60">En tu navegador, busca la opción "Agregar a pantalla de inicio" o "Instalar aplicación" para crear un acceso directo.</p>
            <button onClick={() => setShowShortcutHint(false)} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">Entendido</button>
          </div>
        </div>
      )}

      {apkMsg && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4" onClick={() => setApkMsg(null)}>
          <div className="bg-card border border-white/10 rounded-2xl p-6 max-w-sm w-full space-y-3 shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center gap-3">
              <Download className="w-6 h-6 text-yellow-400 flex-shrink-0" />
              <h2 className="text-base font-bold text-white">APK no disponible</h2>
            </div>
            <p className="text-sm text-white/60">{apkMsg}</p>
            <button onClick={() => setApkMsg(null)} className="w-full py-2.5 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 transition-colors">Volver</button>
          </div>
        </div>
      )}

      {/* ── EXTERNAL PLAYER MODAL ── */}
      {externalPlayer && (
        <ExternalPlayerModal
          player={externalPlayer}
          onClose={() => setExternalPlayer(null)}
          onHistoryUpdate={() => setExternalHistory(getExternalHistory())}
          onFavsUpdate={() => setExternalFavs(getExternalFavorites())}
        />
      )}

      {/* ── MOVIE DETAIL SHEET ── */}
      <MovieDetailSheet
        movie={detailMovie}
        isFavorite={detailMovie ? favorites.includes(detailMovie.id) : false}
        onClose={() => setDetailMovie(null)}
        onPlay={() => {
          if (!detailMovie) return;
          const fullMovie = movies.find(m => m.id === detailMovie.id);
          setDetailMovie(null);
          if (fullMovie) playItem(fullMovie as unknown as ContentItem);
          else setLocation(`/pelicula/${detailMovie.id}`);
        }}
        onFavoriteToggle={detailMovie ? () => { doToggleFav(detailMovie.id); } : undefined}
      />
    </div>
  );
}
