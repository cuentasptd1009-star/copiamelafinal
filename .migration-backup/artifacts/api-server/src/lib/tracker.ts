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
