import { eq } from "drizzle-orm";
import type { AppDb } from "../db";
import { appSettings } from "../db/schema";

export async function getSettings(db: AppDb) {
  const rows = await db.select().from(appSettings).where(eq(appSettings.id, 1)).limit(1);
  if (rows[0]) return rows[0];
  const inserted = await db.insert(appSettings).values({ id: 1 }).returning();
  if (!inserted[0]) throw new Error("Gagal membaca pengaturan aplikasi.");
  return inserted[0];
}
