import { Router, type IRouter, type Request, type Response } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { extractToken, getAdminSession } from "../lib/auth.js";

const router: IRouter = Router();

const isServerless = process.env.VERCEL === "1" || process.env.AWS_LAMBDA_FUNCTION_NAME !== undefined;
const UPLOADS_DIR = isServerless
  ? path.join("/tmp", "uploads", "videos")
  : path.join(process.cwd(), "uploads", "videos");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const ext = path.extname(file.originalname);
    cb(null, `${unique}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = [
      "video/mp4", "video/x-matroska", "video/webm", "video/avi",
      "video/quicktime", "video/x-msvideo", "video/mpeg",
      "video/x-flv", "video/ogg", "application/octet-stream",
    ];
    if (allowed.includes(file.mimetype) || file.mimetype.startsWith("video/")) {
      cb(null, true);
    } else {
      const ext = path.extname(file.originalname).toLowerCase();
      const videoExts = [".mp4", ".mkv", ".avi", ".mov", ".wmv", ".flv", ".webm", ".mpeg", ".mpg", ".ts", ".m2ts"];
      if (videoExts.includes(ext)) {
        cb(null, true);
      } else {
        cb(new Error("Solo se permiten archivos de video"));
      }
    }
  },
});

router.post("/videos/upload", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const adminSession = await getAdminSession(token);
  if (!adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const uploadSingle = upload.single("file");
  uploadSingle(req, res, (err) => {
    if (err) {
      console.error("Upload error:", err);
      res.status(400).json({ error: err.message || "Error al subir el archivo" });
      return;
    }
    if (!req.file) {
      res.status(400).json({ error: "No se recibió ningún archivo" });
      return;
    }

    const filePath = `/api/videos/files/${req.file.filename}`;
    res.json({ filePath, filename: req.file.filename, size: req.file.size });
  });
});

router.get("/videos/files/:filename", (req: Request, res: Response) => {
  const filename = path.basename(req.params.filename);
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(404).json({ error: "Archivo no encontrado" });
    return;
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunkSize = end - start + 1;

    res.writeHead(206, {
      "Content-Range": `bytes ${start}-${end}/${fileSize}`,
      "Accept-Ranges": "bytes",
      "Content-Length": chunkSize,
      "Content-Type": "video/mp4",
    });
    fs.createReadStream(filePath, { start, end }).pipe(res);
  } else {
    res.writeHead(200, {
      "Content-Length": fileSize,
      "Content-Type": "video/mp4",
      "Accept-Ranges": "bytes",
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

export default router;
