import { memo, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Play, Heart, Film, VolumeX, Volume2, Info, Tv } from 'lucide-react';

const BASE_URL = import.meta.env.BASE_URL?.replace(/\/$/, '') || '';

const GRADIENTS = [
  'from-slate-800 to-slate-900',
  'from-zinc-800 to-zinc-900',
  'from-stone-800 to-stone-900',
  'from-neutral-800 to-neutral-950',
  'from-gray-800 to-gray-950',
  'from-red-950 to-slate-900',
  'from-indigo-950 to-slate-900',
  'from-purple-950 to-slate-900',
  'from-blue-950 to-slate-900',
  'from-teal-950 to-slate-900',
];

function titleGradient(title: string): string {
  let h = 0;
  for (let i = 0; i < title.length; i++) h = (h * 31 + title.charCodeAt(i)) >>> 0;
  return GRADIENTS[h % GRADIENTS.length];
}

function fmtSecs(s: number): string {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, '0')}`;
}

export function extractYouTubeId(url: string): string | null {
  const m = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
  return m ? m[1] : null;
}

const PREVIEW_W = 296;
const VIDEO_RATIO = 9 / 16;
const VIDEO_H = Math.round(PREVIEW_W * VIDEO_RATIO);
const INFO_H = 116;
const TOTAL_H = VIDEO_H + INFO_H;

interface WatchProgress {
  time: number;
  duration: number;
}

interface ContentCardProps {
  title: string;
  subtitle?: string;
  image?: string | null;
  isChannel?: boolean;
  isFocused?: boolean;
  progress?: WatchProgress | null;
  isFavorite?: boolean;
  badge?: string | null;
  duration?: string | null;
  portrait?: boolean;
  previewUrl?: string | null;
  onClick: () => void;
  onInfoClick?: (e: React.MouseEvent) => void;
  onFavoriteToggle?: (e: React.MouseEvent) => void;
  onHover?: () => void;
  onHoverEnd?: () => void;
  cardRef?: (el: HTMLDivElement | null) => void;
  disableHover?: boolean;
}

export const ContentCard = memo(function ContentCard({
  title,
  subtitle,
  image,
  isChannel = false,
  isFocused = false,
  progress,
  isFavorite = false,
  badge,
  duration,
  portrait = false,
  previewUrl,
  onClick,
  onInfoClick,
  onFavoriteToggle,
  onHover,
  onHoverEnd,
  cardRef,
  disableHover = false,
}: ContentCardProps) {
  const [imgError, setImgError] = useState(false);
  const [previewActive, setPreviewActive] = useState(false);
  const [cardRect, setCardRect] = useState<DOMRect | null>(null);
  const [muted, setMuted] = useState(false);
  const [previewBtnIdx, setPreviewBtnIdx] = useState(0);
  const [ytCoverOpacity, setYtCoverOpacity] = useState(1);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isHoveringRef = useRef(false);
  const innerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const ytIframeRef = useRef<HTMLIFrameElement | null>(null);

  const isTouchDevice = typeof window !== 'undefined' && window.matchMedia('(hover: none) and (pointer: coarse)').matches;

  const ytId = previewUrl ? extractYouTubeId(previewUrl) : null;
  const isDirectVideo = !!(previewUrl && !ytId);
  const canPreview = !!(isDirectVideo || ytId) && !isTouchDevice;

  // YouTube iframe: autoplay with sound, skip to 10 min for a good scene, hide all branding/controls
  const ytSrc = ytId
    ? `https://www.youtube.com/embed/${ytId}?autoplay=1&controls=0&modestbranding=1&rel=0&iv_load_policy=3&disablekb=1&fs=0&loop=1&playlist=${ytId}&start=600&enablejsapi=1`
    : null;

  const startTimer = () => {
    if (!canPreview) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      if (!isHoveringRef.current) return;
      if (innerRef.current) {
        setCardRect(innerRef.current.getBoundingClientRect());
      }
      setPreviewActive(true);
    }, 1500);
  };

  const stopPreview = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    setPreviewActive(false);
    setCardRect(null);
  };

  // Reset state when preview closes
  useEffect(() => {
    if (!previewActive) {
      setMuted(false);
      setPreviewBtnIdx(0);
      setYtCoverOpacity(1);
    }
  }, [previewActive]);

  // No poster delay for YouTube — video plays immediately with sound
  useEffect(() => {
    if (!previewActive || !ytId) return;
    setYtCoverOpacity(0);
  }, [previewActive, ytId]);

  // Keep preview anchored to card while scrolling
  useEffect(() => {
    if (!previewActive) return;
    const update = () => {
      if (innerRef.current) setCardRect(innerRef.current.getBoundingClientRect());
    };
    window.addEventListener('scroll', update, { passive: true, capture: true });
    window.addEventListener('resize', update, { passive: true });
    return () => {
      window.removeEventListener('scroll', update, { capture: true });
      window.removeEventListener('resize', update);
    };
  }, [previewActive]);

  // TV remote focus (not for touch devices — no video preview on mobile)
  useEffect(() => {
    if (isFocused) {
      isHoveringRef.current = true;
      if (canPreview) startTimer();
    } else {
      isHoveringRef.current = false;
      stopPreview();
    }
    return () => { if (timerRef.current) clearTimeout(timerRef.current); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFocused]);

  // Keyboard nav inside the preview panel (capture phase so it intercepts home.tsx)
  useEffect(() => {
    if (!previewActive || !isFocused) return;
    const maxBtn = onFavoriteToggle ? 1 : 0;

    const handler = (e: KeyboardEvent) => {
      if (e.key === 'ArrowLeft') {
        e.stopImmediatePropagation();
        e.preventDefault();
        setPreviewBtnIdx(i => Math.max(0, i - 1));
      } else if (e.key === 'ArrowRight') {
        e.stopImmediatePropagation();
        e.preventDefault();
        setPreviewBtnIdx(i => Math.min(maxBtn, i + 1));
      } else if (e.key === 'Enter') {
        e.stopImmediatePropagation();
        e.preventDefault();
        if (previewBtnIdx === 0) {
          onClick();
        } else if (previewBtnIdx === 1) {
          onFavoriteToggle?.({ stopPropagation: () => {} } as React.MouseEvent);
        }
      }
      // ArrowUp / ArrowDown / Escape → bubble up to let home.tsx close the preview via row nav
    };

    window.addEventListener('keydown', handler, { capture: true });
    return () => window.removeEventListener('keydown', handler, { capture: true });
  }, [previewActive, isFocused, previewBtnIdx, onClick, onFavoriteToggle]);

  const handleMouseEnter = () => {
    if (disableHover) return;
    isHoveringRef.current = true;
    startTimer();
    onHover?.();
  };

  const handleMouseLeave = () => {
    if (disableHover) return;
    isHoveringRef.current = false;
    if (!previewActive) {
      stopPreview();
      onHoverEnd?.();
    }
  };

  const handlePortalLeave = () => {
    isHoveringRef.current = false;
    stopPreview();
    onHoverEnd?.();
  };

  const handleTouchStart = () => {
    // Touch devices never trigger video preview
  };

  const handleTouchEnd = () => {
    // Touch devices never trigger video preview
  };

  const handleTouchCancel = () => {
    isHoveringRef.current = false;
    stopPreview();
  };

  const toggleMute = (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !muted;
    setMuted(next);
    if (videoRef.current) videoRef.current.muted = next;
    if (ytIframeRef.current) {
      ytIframeRef.current.contentWindow?.postMessage(
        JSON.stringify({ event: 'command', func: next ? 'mute' : 'unMute', args: [] }),
        '*'
      );
    }
  };

  const widthClass = portrait ? 'w-28 sm:w-32 md:w-36' : 'w-40 sm:w-44 md:w-48';
  const grad = titleGradient(title);
  const showFallback = !image || imgError;

  // ── Netflix-style preview portal ──────────────────────────────────────────
  const previewPortal = previewActive && cardRect ? createPortal(
    (() => {
      const rawTop = cardRect.top + cardRect.height / 2 - VIDEO_H / 2;
      const rawLeft = cardRect.left + cardRect.width / 2 - PREVIEW_W / 2;
      const top = Math.max(8, Math.min(window.innerHeight - TOTAL_H - 8, rawTop));
      const left = Math.max(8, Math.min(window.innerWidth - PREVIEW_W - 8, rawLeft));

      return (
        <div
          onMouseLeave={handlePortalLeave}
          style={{
            position: 'fixed',
            zIndex: 9999,
            top,
            left,
            width: PREVIEW_W,
            borderRadius: 10,
            overflow: 'hidden',
            boxShadow: '0 24px 80px rgba(0,0,0,0.95)',
            animation: 'fadeIn 0.25s ease-out',
            userSelect: 'none',
          }}
        >
          {/* ── VIDEO SECTION ── */}
          <div style={{ position: 'relative', height: VIDEO_H, background: '#000', overflow: 'hidden' }}>
            {ytSrc ? (
              <>
                {/* Scale iframe to 170% — aggressively clips channel watermark (top), YT logo/title (bottom) */}
                <div style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}>
                  <iframe
                    ref={ytIframeRef}
                    src={ytSrc}
                    allow="autoplay; encrypted-media"
                    style={{
                      position: 'absolute',
                      top: '-35%',
                      left: '-35%',
                      width: '170%',
                      height: '170%',
                      border: 'none',
                      pointerEvents: 'none',
                    }}
                    tabIndex={-1}
                    title={title}
                  />
                </div>
                {/* Transparent overlay blocks hover — prevents YouTube showing center play/pause controls */}
                <div style={{ position: 'absolute', inset: 0, zIndex: 1 }} />
              </>
            ) : isDirectVideo ? (
              <video
                ref={videoRef}
                src={previewUrl!}
                autoPlay
                loop
                playsInline
                muted={muted}
                style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                onError={() => stopPreview()}
              />
            ) : null}

            {/* Bottom gradient */}
            <div style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(to top, rgba(0,0,0,0.75) 0%, transparent 55%)',
              pointerEvents: 'none',
            }} />

            {/* Badge top-left */}
            {badge && (
              <span style={{
                position: 'absolute', top: 8, left: 10,
                background: 'hsl(348 83% 47%)', color: '#fff',
                fontSize: 9, fontWeight: 800,
                padding: '2px 7px', borderRadius: 20,
                letterSpacing: '0.05em', textTransform: 'uppercase',
              }}>
                {badge}
              </span>
            )}

            {/* Title bottom-left */}
            <div style={{ position: 'absolute', bottom: 10, left: 12, right: 44 }}>
              <p style={{
                color: '#fff', fontSize: 14, fontWeight: 700,
                lineHeight: 1.25, margin: 0,
                textShadow: '0 1px 6px rgba(0,0,0,0.9)',
                overflow: 'hidden',
                display: '-webkit-box',
                WebkitLineClamp: 2,
                WebkitBoxOrient: 'vertical',
              }}>{title}</p>
            </div>

            {/* Mute button bottom-right */}
            <button
              onClick={toggleMute}
              style={{
                position: 'absolute', bottom: 10, right: 10,
                width: 30, height: 30, borderRadius: '50%',
                background: 'rgba(20,20,20,0.75)',
                border: '1.5px solid rgba(255,255,255,0.4)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer', color: '#fff',
                transition: 'background 0.15s',
              }}
              title={muted ? 'Activar sonido' : 'Silenciar'}
            >
              {muted
                ? <VolumeX size={13} strokeWidth={2.2} />
                : <Volume2 size={13} strokeWidth={2.2} />
              }
            </button>
          </div>

          {/* ── INFO PANEL ── */}
          <div style={{ background: '#181818', padding: '10px 12px 12px' }}>
            {/* Action buttons */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 9 }}>
              {/* Play */}
              <button
                onClick={(e) => { e.stopPropagation(); stopPreview(); onClick(); }}
                title="Reproducir"
                style={{
                  width: 36, height: 36, borderRadius: '50%',
                  background: '#fff', border: 'none',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'pointer', flexShrink: 0,
                  outline: isFocused && previewBtnIdx === 0 ? '2px solid hsl(348 83% 47%)' : 'none',
                  outlineOffset: 2,
                  boxShadow: isFocused && previewBtnIdx === 0 ? '0 0 0 4px rgba(185,28,28,0.3)' : 'none',
                  transition: 'box-shadow 0.15s',
                }}
              >
                <Play size={16} fill="#111" color="#111" style={{ marginLeft: 2 }} />
              </button>

              {/* Favorite */}
              {onFavoriteToggle && (
                <button
                  onClick={(e) => { e.stopPropagation(); onFavoriteToggle(e); }}
                  title={isFavorite ? 'Quitar de favoritos' : 'Agregar a favoritos'}
                  style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: 'transparent',
                    border: `1.5px solid ${isFavorite ? 'hsl(348 83% 47%)' : 'rgba(255,255,255,0.45)'}`,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    cursor: 'pointer', flexShrink: 0,
                    color: isFavorite ? 'hsl(348 83% 47%)' : '#fff',
                    outline: isFocused && previewBtnIdx === 1 ? '2px solid hsl(348 83% 47%)' : 'none',
                    outlineOffset: 2,
                    boxShadow: isFocused && previewBtnIdx === 1 ? '0 0 0 4px rgba(185,28,28,0.3)' : 'none',
                    transition: 'box-shadow 0.15s',
                  }}
                >
                  <Heart size={14} fill={isFavorite ? 'currentColor' : 'none'} strokeWidth={2} />
                </button>
              )}
            </div>

            {/* Metadata row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {duration && (
                <span style={{ color: 'rgba(255,255,255,0.75)', fontSize: 11, fontWeight: 500 }}>
                  {duration}
                </span>
              )}
            </div>

            {/* Category / subtitle */}
            {subtitle && (
              <p style={{
                color: 'rgba(255,255,255,0.45)',
                fontSize: 11, marginTop: 5, lineHeight: 1.4,
              }}>
                {subtitle}
              </p>
            )}

            {/* Keyboard hint */}
            {isFocused && (
              <p style={{
                color: 'rgba(255,255,255,0.2)',
                fontSize: 9, marginTop: 6, letterSpacing: '0.03em',
              }}>
                ◄ ► Navegar · Enter Seleccionar
              </p>
            )}
          </div>
        </div>
      );
    })(),
    document.body,
  ) : null;

  return (
    <>
      <div
        ref={(el) => {
          innerRef.current = el;
          cardRef?.(el);
        }}
        data-tv-focused={isFocused ? 'true' : undefined}
        className={`flex-shrink-0 ${widthClass} group cursor-pointer select-none transition-transform duration-200 ease-out ${
          isFocused ? 'scale-105 z-20' : 'hover:scale-[1.04] z-10'
        }`}
        onClick={() => { stopPreview(); onClick(); }}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        onTouchCancel={handleTouchCancel}
      >
        <div
          className={`${portrait ? 'aspect-[2/3]' : 'aspect-video'} rounded-lg overflow-hidden relative shadow-md transition-[box-shadow,ring] duration-200 ${
            isFocused
              ? 'ring-2 ring-primary shadow-[0_0_24px_rgba(185,28,28,0.6)] ring-offset-1 ring-offset-background'
              : 'group-hover:shadow-[0_8px_40px_rgba(0,0,0,0.9)] group-hover:ring-1 group-hover:ring-white/20'
          }`}
        >
          {/* Poster / fallback image */}
          {image && !imgError ? (
            <img
              src={image}
              alt={title}
              loading="lazy"
              className={`w-full h-full object-cover transition-transform duration-300 ${
                isFocused ? 'scale-110' : 'scale-100 group-hover:scale-105'
              }`}
              onError={() => setImgError(true)}
            />
          ) : isChannel ? (
            <div className={`w-full h-full flex flex-col items-center justify-center gap-1.5 bg-gradient-to-br ${titleGradient(title)}`}>
              <Tv className="w-7 h-7 text-white/25" />
              <p className="text-white/60 text-[10px] font-semibold text-center leading-snug line-clamp-2 px-2 drop-shadow">
                {title}
              </p>
            </div>
          ) : (
            <div className={`w-full h-full bg-gradient-to-br ${grad} flex flex-col items-center justify-center gap-2 px-3`}>
              <Film className="w-6 h-6 text-white/20 flex-shrink-0" />
              <p className="text-white/70 text-[10px] font-semibold text-center leading-snug line-clamp-3 drop-shadow">
                {title}
              </p>
            </div>
          )}

          {/* Standard overlays */}
          {portrait ? (
            <>
              {!showFallback && (
                <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-transparent to-transparent" />
              )}
              <div
                className={`absolute inset-0 flex items-center justify-center transition-opacity duration-200 ${
                  isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
                }`}
              >
                <div className={`p-2.5 rounded-full bg-black/50 border border-white/30 transition-transform duration-200 ${isFocused ? 'scale-125' : 'scale-100 group-hover:scale-110'}`}>
                  <Play className="w-5 h-5 text-white fill-white" />
                </div>
              </div>
              {!showFallback && (
                <div className="absolute bottom-0 left-0 right-0 p-2 pb-2.5">
                  <p className="text-white text-[11px] font-semibold leading-tight line-clamp-2 drop-shadow-lg">{title}</p>
                  {subtitle && <p className="text-white/50 text-[9px] truncate mt-0.5">{subtitle}</p>}
                </div>
              )}
            </>
          ) : (
            <div
              className={`absolute inset-0 transition-opacity duration-300 ${
                isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/30 to-transparent" />
              <div className="absolute inset-0 flex items-center justify-center">
                <div
                  className={`p-2.5 rounded-full bg-white/25 border border-white/30 transition-transform duration-200 ${
                    isFocused ? 'scale-125 bg-white/35' : 'scale-100 group-hover:scale-110'
                  }`}
                >
                  <Play className="w-5 h-5 sm:w-6 sm:h-6 text-white fill-white drop-shadow-lg" />
                </div>
              </div>
              <div className="absolute bottom-2 left-2 right-8">
                <p className="text-white text-[11px] font-semibold leading-tight line-clamp-2 drop-shadow-lg">{title}</p>
              </div>
            </div>
          )}

          {badge && (
            <span className="absolute top-1.5 left-1.5 bg-primary text-primary-foreground text-[9px] font-bold px-1.5 py-0.5 rounded-full uppercase tracking-wide z-10 shadow-lg">
              {badge}
            </span>
          )}

          {duration && (
            <span className="absolute bottom-1.5 right-1.5 bg-black/80 text-white text-[9px] font-semibold px-1.5 py-0.5 rounded z-10 shadow-md tabular-nums">
              {duration}
            </span>
          )}

          {!isChannel && onInfoClick && (
            <button
              className={`absolute bottom-1.5 left-1.5 p-1.5 rounded-full bg-black/70 z-10 hover:bg-black/90 hover:scale-110 transition-all duration-150 ${
                isFocused ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={onInfoClick}
              title="Ver detalles"
            >
              <Info className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-white" />
            </button>
          )}

          {!isChannel && onFavoriteToggle && (
            <button
              className={`absolute top-1.5 right-1.5 p-1.5 rounded-full bg-black/70 transition-[opacity,transform] duration-150 z-10 hover:bg-black/85 hover:scale-110 ${
                isFocused || isFavorite ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
              }`}
              onClick={onFavoriteToggle}
            >
              <Heart
                className={`w-3 h-3 sm:w-3.5 sm:h-3.5 transition-colors ${
                  isFavorite ? 'fill-red-500 text-red-500' : 'text-white'
                }`}
              />
            </button>
          )}

          {progress && progress.duration > 0 && (
            <>
              <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/50">
                <div
                  className="h-full bg-primary transition-all duration-300"
                  style={{ width: `${Math.min(100, (progress.time / progress.duration) * 100)}%` }}
                />
              </div>
              {progress.time > 0 && (
                <span className="absolute bottom-1.5 left-1.5 bg-black/80 text-[9px] text-white px-1.5 py-0.5 rounded font-medium">
                  {fmtSecs(progress.time)}
                </span>
              )}
            </>
          )}
        </div>

        {!portrait && (
          <div className="mt-2 px-0.5 space-y-0.5">
            <p
              className={`text-[11px] font-semibold leading-[1.35] line-clamp-2 transition-colors duration-200 ${
                isFocused ? 'text-white' : 'text-white/75 group-hover:text-white'
              }`}
            >
              {title}
            </p>
            {subtitle && (
              <p className="text-[9.5px] font-medium text-white/30 truncate tracking-wide uppercase">{subtitle}</p>
            )}
          </div>
        )}
      </div>

      {/* Netflix-style preview portal */}
      {previewPortal}
    </>
  );
});
