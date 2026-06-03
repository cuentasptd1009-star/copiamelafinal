import { v2 as cloudinary } from "cloudinary";
import { randomUUID } from "crypto";

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true,
});

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

export class ObjectStorageService {
  async getObjectEntityUploadParams(): Promise<{
    uploadUrl: string;
    publicId: string;
    signature: string;
    timestamp: number;
    apiKey: string;
    cloudName: string;
  }> {
    const cloudName = process.env.CLOUDINARY_CLOUD_NAME;
    const apiKey = process.env.CLOUDINARY_API_KEY;
    const apiSecret = process.env.CLOUDINARY_API_SECRET;
    if (!cloudName || !apiKey || !apiSecret) {
      throw new Error(
        "CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, and CLOUDINARY_API_SECRET must be set",
      );
    }

    const folder = "super-tv/uploads";
    const publicId = `${folder}/${randomUUID()}`;
    const timestamp = Math.round(Date.now() / 1000);

    const signature = cloudinary.utils.api_sign_request(
      { public_id: publicId, timestamp },
      apiSecret,
    );

    return {
      uploadUrl: `https://api.cloudinary.com/v1_1/${cloudName}/image/upload`,
      publicId,
      signature,
      timestamp,
      apiKey,
      cloudName,
    };
  }

  getPublicUrl(publicId: string): string {
    return cloudinary.url(publicId, {
      secure: true,
      fetch_format: "auto",
      quality: "auto",
    });
  }

  normalizeObjectEntityPath(publicId: string): string {
    return `/objects/${encodeURIComponent(publicId)}`;
  }

  resolveObjectPath(objectPath: string): string {
    if (!objectPath.startsWith("/objects/")) {
      return objectPath;
    }
    const publicId = decodeURIComponent(objectPath.slice("/objects/".length));
    return this.getPublicUrl(publicId);
  }
}
