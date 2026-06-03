import { useRef, useEffect, memo } from 'react';
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

  useEffect(() => {
    if (isFocusedRow && focusedIndex >= 0 && cardRefs.current[focusedIndex]) {
      cardRefs.current[focusedIndex]?.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
        inline: 'center',
      });
    }
  }, [focusedIndex, isFocusedRow]);

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
    </section>
  );
});
