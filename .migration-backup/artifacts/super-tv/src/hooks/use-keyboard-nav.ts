import { useState, useEffect, useCallback } from 'react';
import { normalizeKey } from '@/lib/tv-remote';

interface UseKeyboardNavProps {
  itemsCount: number;
  columns?: number;
  onEnter?: (index: number) => void;
  onBack?: () => void;
  enabled?: boolean;
}

export function useKeyboardNav({
  itemsCount,
  columns = 1,
  onEnter,
  onBack,
  enabled = true,
}: UseKeyboardNavProps) {
  const [activeIndex, setActiveIndex] = useState(0);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (!enabled || itemsCount === 0) return;

      switch (normalizeKey(e)) {
        case 'ArrowRight':
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % itemsCount);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + itemsCount) % itemsCount);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + columns, itemsCount - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - columns, 0));
          break;
        case 'MediaPlayPause':
        case 'Enter':
          e.preventDefault();
          onEnter?.(activeIndex);
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          onBack?.();
          break;
      }
    },
    [enabled, itemsCount, columns, onEnter, onBack, activeIndex]
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [handleKeyDown]);

  return { activeIndex, setActiveIndex };
}
