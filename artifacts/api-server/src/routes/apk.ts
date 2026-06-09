import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { extractToken, getAdminSession } from "../lib/auth.js";

const router: IRouter = Router();

const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
const APK_DIR = isServerless
  ? path.join("/tmp", "uploads", "apk")
  : path.join(process.cwd(), "uploads", "apk");
const APK_PATH = path.join(APK_DIR, "super-tv.apk");

if (!fs.existsSync(APK_DIR)) {
  fs.mkdirSync(APK_DIR, { recursive: true });
}

const apkStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, APK_DIR),
  filename: (_req, _file, cb) => cb(null, "super-tv.apk"),
});

const uploadApk = multer({
  storage: apkStorage,
  limits: { fileSize: 500 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (
      file.mimetype === "application/vnd.android.package-archive" ||
      file.originalname.toLowerCase().endsWith(".apk") ||
      file.mimetype === "application/octet-stream"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Solo se permiten archivos APK (.apk)"));
    }
  },
});

router.post("/admin/apk/upload", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminSession = await getAdminSession(token);
  if (!adminSession || adminSession.role !== "admin") { res.status(403).json({ error: "Forbidden" }); return; }

  uploadApk.single("apk")(req, res, (err) => {
    if (err) {
      res.status(400).json({ error: err.message || "Error al subir el APK" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No se recibió ningún archivo APK" });
      return;
    }
    res.json({ success: true, filename: "super-tv.apk" });
  });
});

router.get("/apk/info", (_req: Request, res: Response) => {
  const exists = fs.existsSync(APK_PATH);
  if (!exists) {
    res.json({ available: false });
    return;
  }
  const stat = fs.statSync(APK_PATH);
  res.json({ available: true, size: stat.size, updatedAt: stat.mtime.toISOString() });
});

router.get("/apk/download", (_req: Request, res: Response) => {
  if (!fs.existsSync(APK_PATH)) {
    res.status(404).json({ error: "APK no disponible. El administrador aún no ha subido el archivo." });
    return;
  }
  res.setHeader("Content-Disposition", 'attachment; filename="super-tv.apk"');
  res.setHeader("Content-Type", "application/vnd.android.package-archive");
  res.sendFile(APK_PATH);
});

export default router;
