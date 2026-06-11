import { useRef, useEffect, memo, useState, useCallback } from 'react';
import { ContentCard } from './ContentCard';
import type { WatchProgress } from '@/lib/user-data';
import type { HeroBannerItem } from './HeroBanner';
import { ChevronLeft, ChevronRight } from 'lucide-react';

export interface ChannelItem {
  id: number;
  name: string;
  streamUrl: string;
  logo?: string | null;
  category?: string | null;
}

export interface MovieItem {
  id: number;
  title: string;
  poster?: string | null;
  banner?: string | null;
  description?: string | null;
  genre?: string | null;
  year?: number | null;
  category?: string | null;
  createdAt: string;
  filePath?: string | null;
  duration?: number | null;
}

function fmtDuration(mins: number | null | undefined): string | null {
  if (!mins || mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export type ContentItem = ChannelItem | MovieItem;

export function isChannel(item: ContentItem): item is ChannelItem {
  return 'streamUrl' in item;
}

interface ContentRowProps {
  title: string;
  emoji?: string;
  items: ContentItem[];
  focusedIndex: number;
  isFocusedRow: boolean;
  onItemClick: (item: ContentItem) => void;
  onFavoriteToggle?: (id: number) => void;
  progressMap?: Map<number, WatchProgress>;
  favSet?: Set<number>;
  isNewFn?: (item: ContentItem) => boolean;
  showProgress?: boolean;
  sectionRef?: (el: HTMLElement | null) => void;
  onHoverItem?: (item: HeroBannerItem | null) => void;
  portrait?: boolean;
  disableHover?: boolean;
  onInfoItem?: (item: ContentItem) => void;
}

export const ContentRow = memo(function ContentRow({
  title,
  emoji,
  items,
  focusedIndex,
  isFocusedRow,
  onItemClick,
  onFavoriteToggle,
  progressMap,
  favSet,
  isNewFn,
  showProgress = false,
  sectionRef,
  onHoverItem,
  portrait = false,
  disableHover = false,
  onInfoItem,
}: ContentRowProps) {
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  // Update arrow visibility based on scroll position
  const updateArrows = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateArrows();
    el.addEventListener('scroll', updateArrows, { passive: true });
    const ro = new ResizeObserver(updateArrows);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateArrows);
      ro.disconnect();
    };
  }, [updateArrows, items]);

  // Horizontal scroll with mouse wheel
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        e.preventDefault();
        el.scrollBy({ left: e.deltaY * 2.5, behavior: 'smooth' });
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    if (isFocusedRow && focusedIndex >= 0 && cardRefs.current[focusedIndex]) {
      cardRefs.current[focusedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [focusedIndex, isFocusedRow]);

  const scrollBy = useCallback((direction: 'left' | 'right') => {
    const el = scrollRef.current;
    if (!el) return;
    const amount = el.clientWidth * 0.75;
    el.scrollBy({ left: direction === 'right' ? amount : -amount, behavior: 'smooth' });
  }, []);

  if (items.length === 0) return null;

  return (
    <section ref={sectionRef} className="space-y-2.5">
      <div className="flex items-center gap-3 px-1">
        <h2
          className={`text-sm sm:text-base font-semibold tracking-wide transition-colors duration-200 ${
            isFocusedRow ? 'text-white' : 'text-white/70'
          }`}
        >
          {title}
        </h2>
        <span className="text-[11px] font-normal text-white/25">{items.length}</span>
      </div>

      <div
        className="relative group"
        onMouseEnter={() => setIsHovered(true)}
        onMouseLeave={() => setIsHovered(false)}
      >
        {/* Left arrow */}
        {canScrollLeft && (
          <button
            onClick={() => scrollBy('left')}
            className={`absolute left-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center
              w-9 h-14 rounded-r-xl bg-black/70 hover:bg-black/90 text-white
              border border-white/10 hover:border-white/30
              shadow-[4px_0_16px_rgba(0,0,0,0.6)]
              transition-all duration-200
              ${isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 -translate-x-2'}
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
            aria-label="Desplazar izquierda"
            tabIndex={-1}
          >
            <ChevronLeft className="w-5 h-5 flex-shrink-0" />
          </button>
        )}

        {/* Right arrow */}
        {canScrollRight && (
          <button
            onClick={() => scrollBy('right')}
            className={`absolute right-0 top-1/2 -translate-y-1/2 z-10 flex items-center justify-center
              w-9 h-14 rounded-l-xl bg-black/70 hover:bg-black/90 text-white
              border border-white/10 hover:border-white/30
              shadow-[-4px_0_16px_rgba(0,0,0,0.6)]
              transition-all duration-200
              ${isHovered ? 'opacity-100 translate-x-0' : 'opacity-0 translate-x-2'}
              focus:outline-none focus-visible:ring-2 focus-visible:ring-white/50`}
            aria-label="Desplazar derecha"
            tabIndex={-1}
          >
            <ChevronRight className="w-5 h-5 flex-shrink-0" />
          </button>
        )}

        <div
          ref={scrollRef}
          className="flex gap-2.5 sm:gap-3 py-4 scroll-smooth"
          style={{
            overflowX: 'auto',
            overflowY: 'clip',
            scrollbarWidth: 'none',
            msOverflowStyle: 'none',
            paddingLeft: '4px',
            paddingRight: '4px',
          }}
        >
          {items.map((item, idx) => {
            const ch = isChannel(item);
            const itemTitle = ch ? item.name : item.title;
            const image = ch ? item.logo : item.poster;
            const prog =
              !ch && progressMap && showProgress ? progressMap.get(item.id) : undefined;
            const fav = !ch && favSet ? favSet.has(item.id) : false;
            const badge = !ch && isNewFn && isNewFn(item) ? 'NUEVO' : null;

            const heroItem: HeroBannerItem | null = !ch ? {
              id: item.id,
              title: (item as MovieItem).title,
              description: (item as MovieItem).description,
              banner: (item as MovieItem).banner,
              poster: (item as MovieItem).poster,
              category: (item as MovieItem).category,
              genre: (item as MovieItem).genre,
              year: (item as MovieItem).year,
              type: 'movie',
            } : null;

            return (
              <ContentCard
                key={`${ch ? 'c' : 'm'}-${item.id}`}
                cardRef={(el) => {
                  cardRefs.current[idx] = el;
                }}
                title={itemTitle}
                subtitle={item.category ?? undefined}
                image={image}
                isChannel={ch}
                portrait={portrait && !ch}
                isFocused={isFocusedRow && focusedIndex === idx}
                progress={prog ?? null}
                isFavorite={fav}
                badge={badge}
                duration={!ch ? fmtDuration((item as MovieItem).duration) ?? undefined : undefined}
                previewUrl={!ch ? (item as MovieItem).filePath ?? undefined : undefined}
                onClick={() => onItemClick(item)}
                onInfoClick={!ch && onInfoItem ? (e) => { e.stopPropagation(); onInfoItem(item); } : undefined}
                onFavoriteToggle={
                  !ch && onFavoriteToggle
                    ? (e) => {
                        e.stopPropagation();
                        onFavoriteToggle(item.id);
                      }
                    : undefined
                }
                onHover={heroItem && onHoverItem ? () => onHoverItem(heroItem) : undefined}
                onHoverEnd={onHoverItem ? () => onHoverItem(null) : undefined}
                disableHover={disableHover}
              />
            );
          })}
        </div>
      </div>
    </section>
  );
});
