let loaded = false;
const queue: Array<() => void> = [];

export function loadYouTubeApi(cb: () => void): void {
  const w = window as any;
  if (w.YT?.Player) { cb(); return; }
  queue.push(cb);
  if (loaded) return;
  loaded = true;
  const prev = w.onYouTubeIframeAPIReady;
  w.onYouTubeIframeAPIReady = () => {
    prev?.();
    queue.splice(0).forEach(fn => fn());
  };
  const s = document.createElement('script');
  s.src = 'https://www.youtube.com/iframe_api';
  document.head.appendChild(s);
}
