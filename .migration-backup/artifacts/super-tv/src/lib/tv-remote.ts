/**
 * TV Remote Key Normalizer
 *
 * Maps platform-specific remote control keys (Android TV, Fire TV, Samsung Tizen,
 * LG WebOS, Roku, Sony Bravia, etc.) to consistent key strings so all existing
 * keyboard switch-statements work without modification.
 *
 * Usage:
 *   import { normalizeKey } from '@/lib/tv-remote';
 *   // replace:  switch (e.key)
 *   // with:     switch (normalizeKey(e))
 */

export function normalizeKey(e: KeyboardEvent): string {
  switch (e.key) {
    // ── Play / Pause ──────────────────────────────────────────────────────────
    case 'MediaPlay':
    case 'MediaPause':
    case 'MediaPlayPause':
      return 'MediaPlayPause';

    // ── Stop → treat as back/exit ─────────────────────────────────────────────
    case 'MediaStop':
      return 'Escape';

    // ── Fast Forward / Next track ─────────────────────────────────────────────
    case 'MediaFastForward':
    case 'FastFwd':
    case 'MediaTrackNext':
      return 'MediaFastForward';

    // ── Rewind / Previous track ───────────────────────────────────────────────
    case 'MediaRewind':
    case 'Rewind':
    case 'MediaTrackPrevious':
      return 'MediaRewind';

    // ── Back button ───────────────────────────────────────────────────────────
    // Android TV / Fire TV send GoBack (keyCode 4) or BrowserBack
    case 'GoBack':
    case 'BrowserBack':
    case 'XF86Back':
      return 'Escape';

    // ── Volume ────────────────────────────────────────────────────────────────
    case 'VolumeUp':
    case 'AudioVolumeUp':
      return 'VolumeUp';

    case 'VolumeDown':
    case 'AudioVolumeDown':
      return 'VolumeDown';

    case 'VolumeMute':
    case 'AudioVolumeMute':
    case 'MicrophoneVolumeMute':
      return 'VolumeMute';

    // ── Channel change (Tizen, WebOS, HbbTV) ─────────────────────────────────
    case 'ChannelUp':
    case 'MediaChannelUp':
      return 'ChannelUp';

    case 'ChannelDown':
    case 'MediaChannelDown':
      return 'ChannelDown';

    // ── Info / Guide ──────────────────────────────────────────────────────────
    case 'Info':
    case 'Guide':
    case 'XF86Info':
      return 'Info';

    // ── Directional aliases (some older TVs omit "Arrow" prefix) ─────────────
    case 'Up':    return 'ArrowUp';
    case 'Down':  return 'ArrowDown';
    case 'Left':  return 'ArrowLeft';
    case 'Right': return 'ArrowRight';

    // ── Select / OK / Return aliases ──────────────────────────────────────────
    case 'Return':
    case 'Select':
    case 'Accept':
    case 'OK':
      return 'Enter';

    // ── Colored buttons (Samsung, LG) ─────────────────────────────────────────
    // ColorF0Red = Red, ColorF1Green = Green, ColorF2Yellow = Yellow, ColorF3Blue = Blue
    case 'ColorF0Red':    return 'ColorRed';
    case 'ColorF1Green':  return 'ColorGreen';
    case 'ColorF2Yellow': return 'ColorYellow';
    case 'ColorF3Blue':   return 'ColorBlue';

    default:
      return e.key;
  }
}

/** Returns true if the event comes from a TV remote (not a standard keyboard) */
export function isTvRemoteKey(e: KeyboardEvent): boolean {
  return [
    'MediaPlay','MediaPause','MediaPlayPause','MediaStop',
    'MediaFastForward','MediaRewind','MediaTrackNext','MediaTrackPrevious',
    'FastFwd','Rewind','GoBack','BrowserBack','XF86Back',
    'VolumeUp','VolumeDown','VolumeMute','AudioVolumeUp','AudioVolumeDown','AudioVolumeMute',
    'ChannelUp','ChannelDown','MediaChannelUp','MediaChannelDown',
    'Info','Guide','ColorF0Red','ColorF1Green','ColorF2Yellow','ColorF3Blue',
    'Return','Select','Accept','OK',
  ].includes(e.key);
}
