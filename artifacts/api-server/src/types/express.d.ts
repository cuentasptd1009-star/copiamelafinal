import type { Session, AdminSession } from "@workspace/db";

declare global {
  namespace Express {
    interface Request {
      userSession?: Session;
      userCode?: { isActive: boolean; expiresAt: Date | null };
      adminSession?: AdminSession;
    }
  }
}
