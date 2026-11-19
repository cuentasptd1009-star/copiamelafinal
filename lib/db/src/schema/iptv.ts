import { boolean, integer, jsonb, pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const iptvUsersTable = pgTable("iptv_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  playlistKey: text("playlist_key").notNull().unique(),
  channelIds: integer("channel_ids").array().notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  deviceLeases: jsonb("device_leases").$type<Record<string, number>>().notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
});
