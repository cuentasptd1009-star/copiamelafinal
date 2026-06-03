import { useCallback } from 'react';
import { tvKeyboardStore } from '@/lib/tv-keyboard-store';

function isTvBrowser(): boolean {
  const ua = navigator.userAgent;
  return (
    /Tizen/i.test(ua) ||       // Samsung Smart TV
    /Web0S|WebOS/i.test(ua) || // LG Smart TV
    /HbbTV/i.test(ua) ||       // Generic Smart TV standard
    /SMART-TV|SmartTV/i.test(ua) ||
    /\bTV\b/i.test(ua) ||      // Generic "TV" token
    /AFT[A-Z0-9]+/i.test(ua) || // Amazon Fire TV
    /BRAVIA/i.test(ua) ||       // Sony Bravia
    /Roku/i.test(ua) ||
    /PhilipsTV/i.test(ua) ||
    /OPR\/.*TV/i.test(ua)       // Opera TV
  );
}

interface OpenKeyboardOptions {
  value: string;
  onChange: (v: string) => void;
  onConfirm?: () => void;
  label?: string;
  maxLength?: number;
}

export function useTvKeyboard() {
  const openKeyboard = useCallback((
    el: HTMLInputElement | null,
    opts?: OpenKeyboardOptions
  ) => {
    if (opts) {
      if (!isTvBrowser()) {
        if (el) {
          el.removeAttribute('readonly');
          el.focus();
          try { el.click(); } catch {}
        }
        return;
      }
      tvKeyboardStore.open({
        value: opts.value,
        onChange: opts.onChange,
        onConfirm: opts.onConfirm ?? (() => {}),
        label: opts.label,
        maxLength: opts.maxLength,
      });
      return;
    }
    if (!el) return;
    el.blur();
    setTimeout(() => {
      el.removeAttribute('readonly');
      el.focus({ preventScroll: false });
      try { el.click(); } catch {}
    }, 50);
  }, []);

  const closeKeyboard = useCallback(() => {
    tvKeyboardStore.close();
  }, []);

  return { openKeyboard, closeKeyboard };
}
