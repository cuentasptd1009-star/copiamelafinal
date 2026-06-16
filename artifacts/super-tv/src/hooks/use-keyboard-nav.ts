import { useState, useEffect, useRef } from 'react';
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

  // Keep all props in refs so the listener is registered exactly once
  // and always sees current values without re-registration on every render.
  const enabledRef = useRef(enabled);
  const itemsCountRef = useRef(itemsCount);
  const columnsRef = useRef(columns);
  const onEnterRef = useRef(onEnter);
  const onBackRef = useRef(onBack);
  const activeIndexRef = useRef(activeIndex);

  enabledRef.current = enabled;
  itemsCountRef.current = itemsCount;
  columnsRef.current = columns;
  onEnterRef.current = onEnter;
  onBackRef.current = onBack;
  activeIndexRef.current = activeIndex;

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!enabledRef.current || itemsCountRef.current === 0) return;
      const count = itemsCountRef.current;
      const cols = columnsRef.current;

      switch (normalizeKey(e)) {
        case 'ArrowRight':
          e.preventDefault();
          setActiveIndex((prev) => (prev + 1) % count);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          setActiveIndex((prev) => (prev - 1 + count) % count);
          break;
        case 'ArrowDown':
          e.preventDefault();
          setActiveIndex((prev) => Math.min(prev + cols, count - 1));
          break;
        case 'ArrowUp':
          e.preventDefault();
          setActiveIndex((prev) => Math.max(prev - cols, 0));
          break;
        case 'MediaPlayPause':
        case 'Enter':
          e.preventDefault();
          onEnterRef.current?.(activeIndexRef.current);
          break;
        case 'Escape':
        case 'Backspace':
          e.preventDefault();
          onBackRef.current?.();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, []); // Empty deps: listener registered once; refs keep values current

  return { activeIndex, setActiveIndex };
}
