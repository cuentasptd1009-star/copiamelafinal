import { boolean, integer, pgTable, serial, text } from "drizzle-orm/pg-core";

export const iptvUsersTable = pgTable("iptv_users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  playlistKey: text("playlist_key").notNull().unique(),
  channelIds: integer("channel_ids").array().notNull(),
  enabled: boolean("enabled").notNull().default(true),
});
