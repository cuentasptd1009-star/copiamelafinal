import { useState, useEffect, useCallback, useRef } from 'react';

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
  const [castIsPlaying, setCastIsPlaying] = useState(false);
  const [deviceName, setDeviceName] = useState<string>('');
  const remotePlayerRef = useRef<any>(null);
  const remotePlayerControllerRef = useRef<any>(null);

  useEffect(() => {
    let removeListener: (() => void) | undefined;
    let removePlayerListener: (() => void) | undefined;

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
            if (state === CS.CONNECTED) {
              setCastState('connected');
              try {
                const dn = context.getCurrentSession()?.getCastDevice()?.friendlyName;
                if (dn) setDeviceName(dn);
              } catch {}
            }
            else if (state === CS.CONNECTING) setCastState('connecting');
            // NOT_CONNECTED and NO_DEVICES_AVAILABLE both show the button; 'unavailable' = SDK not loaded
            else { setCastState('available'); setDeviceName(''); }
          } catch {}
        };

        const eventType = window.cast.framework.CastContextEventType.CAST_STATE_CHANGED;
        context.addEventListener(eventType, updateState);
        updateState();
        removeListener = () => context.removeEventListener(eventType, updateState);

        // Set up RemotePlayer to track and control cast playback from the phone
        try {
          const player = new window.cast.framework.RemotePlayer();
          const controller = new window.cast.framework.RemotePlayerController(player);
          remotePlayerRef.current = player;
          remotePlayerControllerRef.current = controller;

          const onPausedChange = () => {
            try { setCastIsPlaying(!player.isPaused); } catch {}
          };
          const RPE = window.cast.framework.RemotePlayerEventType;
          controller.addEventListener(RPE.IS_PAUSED_CHANGED, onPausedChange);
          // Also update on media info change (new media loaded = playing)
          controller.addEventListener(RPE.MEDIA_INFO_CHANGED, onPausedChange);
          removePlayerListener = () => {
            controller.removeEventListener(RPE.IS_PAUSED_CHANGED, onPausedChange);
            controller.removeEventListener(RPE.MEDIA_INFO_CHANGED, onPausedChange);
          };
        } catch {}
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
        removePlayerListener?.();
      };
    }

    return () => { removeListener?.(); removePlayerListener?.(); };
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
    // Optimistically update state so the UI responds immediately even if the SDK
    // is slow or the state-change event doesn't fire (known Chromecast SDK race).
    setCastState(prev => prev === 'connected' ? 'available' : prev);
    try {
      window.cast?.framework?.CastContext?.getInstance()?.endCurrentSession(true);
    } catch {}
  }, []);

  // Toggle play/pause on the Chromecast receiver from the phone
  const castTogglePlay = useCallback(() => {
    try {
      remotePlayerControllerRef.current?.playOrPause();
    } catch {}
  }, []);

  // Seek the Chromecast receiver to a specific time
  const castSeek = useCallback((time: number) => {
    try {
      const player = remotePlayerRef.current;
      if (player) {
        player.currentTime = time;
        remotePlayerControllerRef.current?.seek();
      }
    } catch {}
  }, []);

  // Open the Cast device picker without loading media (for home screen button)
  const requestCast = useCallback(() => {
    try {
      window.cast?.framework?.CastContext?.getInstance()?.requestSession().catch(() => {});
    } catch {}
  }, []);

  return { castState, castIsPlaying, deviceName, castMedia, stopCasting, castTogglePlay, castSeek, requestCast };
}
