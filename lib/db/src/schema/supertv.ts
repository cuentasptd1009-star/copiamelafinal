import {
  pgTable,
  serial,
  text,
  integer,
  boolean,
  timestamp,
  numeric,
  index,
  unique,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const subadminsTable = pgTable("subadmins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  balance: numeric("balance", { precision: 10, scale: 2 }).notNull().default("0"),
  whatsappNumber: text("whatsapp_number"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSubadminSchema = createInsertSchema(subadminsTable).omit({ id: true, createdAt: true });
export type InsertSubadmin = z.infer<typeof insertSubadminSchema>;
export type Subadmin = typeof subadminsTable.$inferSelect;

export const packagesTable = pgTable("packages", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(43200),
  price: numeric("price", { precision: 10, scale: 2 }).notNull().default("0"),
  description: text("description"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPackageSchema = createInsertSchema(packagesTable).omit({ id: true, createdAt: true });
export type InsertPackage = z.infer<typeof insertPackageSchema>;
export type Package = typeof packagesTable.$inferSelect;

export const subadminPackagesTable = pgTable("subadmin_packages", {
  id: serial("id").primaryKey(),
  subadminId: integer("subadmin_id").notNull().references(() => subadminsTable.id, { onDelete: "cascade" }),
  packageId: integer("package_id").notNull().references(() => packagesTable.id, { onDelete: "cascade" }),
  customPrice: numeric("custom_price", { precision: 10, scale: 2 }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  unique("uq_subadmin_package").on(t.subadminId, t.packageId),
]);

export const insertSubadminPackageSchema = createInsertSchema(subadminPackagesTable).omit({ id: true, createdAt: true });
export type InsertSubadminPackage = z.infer<typeof insertSubadminPackageSchema>;
export type SubadminPackage = typeof subadminPackagesTable.$inferSelect;

export const avatarsTable = pgTable("avatars", {
  id: serial("id").primaryKey(),
  name: text("name"),
  imageUrl: text("image_url").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertAvatarSchema = createInsertSchema(avatarsTable).omit({ id: true, createdAt: true });
export type InsertAvatar = z.infer<typeof insertAvatarSchema>;
export type Avatar = typeof avatarsTable.$inferSelect;

export const accessCodesTable = pgTable("access_codes", {
  id: serial("id").primaryKey(),
  code: text("code").notNull().unique(),
  name: text("name"),
  displayName: text("display_name"),
  avatarId: integer("avatar_id").references(() => avatarsTable.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at"),
  isActive: boolean("is_active").notNull().default(true),
  subadminId: integer("subadmin_id").references(() => subadminsTable.id, { onDelete: "set null" }),
  packageId: integer("package_id").references(() => packagesTable.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_access_codes_code").on(t.code),
]);

export const insertAccessCodeSchema = createInsertSchema(accessCodesTable).omit({ id: true, createdAt: true });
export type InsertAccessCode = z.infer<typeof insertAccessCodeSchema>;
export type AccessCode = typeof accessCodesTable.$inferSelect;

export const sessionsTable = pgTable("sessions", {
  id: serial("id").primaryKey(),
  codeId: integer("code_id").notNull().references(() => accessCodesTable.id, { onDelete: "cascade" }),
  deviceId: text("device_id").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  lastActiveAt: timestamp("last_active_at").notNull().defaultNow(),
}, (t) => [
  index("idx_sessions_token").on(t.token),
  index("idx_sessions_code_id").on(t.codeId),
]);

export const insertSessionSchema = createInsertSchema(sessionsTable).omit({ id: true, createdAt: true, lastActiveAt: true });
export type InsertSession = z.infer<typeof insertSessionSchema>;
export type Session = typeof sessionsTable.$inferSelect;

export const adminSessionsTable = pgTable("admin_sessions", {
  id: serial("id").primaryKey(),
  role: text("role").notNull().default("admin"),
  subadminId: integer("subadmin_id").references(() => subadminsTable.id, { onDelete: "cascade" }),
  username: text("username").notNull(),
  token: text("token").notNull().unique(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_admin_sessions_token").on(t.token),
]);

export const insertAdminSessionSchema = createInsertSchema(adminSessionsTable).omit({ id: true, createdAt: true });
export type InsertAdminSession = z.infer<typeof insertAdminSessionSchema>;
export type AdminSession = typeof adminSessionsTable.$inferSelect;

export const channelsTable = pgTable("channels", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  logo: text("logo"),
  category: text("category"),
  streamUrl: text("stream_url").notNull(),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_channels_order").on(t.order),
  index("idx_channels_category").on(t.category),
  index("idx_channels_name").on(t.name),
]);

export const insertChannelSchema = createInsertSchema(channelsTable).omit({ id: true, createdAt: true });
export type InsertChannel = z.infer<typeof insertChannelSchema>;
export type Channel = typeof channelsTable.$inferSelect;

export const moviesTable = pgTable("movies", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  poster: text("poster"),
  banner: text("banner"),
  category: text("category"),
  genre: text("genre"),
  year: integer("year"),
  featured: boolean("featured").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  filePath: text("file_path").notNull(),
  videoFormat: text("video_format"),
  duration: integer("duration"),
  order: integer("order").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_movies_order").on(t.order),
  index("idx_movies_category").on(t.category),
  index("idx_movies_title").on(t.title),
  index("idx_movies_created_at").on(t.createdAt),
]);

export const insertMovieSchema = createInsertSchema(moviesTable).omit({ id: true, createdAt: true });
export type InsertMovie = z.infer<typeof insertMovieSchema>;
export type Movie = typeof moviesTable.$inferSelect;

export const seriesTable = pgTable("series", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  description: text("description"),
  poster: text("poster"),
  banner: text("banner"),
  category: text("category"),
  genre: text("genre"),
  year: integer("year"),
  featured: boolean("featured").notNull().default(false),
  hidden: boolean("hidden").notNull().default(false),
  order: integer("order").notNull().default(0),
  viewCount: integer("view_count").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_series_order").on(t.order),
  index("idx_series_category").on(t.category),
  index("idx_series_title").on(t.title),
]);

export const insertSeriesSchema = createInsertSchema(seriesTable).omit({ id: true, createdAt: true });
export type InsertSeries = z.infer<typeof insertSeriesSchema>;
export type Series = typeof seriesTable.$inferSelect;

export const seasonsTable = pgTable("seasons", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull().references(() => seriesTable.id, { onDelete: "cascade" }),
  seasonNumber: integer("season_number").notNull().default(1),
  title: text("title"),
  poster: text("poster"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_seasons_series_id").on(t.seriesId),
]);

export const insertSeasonSchema = createInsertSchema(seasonsTable).omit({ id: true, createdAt: true });
export type InsertSeason = z.infer<typeof insertSeasonSchema>;
export type Season = typeof seasonsTable.$inferSelect;

export const episodesTable = pgTable("episodes", {
  id: serial("id").primaryKey(),
  seriesId: integer("series_id").notNull().references(() => seriesTable.id, { onDelete: "cascade" }),
  seasonId: integer("season_id").notNull().references(() => seasonsTable.id, { onDelete: "cascade" }),
  episodeNumber: integer("episode_number").notNull().default(1),
  title: text("title").notNull(),
  description: text("description"),
  filePath: text("file_path").notNull(),
  videoFormat: text("video_format"),
  thumbnail: text("thumbnail"),
  duration: integer("duration"),
  order: integer("order").notNull().default(0),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_episodes_season_id").on(t.seasonId),
  index("idx_episodes_series_id").on(t.seriesId),
]);

export const insertEpisodeSchema = createInsertSchema(episodesTable).omit({ id: true, createdAt: true });
export type InsertEpisode = z.infer<typeof insertEpisodeSchema>;
export type Episode = typeof episodesTable.$inferSelect;

export const settingsTable = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const whatsappAlertLogsTable = pgTable("whatsapp_alert_logs", {
  id: serial("id").primaryKey(),
  codeId: integer("code_id").notNull().references(() => accessCodesTable.id, { onDelete: "cascade" }),
  subadminId: integer("subadmin_id").notNull().references(() => subadminsTable.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull().default("expiring_soon"),
  dismissedAt: timestamp("dismissed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
}, (t) => [
  index("idx_wa_alert_code_type").on(t.codeId, t.alertType),
  index("idx_wa_alert_subadmin").on(t.subadminId),
]);

export type WhatsappAlertLog = typeof whatsappAlertLogsTable.$inferSelect;
