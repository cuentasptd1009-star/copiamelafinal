import { useRef, useEffect, memo, useState, useCallback } from 'react';
import { ContentCard } from './ContentCard';
import type { WatchProgress } from '@/lib/user-data';
import type { HeroBannerItem } from './HeroBanner';

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
  const scrollIntervalRef = useRef<number | null>(null);
  const currentEdgeRef = useRef<'left' | 'right' | null>(null);

  const updateScrollState = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    setCanScrollLeft(el.scrollLeft > 4);
    setCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4);
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    updateScrollState();
    el.addEventListener('scroll', updateScrollState, { passive: true });
    const ro = new ResizeObserver(updateScrollState);
    ro.observe(el);
    return () => {
      el.removeEventListener('scroll', updateScrollState);
      ro.disconnect();
    };
  }, [updateScrollState, items]);

  useEffect(() => {
    if (isFocusedRow && focusedIndex >= 0 && cardRefs.current[focusedIndex]) {
      cardRefs.current[focusedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [focusedIndex, isFocusedRow]);

  // Clean up interval on unmount
  useEffect(() => {
    return () => {
      if (scrollIntervalRef.current !== null) {
        clearInterval(scrollIntervalRef.current);
      }
    };
  }, []);

  const stopEdgeScroll = useCallback(() => {
    if (scrollIntervalRef.current !== null) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }
    currentEdgeRef.current = null;
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const threshold = 80;

    let newEdge: 'left' | 'right' | null = null;
    if (x < threshold) newEdge = 'left';
    else if (x > rect.width - threshold) newEdge = 'right';

    // Only restart the interval if the zone actually changed
    if (newEdge === currentEdgeRef.current) return;
    currentEdgeRef.current = newEdge;

    if (scrollIntervalRef.current !== null) {
      clearInterval(scrollIntervalRef.current);
      scrollIntervalRef.current = null;
    }

    if (newEdge === 'left') {
      scrollIntervalRef.current = window.setInterval(() => {
        scrollRef.current?.scrollBy({ left: -6 });
      }, 16);
    } else if (newEdge === 'right') {
      scrollIntervalRef.current = window.setInterval(() => {
        scrollRef.current?.scrollBy({ left: 6 });
      }, 16);
    }
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
        className="relative"
        onMouseMove={handleMouseMove}
        onMouseLeave={stopEdgeScroll}
      >
        {/* Left edge gradient — appears when there is content to scroll left */}
        {canScrollLeft && (
          <div
            className="absolute left-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
            style={{ background: 'linear-gradient(to right, rgba(0,0,0,0.45) 0%, transparent 100%)' }}
          />
        )}

        {/* Right edge gradient — appears when there is content to scroll right */}
        {canScrollRight && (
          <div
            className="absolute right-0 top-0 bottom-0 w-16 z-10 pointer-events-none"
            style={{ background: 'linear-gradient(to left, rgba(0,0,0,0.45) 0%, transparent 100%)' }}
          />
        )}

        <div
          ref={scrollRef}
          className="flex gap-2.5 sm:gap-3 py-4"
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
