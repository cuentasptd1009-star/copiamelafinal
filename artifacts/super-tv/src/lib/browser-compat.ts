export function isLegacyBrowser(): boolean {
  return !!(window as any).__legacyBrowser;
}

export function useLegacyBrowser(): boolean {
  return isLegacyBrowser();
}
