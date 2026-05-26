import { useState, useEffect, useCallback } from 'react';
import { tvKeyboardStore } from '@/lib/tv-keyboard-store';
import { Delete, Check } from 'lucide-react';

const ROWS = [
  ['1','2','3','4','5','6','7','8','9','0','⌫'],
  ['Q','W','E','R','T','Y','U','I','O','P'],
  ['A','S','D','F','G','H','J','K','L'],
  ['Z','X','C','V','B','N','M'],
  ['ESPACIO','✓'],
];

const ROW_OFFSETS = [0, 0, 0.5, 1.5, 0];

export function TvKeyboard() {
  const [kbState, setKbState] = useState(tvKeyboardStore.getState());
  const [row, setRow] = useState(1);
  const [col, setCol] = useState(0);

  useEffect(() => {
    let prevVisible = tvKeyboardStore.getState().visible;
    const unsub = tvKeyboardStore.subscribe(s => {
      setKbState(s);
      // Only reset cursor position when the keyboard becomes newly visible
      if (s.visible && !prevVisible) { setRow(1); setCol(0); }
      prevVisible = s.visible;
    });
    return () => { unsub(); };
  }, []);

  const pressKey = useCallback((key: string) => {
    const cur = tvKeyboardStore.getState().value;
    const max = tvKeyboardStore.getState().maxLength;
    if (key === '⌫') {
      tvKeyboardStore.setValue(cur.slice(0, -1));
    } else if (key === 'ESPACIO') {
      if (!max || cur.length < max) tvKeyboardStore.setValue(cur + ' ');
    } else if (key === '✓') {
      const confirm = tvKeyboardStore.getState().onConfirm;
      tvKeyboardStore.close();
      confirm();
    } else {
      if (!max || cur.length < max) tvKeyboardStore.setValue(cur + key);
    }
  }, []);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!tvKeyboardStore.getState().visible) return;

    const currentRow = ROWS[row];
    const maxCol = currentRow.length - 1;

    switch (e.key) {
      case 'ArrowRight':
        e.preventDefault();
        e.stopPropagation();
        setCol(c => Math.min(c + 1, maxCol));
        break;
      case 'ArrowLeft':
        e.preventDefault();
        e.stopPropagation();
        setCol(c => Math.max(c - 1, 0));
        break;
      case 'ArrowDown':
        e.preventDefault();
        e.stopPropagation();
        setRow(r => {
          const nr = Math.min(r + 1, ROWS.length - 1);
          setCol(c => Math.min(c, ROWS[nr].length - 1));
          return nr;
        });
        break;
      case 'ArrowUp':
        e.preventDefault();
        e.stopPropagation();
        if (row === 0) {
          tvKeyboardStore.close();
        } else {
          setRow(r => {
            const nr = Math.max(r - 1, 0);
            setCol(c => Math.min(c, ROWS[nr].length - 1));
            return nr;
          });
        }
        break;
      case 'Enter':
      case ' ':
        e.preventDefault();
        e.stopPropagation();
        pressKey(ROWS[row][col]);
        break;
      case 'Escape':
        e.preventDefault();
        e.stopPropagation();
        tvKeyboardStore.close();
        break;
      case 'Backspace':
        e.preventDefault();
        e.stopPropagation();
        tvKeyboardStore.setValue(tvKeyboardStore.getState().value.slice(0, -1));
        break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
          e.preventDefault();
          e.stopPropagation();
          const ch = e.key.toUpperCase();
          const max = tvKeyboardStore.getState().maxLength;
          const cur = tvKeyboardStore.getState().value;
          if (!max || cur.length < max) tvKeyboardStore.setValue(cur + ch);
        }
    }
  }, [row, col, pressKey]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [handleKeyDown]);

  if (!kbState.visible) return null;

  return (
    <div className="fixed inset-0 z-[200] flex flex-col items-center justify-end bg-black/60 backdrop-blur-sm pb-4 px-2">
      <div
        className="w-full max-w-2xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden"
        style={{ animation: 'slideUpFade 0.18s ease-out' }}
      >
        <div className="px-4 pt-4 pb-2">
          {kbState.label && (
            <p className="text-xs text-muted-foreground mb-1 font-medium">{kbState.label}</p>
          )}
          <div className="min-h-10 bg-background border border-border rounded-lg px-3 py-2 flex items-center">
            <span className="text-foreground font-mono text-sm tracking-widest flex-1 truncate">
              {kbState.value || <span className="text-muted-foreground/40 font-sans tracking-normal not-italic">...</span>}
            </span>
            <span className="w-0.5 h-4 bg-primary animate-pulse ml-1 flex-shrink-0" />
          </div>
        </div>

        <div className="px-3 pb-4 space-y-1.5">
          {ROWS.map((rowKeys, ri) => (
            <div
              key={ri}
              className="flex justify-center gap-1"
              style={{ paddingLeft: `${ROW_OFFSETS[ri] * 2}rem` }}
            >
              {rowKeys.map((key, ci) => {
                const focused = ri === row && ci === col;
                const isWide = key === 'ESPACIO';
                const isConfirm = key === '✓';
                const isBackspace = key === '⌫';
                return (
                  <button
                    key={key}
                    onClick={() => pressKey(key)}
                    className={`
                      h-10 rounded-lg text-sm font-semibold transition-all duration-100 select-none
                      flex items-center justify-center
                      ${isWide ? 'flex-1 min-w-[8rem]' : isConfirm ? 'w-20' : 'w-9'}
                      ${focused
                        ? isConfirm
                          ? 'bg-primary text-primary-foreground ring-2 ring-white/60 scale-105 shadow-lg'
                          : isBackspace
                          ? 'bg-destructive/80 text-white ring-2 ring-white/60 scale-105'
                          : 'bg-primary text-primary-foreground ring-2 ring-white/60 scale-105 shadow-lg'
                        : isConfirm
                        ? 'bg-primary/20 text-primary hover:bg-primary/30'
                        : isBackspace
                        ? 'bg-destructive/20 text-destructive hover:bg-destructive/30'
                        : 'bg-muted text-foreground hover:bg-muted/80'
                      }
                    `}
                  >
                    {isBackspace ? <Delete className="w-4 h-4" /> : isConfirm ? <><Check className="w-4 h-4 mr-1" /><span>OK</span></> : key === 'ESPACIO' ? '___' : key}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <p className="text-[10px] text-center text-muted-foreground/40 pb-2">
          Flechas para navegar · Enter para escribir · Esc para cerrar
        </p>
      </div>

      <style>{`
        @keyframes slideUpFade {
          from { opacity: 0; transform: translateY(24px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>
  );
}
