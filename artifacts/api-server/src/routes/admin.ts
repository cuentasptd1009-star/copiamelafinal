import { Router, type Request, type Response } from "express";
import { db } from "@workspace/db";
import {
  accessCodesTable,
  channelsTable,
  moviesTable,
  subadminsTable,
  packagesTable,
  sessionsTable,
} from "@workspace/db";
import { count, sql, desc } from "drizzle-orm";
import { requireSuperAdmin } from "../lib/auth.js";
import { channelTracker, liveTracker } from "../lib/tracker.js";
import { getSegmentCacheStats } from "./channels.js";
import { cache } from "../lib/cache.js";

const router = Router();

router.get("/admin/stats", requireSuperAdmin, async (req: Request, res: Response) => {
  const cached = cache.get<object>("admin:stats");
  if (cached) { res.json(cached); return; }

  const now = new Date();
  const twoMinutesAgo = new Date(now.getTime() - 2 * 60_000);
  const fifteenMinutesAgo = new Date(now.getTime() - 15 * 60_000);
  const oneDayFromNow = new Date(now.getTime() + 24 * 60 * 60_000);
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60_000);

  const [
    [codesResult],
    [activeCodesResult],
    [expiredCodesResult],
    [channelsResult],
    [moviesResult],
    [subadminsResult],
    [packagesResult],
    [onlineNowResult],
    [activeRecentResult],
    [expiringTodayResult],
    [expiringSoonResult],
    recentSessions,
  ] = await Promise.all([
    db.select({ total: count() }).from(accessCodesTable),
    db.select({ count: count() }).from(accessCodesTable).where(
      sql`${accessCodesTable.isActive} = true AND (${accessCodesTable.expiresAt} IS NULL OR ${accessCodesTable.expiresAt} > NOW())`
    ),
    db.select({ count: count() }).from(accessCodesTable).where(
      sql`${accessCodesTable.expiresAt} IS NOT NULL AND ${accessCodesTable.expiresAt} <= NOW()`
    ),
    db.select({ count: count() }).from(channelsTable),
    db.select({ count: count() }).from(moviesTable),
    db.select({ count: count() }).from(subadminsTable),
    db.select({ count: count() }).from(packagesTable),
    db.select({ count: count() }).from(sessionsTable).where(
      sql`${sessionsTable.lastActiveAt} >= ${twoMinutesAgo}`
    ),
    db.select({ count: count() }).from(sessionsTable).where(
      sql`${sessionsTable.lastActiveAt} >= ${fifteenMinutesAgo}`
    ),
    db.select({ count: count() }).from(accessCodesTable).where(
      sql`${accessCodesTable.isActive} = true AND ${accessCodesTable.expiresAt} IS NOT NULL AND ${accessCodesTable.expiresAt} > NOW() AND ${accessCodesTable.expiresAt} <= ${oneDayFromNow}`
    ),
    db.select({ count: count() }).from(accessCodesTable).where(
      sql`${accessCodesTable.isActive} = true AND ${accessCodesTable.expiresAt} IS NOT NULL AND ${accessCodesTable.expiresAt} > NOW() AND ${accessCodesTable.expiresAt} <= ${sevenDaysFromNow}`
    ),
    db
      .select({
        id: sessionsTable.id,
        deviceId: sessionsTable.deviceId,
        lastActiveAt: sessionsTable.lastActiveAt,
        createdAt: sessionsTable.createdAt,
        codeId: sessionsTable.codeId,
        codeName: accessCodesTable.name,
        codeCode: accessCodesTable.code,
      })
      .from(sessionsTable)
      .leftJoin(accessCodesTable, sql`${sessionsTable.codeId} = ${accessCodesTable.id}`)
      .orderBy(desc(sessionsTable.lastActiveAt))
      .limit(15),
  ]);

  const topChannels = channelTracker.getTop(10);

  const payload = {
    totalCodes: codesResult?.total ?? 0,
    activeCodes: activeCodesResult?.count ?? 0,
    expiredCodes: expiredCodesResult?.count ?? 0,
    totalChannels: channelsResult?.count ?? 0,
    totalMovies: moviesResult?.count ?? 0,
    totalSubadmins: subadminsResult?.count ?? 0,
    totalPackages: packagesResult?.count ?? 0,
    onlineNow: onlineNowResult?.count ?? 0,
    activeRecent: activeRecentResult?.count ?? 0,
    expiringToday: expiringTodayResult?.count ?? 0,
    expiringSoon: expiringSoonResult?.count ?? 0,
    recentSessions: recentSessions.map((s) => ({
      id: s.id,
      deviceId: s.deviceId,
      lastActiveAt: s.lastActiveAt?.toISOString() ?? null,
      createdAt: s.createdAt?.toISOString() ?? null,
      codeName: s.codeName ?? null,
      codeCode: s.codeCode ?? null,
    })),
    topChannels,
  };
  cache.set("admin:stats", payload, 60_000);
  res.json(payload);
});

// Live activity endpoint — returns who is actively playing what right now.
// Not cached; refreshed every 30 s by the admin dashboard.
router.get("/admin/live", requireSuperAdmin, (_req: Request, res: Response) => {
  const live = liveTracker.getLive();
  res.json({
    liveNow: live.map(s => ({
      codeCode: s.codeCode,
      codeName: s.codeName ?? null,
      channelId: s.channelId,
      channelName: s.channelName,
    })),
    liveChannels: liveTracker.getChannelViewers(),
    total: live.length,
    timestamp: new Date().toISOString(),
  });
});

router.get("/admin/stream-stats", requireSuperAdmin, (req: Request, res: Response) => {
  const seg = getSegmentCacheStats();
  res.json({
    segmentCache: seg,
    topChannels: channelTracker.getTop(10),
    timestamp: new Date().toISOString(),
  });
});

export default router;
