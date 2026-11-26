import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export type IptvImportedChannel = { name: string; category: string; logo: string; epg: string; url: string };

export type IptvProvider = { server: string; username: string; password: string };

export const iptvUsersTable = pgTable("iptv_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  playlistKey: text("playlist_key").notNull().unique(),
  channelIds: integer("channel_ids").array().notNull(),
  importedChannels: jsonb("imported_channels").$type<IptvImportedChannel[]>().notNull().default([]),
  provider: jsonb("provider").$type<IptvProvider>(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deviceLeases: jsonb("device_leases").$type<Record<string, number>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
});
