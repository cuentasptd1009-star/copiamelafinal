import app from "./app";
import { logger } from "./lib/logger";
import { runMigrations } from "@workspace/db";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

async function start() {
  try {
    await runMigrations();
    logger.info("Database migrations applied");
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.includes("already exists")) {
      logger.info("Schema already up to date, skipping migrations");
    } else {
      logger.error({ err }, "Failed to run database migrations");
      process.exit(1);
    }
  }

  app.listen(port, (err) => {
    if (err) {
      logger.error({ err }, "Error listening on port");
      process.exit(1);
    }

    logger.info({ port }, "Server listening");

    // Keep-alive: ping own health endpoint every 10 min so Render free tier never sleeps
    const selfUrl = process.env["RENDER_EXTERNAL_URL"];
    if (selfUrl) {
      setInterval(() => {
        fetch(`${selfUrl}/api/healthz`)
          .then(() => logger.debug("keep-alive ping sent"))
          .catch(() => {});
      }, 10 * 60 * 1000);
      logger.info("Keep-alive enabled");
    }
  });
}

start();
