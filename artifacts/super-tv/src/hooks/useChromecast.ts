import { useState, useEffect, useCallback } from 'react';

declare global {
  interface Window {
    cast?: any;
    chrome?: any;
    __castApiAvailable?: boolean;
    __onGCastApiAvailable?: (isAvailable: boolean) => void;
  }
}

const CAST_APP_ID = 'CC1AD845';

export type CastState = 'unavailable' | 'available' | 'connecting' | 'connected';

function getContentType(url: string, format: string): string {
  if (format === 'hls' || url.includes('.m3u8') || url.includes('hls-proxy')) return 'application/x-mpegurl';
  if (format === 'dash' || url.includes('.mpd')) return 'application/dash+xml';
  return 'video/mp4';
}

function loadMediaOnSession(session: any, url: string, title: string, format: string) {
  try {
    const contentType = getContentType(url, format);
    const mediaInfo = new window.chrome.cast.media.MediaInfo(url, contentType);
    mediaInfo.metadata = new window.chrome.cast.media.GenericMediaMetadata();
    mediaInfo.metadata.title = title;
    const request = new window.chrome.cast.media.LoadRequest(mediaInfo);
    request.autoplay = true;
    session.loadMedia(request).catch(() => {});
  } catch {}
}

export function useChromecast() {
  const [castState, setCastState] = useState<CastState>('unavailable');

  useEffect(() => {
    let removeListener: (() => void) | undefined;

    const initCast = () => {
      if (!window.cast?.framework || !window.chrome?.cast) return;
      try {
        const context = window.cast.framework.CastContext.getInstance();
        context.setOptions({
          receiverApplicationId: CAST_APP_ID,
          autoJoinPolicy: window.chrome.cast.AutoJoinPolicy.ORIGIN_SCOPED,
        });

        const updateState = () => {
          try {
            const state = context.getCastState();
            const CS = window.cast.framework.CastState;
            if (state === CS.CONNECTED) setCastState('connected');
            else if (state === CS.CONNECTING) setCastState('connecting');
            else if (state === CS.NOT_CONNECTED) setCastState('available');
            else setCastState('unavailable');
          } catch {}
        };

        const eventType = window.cast.framework.CastContextEventType.CAST_STATE_CHANGED;
        context.addEventListener(eventType, updateState);
        updateState();
        removeListener = () => context.removeEventListener(eventType, updateState);
      } catch {}
    };

    if (window.__castApiAvailable) {
      initCast();
    } else {
      const onAvailable = () => initCast();
      window.addEventListener('castApiAvailable', onAvailable);
      return () => {
        window.removeEventListener('castApiAvailable', onAvailable);
        removeListener?.();
      };
    }

    return () => removeListener?.();
  }, []);

  const castMedia = useCallback((url: string, title: string, format: string = 'hls') => {
    if (!window.cast?.framework || !window.chrome?.cast) return;
    try {
      const context = window.cast.framework.CastContext.getInstance();
      const session = context.getCurrentSession();
      if (session) {
        loadMediaOnSession(session, url, title, format);
      } else {
        context.requestSession().then(() => {
          const newSession = context.getCurrentSession();
          if (newSession) loadMediaOnSession(newSession, url, title, format);
        }).catch(() => {});
      }
    } catch {}
  }, []);

  const stopCasting = useCallback(() => {
    try {
      window.cast?.framework?.CastContext?.getInstance()?.endCurrentSession(true);
    } catch {}
  }, []);

  return { castState, castMedia, stopCasting };
}
