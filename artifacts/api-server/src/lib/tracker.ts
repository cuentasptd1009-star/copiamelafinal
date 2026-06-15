interface ChannelStat {
  channelId: number;
  name: string;
  views: number;
}

class ChannelViewTracker {
  private views = new Map<number, number>();
  private names = new Map<number, string>();

  record(channelId: number, channelName?: string): void {
    const prev = this.views.get(channelId) ?? 0;
    this.views.set(channelId, prev + 1);
    if (channelName) this.names.set(channelId, channelName);
  }

  getTop(n = 10): ChannelStat[] {
    const entries: ChannelStat[] = [];
    for (const [channelId, views] of this.views.entries()) {
      entries.push({ channelId, name: this.names.get(channelId) ?? `Canal ${channelId}`, views });
    }
    entries.sort((a, b) => b.views - a.views);
    return entries.slice(0, n);
  }

  reset(): void {
    this.views.clear();
    this.names.clear();
  }
}

export const channelTracker = new ChannelViewTracker();

// ---------------------------------------------------------------------------
// Live "now playing" tracker — tracks which session is actively watching which
// channel, updated via POST /channels/:id/now-playing heartbeat from client.
// Entries expire after 2 minutes without a heartbeat (lazy cleanup on read).
// ---------------------------------------------------------------------------
interface LiveSession {
  codeId: number;
  codeCode: string;
  codeName?: string | null;
  channelId: number;
  channelName: string;
  updatedAt: number;
}

class LivePlayingTracker {
  private sessions = new Map<string, LiveSession>();

  update(token: string, data: Omit<LiveSession, 'updatedAt'>): void {
    this.sessions.set(token, { ...data, updatedAt: Date.now() });
  }

  remove(token: string): void {
    this.sessions.delete(token);
  }

  getLive(maxAgeMs = 2 * 60_000): LiveSession[] {
    const now = Date.now();
    const live: LiveSession[] = [];
    for (const [token, entry] of this.sessions.entries()) {
      if (now - entry.updatedAt < maxAgeMs) {
        live.push(entry);
      } else {
        this.sessions.delete(token);
      }
    }
    return live;
  }

  getChannelViewers(): { channelId: number; name: string; count: number }[] {
    const live = this.getLive();
    const counts = new Map<number, { name: string; count: number }>();
    for (const s of live) {
      const prev = counts.get(s.channelId);
      if (prev) { prev.count++; }
      else { counts.set(s.channelId, { name: s.channelName, count: 1 }); }
    }
    return Array.from(counts.entries())
      .map(([channelId, { name, count }]) => ({ channelId, name, count }))
      .sort((a, b) => b.count - a.count);
  }
}

export const liveTracker = new LivePlayingTracker();
