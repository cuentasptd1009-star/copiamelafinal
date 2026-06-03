import { useEffect, useRef } from 'react';
import { Play, Heart, X, Film, Calendar, Tag, Clock } from 'lucide-react';
import { createPortal } from 'react-dom';

export interface MovieInfo {
  id: number;
  title: string;
  poster?: string | null;
  description?: string | null;
  genre?: string | null;
  year?: number | null;
  category?: string | null;
  duration?: number | null;
}

interface MovieDetailSheetProps {
  movie: MovieInfo | null;
  isFavorite?: boolean;
  onClose: () => void;
  onPlay: () => void;
  onFavoriteToggle?: () => void;
}

function fmtDuration(mins: number | null | undefined): string | null {
  if (!mins || mins <= 0) return null;
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

export function MovieDetailSheet({ movie, isFavorite, onClose, onPlay, onFavoriteToggle }: MovieDetailSheetProps) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!movie) return;
    const handle = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handle);
    return () => window.removeEventListener('keydown', handle);
  }, [movie, onClose]);

  useEffect(() => {
    if (movie) {
      document.body.style.overflow = 'hidden';
      closeRef.current?.focus();
    } else {
      document.body.style.overflow = '';
    }
    return () => { document.body.style.overflow = ''; };
  }, [movie]);

  if (!movie) return null;

  const dur = fmtDuration(movie.duration);

  return createPortal(
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center p-4"
      style={{ animation: 'fadeIn 0.2s ease-out' }}
    >
      {/* Overlay */}
      <div
        className="absolute inset-0 bg-black/80 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Card */}
      <div
        className="relative z-10 w-full max-w-lg rounded-2xl overflow-hidden shadow-2xl bg-[#141414]"
        style={{ animation: 'slideUp 0.25s ease-out' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Hero image */}
        <div className="relative aspect-video bg-black overflow-hidden">
          {movie.poster ? (
            <img
              src={movie.poster}
              alt={movie.title}
              className="w-full h-full object-cover"
              onError={e => { (e.target as HTMLImageElement).style.display = 'none'; }}
            />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-zinc-900">
              <Film className="w-16 h-16 text-white/10" />
            </div>
          )}
          {/* Gradient overlay */}
          <div className="absolute inset-0 bg-gradient-to-t from-[#141414] via-[#141414]/40 to-transparent" />

          {/* Close button */}
          <button
            ref={closeRef}
            onClick={onClose}
            className="absolute top-3 right-3 w-8 h-8 rounded-full bg-black/60 border border-white/20 flex items-center justify-center text-white/80 hover:text-white hover:bg-black/80 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <X className="w-4 h-4" />
          </button>

          {/* Title over image bottom */}
          <div className="absolute bottom-0 left-0 right-0 px-5 pb-4">
            <h2 className="text-white font-bold text-xl leading-tight drop-shadow-lg line-clamp-2">{movie.title}</h2>
          </div>
        </div>

        {/* Content */}
        <div className="px-5 pb-5 space-y-4">
          {/* Action buttons */}
          <div className="flex gap-3 pt-1">
            <button
              onClick={onPlay}
              className="flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg bg-primary text-primary-foreground font-semibold text-sm hover:bg-primary/90 transition-colors focus:outline-none focus:ring-2 focus:ring-primary"
            >
              <Play className="w-4 h-4 fill-current" />
              Reproducir
            </button>
            {onFavoriteToggle && (
              <button
                onClick={onFavoriteToggle}
                className={`w-11 h-10 rounded-lg border flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-primary ${
                  isFavorite
                    ? 'border-primary/60 bg-primary/15 text-primary'
                    : 'border-white/20 bg-white/5 text-white/60 hover:text-white hover:border-white/40'
                }`}
                title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
              >
                <Heart className={`w-4 h-4 ${isFavorite ? 'fill-current' : ''}`} />
              </button>
            )}
          </div>

          {/* Metadata chips */}
          {(movie.year || movie.genre || movie.category || dur) && (
            <div className="flex flex-wrap gap-2">
              {movie.year && (
                <span className="flex items-center gap-1 text-xs text-white/60 bg-white/8 border border-white/10 px-2.5 py-1 rounded-full">
                  <Calendar className="w-3 h-3" />
                  {movie.year}
                </span>
              )}
              {movie.genre && (
                <span className="flex items-center gap-1 text-xs text-white/60 bg-white/8 border border-white/10 px-2.5 py-1 rounded-full">
                  <Tag className="w-3 h-3" />
                  {movie.genre}
                </span>
              )}
              {movie.category && (
                <span className="flex items-center gap-1 text-xs text-white/60 bg-white/8 border border-white/10 px-2.5 py-1 rounded-full">
                  {movie.category}
                </span>
              )}
              {dur && (
                <span className="flex items-center gap-1 text-xs text-white/60 bg-white/8 border border-white/10 px-2.5 py-1 rounded-full">
                  <Clock className="w-3 h-3" />
                  {dur}
                </span>
              )}
            </div>
          )}

          {/* Description */}
          {movie.description ? (
            <p className="text-sm text-white/65 leading-relaxed line-clamp-5">
              {movie.description}
            </p>
          ) : (
            <p className="text-sm text-white/30 italic">Sin descripción disponible</p>
          )}
        </div>
      </div>

      <style>{`
        @keyframes slideUp {
          from { transform: translateY(24px); opacity: 0; }
          to   { transform: translateY(0);    opacity: 1; }
        }
      `}</style>
    </div>,
    document.body,
  );
}
