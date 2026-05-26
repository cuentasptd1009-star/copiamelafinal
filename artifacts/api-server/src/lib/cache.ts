interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

class InMemoryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private timers = new Map<string, ReturnType<typeof setTimeout>>();

  get<T>(key: string): T | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() > entry.expiresAt) {
      this.delete(key);
      return undefined;
    }
    return entry.value as T;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    if (this.timers.has(key)) {
      clearTimeout(this.timers.get(key)!);
    }
    this.store.set(key, { value, expiresAt: Date.now() + ttlMs });
    const timer = setTimeout(() => this.delete(key), ttlMs);
    this.timers.set(key, timer);
  }

  delete(key: string): void {
    this.store.delete(key);
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  invalidatePrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.delete(key);
      }
    }
  }

  size(): number {
    return this.store.size;
  }
}

export const cache = new InMemoryCache();

export const TTL = {
  SHORT: 120_000,
  MEDIUM: 300_000,
  LONG: 600_000,
} as const;
