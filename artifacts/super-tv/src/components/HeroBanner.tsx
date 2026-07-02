import { useState, useEffect, useRef } from 'react';
import { Play, Info } from 'lucide-react';

export interface HeroBannerItem {
  id: number;
  title: string;
  description?: string | null;
  banner?: string | null;
  poster?: string | null;
  category?: string | null;
  genre?: string | null;
  year?: number | null;
  type: 'movie' | 'series';
  streamUrl?: string | null;
  streamFormat?: string | null;
}

interface HeroBannerProps {
  items: HeroBannerItem[];
  onPlay: (item: HeroBannerItem) => void;
  onInfo: (item: HeroBannerItem) => void;
  overrideItem?: HeroBannerItem | null;
  focusedBtnIndex?: number | null;
  currentIndex?: number;
  onCurrentChange?: (idx: number) => void;
}

export function HeroBanner({ items, onPlay, onInfo, overrideItem, focusedBtnIndex, currentIndex, onCurrentChange }: HeroBannerProps) {
  const [internalCurrent, setInternalCurrent] = useState(0);
  const [loaded, setLoaded] = useState(false);
  // null = not measured yet (assume wide/banner-like so we don't flash a shrunk layout),
  // true = the image is a narrow/portrait poster and needs the blurred-fill treatment.
  const [isNarrowPoster, setIsNarrowPoster] = useState(false);

  const current = currentIndex !== undefined ? currentIndex : internalCurrent;
  const currentRef = useRef(current);
  currentRef.current = current;

  const setCurrent = (v: number | ((p: number) => number)) => {
    const next = typeof v === 'function' ? v(currentRef.current) : v;
    setInternalCurrent(next);
    onCurrentChange?.(next);
  };

  useEffect(() => {
    if (overrideItem || items.length <= 1) return;
    const timer = setInterval(() => {
      const next = (currentRef.current + 1) % items.length;
      setInternalCurrent(next);
      onCurrentChange?.(next);
      setLoaded(false);
    }, 7000);
    return () => clearInterval(timer);
  }, [items.length, overrideItem, onCurrentChange]);

  if (!items.length) return null;

  const item = overrideItem ?? items[current] ?? items[0];
  if (!item) return null;
  const hasBanner = !!item.banner;
  const bgImage = item.banner || item.poster;

  // Only the true portrait movie posters (roughly 2:3) get squeezed into
  // pixelated slivers when stretched full-bleed. Wide screenshots/thumbnails
  // used as a "poster" already look fine full-bleed, so measure the real
  // image dimensions and only switch layout for genuinely narrow images.
  useEffect(() => {
    setIsNarrowPoster(false);
    if (hasBanner || !bgImage) return;
    let cancelled = false;
    const probe = new Image();
    probe.onload = () => {
      if (cancelled) return;
      if (probe.naturalWidth && probe.naturalHeight) {
        setIsNarrowPoster(probe.naturalWidth / probe.naturalHeight < 1.2);
      }
    };
    probe.src = bgImage;
    return () => { cancelled = true; };
  }, [bgImage, hasBanner]);

  const playFocused = focusedBtnIndex === 0;
  const infoFocused = focusedBtnIndex === 1;

  return (
    <div className="relative w-full overflow-hidden" style={{ aspectRatio: '16/7', minHeight: '240px', maxHeight: '560px' }}>
      {bgImage && !isNarrowPoster && (
        <img
          key={bgImage}
          src={bgImage}
          alt={item.title}
          className={`absolute inset-0 w-full h-full object-cover transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          onLoad={() => setLoaded(true)}
          onError={() => setLoaded(true)}
        />
      )}
      {bgImage && isNarrowPoster && (
        // No dedicated wide banner for this title and the fallback image is a
        // narrow/portrait poster — stretching it across the full width made
        // parts of the image look pixelated/low quality. Instead: a blurred
        // cover fill for ambiance + the poster shown sharp at its native
        // aspect ratio, like Netflix/Prime do for poster-only titles.
        <>
          <img
            src={bgImage}
            alt=""
            aria-hidden="true"
            className={`absolute inset-0 w-full h-full object-cover scale-125 blur-2xl brightness-[0.45] transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
            onLoad={() => setLoaded(true)}
            onError={() => setLoaded(true)}
          />
          <img
            key={bgImage}
            src={bgImage}
            alt={item.title}
            className={`absolute hidden sm:block right-6 md:right-12 bottom-6 md:bottom-10 h-[68%] md:h-[75%] w-auto object-contain rounded-xl shadow-2xl ring-1 ring-white/10 transition-opacity duration-500 ${loaded ? 'opacity-100' : 'opacity-0'}`}
          />
        </>
      )}
      {!bgImage && (
        <div className="absolute inset-0 bg-black" />
      )}

      <div className="absolute bottom-0 left-0 right-0 h-2/5 bg-gradient-to-t from-black/80 to-transparent" />

      {focusedBtnIndex !== null && focusedBtnIndex !== undefined && (
        <div className="absolute inset-0 ring-inset ring-2 ring-primary/30 pointer-events-none rounded-none" />
      )}

      <div className="absolute inset-0 flex flex-col justify-end p-5 sm:p-10 md:p-14 max-w-2xl">
        <div className="space-y-2 sm:space-y-3">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="px-2 py-0.5 text-[10px] font-bold rounded uppercase tracking-widest bg-primary text-primary-foreground">
              {item.type === 'series' ? 'Serie' : 'Película'}
            </span>
            {item.genre && <span className="text-white/60 text-xs">{item.genre}</span>}
            {item.year && <span className="text-white/60 text-xs">· {item.year}</span>}
          </div>

          <h1 className="text-2xl sm:text-4xl md:text-5xl font-extrabold text-white leading-tight drop-shadow-lg line-clamp-2">
            {item.title}
          </h1>

          {item.description && (
            <p className="text-white/75 text-xs sm:text-sm leading-relaxed line-clamp-2 sm:line-clamp-3 max-w-lg drop-shadow">
              {item.description}
            </p>
          )}

          <div className="flex items-center gap-3 pt-1 sm:pt-3">
            <button
              onClick={() => onPlay(item)}
              className={`flex items-center gap-2 px-5 sm:px-7 py-2.5 sm:py-3 bg-primary hover:bg-primary/80 text-white rounded-xl font-bold text-sm sm:text-base transition-all active:scale-95 shadow-lg shadow-primary/30 ${playFocused ? 'ring-4 ring-white scale-105 shadow-[0_0_20px_rgba(255,255,255,0.4)]' : ''}`}
            >
              <Play className="w-4 h-4 sm:w-5 sm:h-5 fill-white" />
              Ver ahora
            </button>
            <button
              onClick={() => onInfo(item)}
              className={`flex items-center gap-2 px-4 sm:px-6 py-2.5 sm:py-3 bg-white/10 hover:bg-white/20 text-white rounded-xl font-semibold text-sm transition-[background-color,transform,box-shadow] duration-150 active:scale-95 border border-white/15 ${infoFocused ? 'ring-4 ring-white scale-105 bg-white/25 shadow-[0_0_20px_rgba(255,255,255,0.3)]' : ''}`}
            >
              <Info className="w-4 h-4" />
              <span className="hidden sm:inline">Más información</span>
              <span className="sm:hidden">Info</span>
            </button>
          </div>
        </div>
      </div>

    </div>
  );
}
