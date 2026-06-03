import app from "./app";
import { runMigrations } from "@workspace/db";
import { logger } from "./lib/logger";

export const ready: Promise<void> = runMigrations()
  .then(() => {
    logger.info("Database migrations applied (serverless)");
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists")) {
      logger.info("Schema already up to date (serverless)");
    } else {
      logger.error({ err }, "Failed to run database migrations (serverless)");
    }
  });

export { app };
