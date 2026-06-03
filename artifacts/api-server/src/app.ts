import express, { type Express } from "express";
import cors from "cors";
import compression from "compression";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const app: Express = express();

app.use(compression({ threshold: 1024 }));

app.use(
  pinoHttp({
    logger,
    autoLogging: {
      ignore(req) {
        const url = req.url ?? "";
        return url.includes("/hls-relay") || url.includes("/hls-proxy") || url.includes("/health");
      },
    },
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
app.use(cors());
app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: false, limit: "2mb" }));

app.use("/api", router);

export default app;
