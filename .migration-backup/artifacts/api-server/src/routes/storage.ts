import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { ObjectStorageService, ObjectNotFoundError } from "../lib/objectStorage.js";
import { extractToken, getUserSession, getAdminSession } from "../lib/auth.js";

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

const ALLOWED_CONTENT_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp"] as const;
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

const RequestUploadUrlBody = z.object({
  name: z.string(),
  size: z.number(),
  contentType: z.string(),
});

router.post("/storage/uploads/request-url", async (req: Request, res: Response) => {
  const token = extractToken(req);
  if (!token) { res.status(401).json({ error: "Unauthorized" }); return; }
  const userSession = await getUserSession(token);
  const adminSession = await getAdminSession(token);
  if (!userSession && !adminSession) { res.status(401).json({ error: "Unauthorized" }); return; }

  const parsed = RequestUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Missing or invalid required fields" });
    return;
  }

  const { name, size, contentType } = parsed.data;

  if (!(ALLOWED_CONTENT_TYPES as readonly string[]).includes(contentType)) {
    res.status(400).json({ error: "Tipo de archivo no permitido. Solo se aceptan imágenes JPG, PNG o WebP." });
    return;
  }

  if (size > MAX_FILE_SIZE_BYTES) {
    res.status(400).json({ error: "El archivo es demasiado grande. El tamaño máximo es 5 MB." });
    return;
  }

  try {
    const params = await objectStorageService.getObjectEntityUploadParams();
    const objectPath = objectStorageService.normalizeObjectEntityPath(params.publicId);

    res.json({
      uploadURL: params.uploadUrl,
      objectPath,
      cloudinaryParams: {
        public_id: params.publicId,
        signature: params.signature,
        timestamp: params.timestamp,
        api_key: params.apiKey,
      },
      metadata: { name, size, contentType },
    });
  } catch (error) {
    console.error("Error generating upload params", error);
    res.status(500).json({ error: "Failed to generate upload params" });
  }
});

router.get("/storage/objects/*path", (req: Request, res: Response) => {
  try {
    const raw = req.params.path;
    const wildcardPath = Array.isArray(raw) ? raw.join("/") : raw;
    const objectPath = `/objects/${wildcardPath}`;
    const redirectUrl = objectStorageService.resolveObjectPath(objectPath);
    res.redirect(302, redirectUrl);
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Object not found" });
      return;
    }
    console.error("Error resolving object", error);
    res.status(500).json({ error: "Failed to resolve object" });
  }
});

export default router;
