import type { AppDb } from "../db";
import { auditLogs } from "../db/schema";

type DbOrTx = Pick<AppDb, "insert">;

export async function recordAuditLog(
  db: DbOrTx,
  input: {
    entityType: string;
    entityId?: number | null;
    action: string;
    before?: unknown;
    after?: unknown;
  },
): Promise<void> {
  await db
    .insert(auditLogs)
    .values({
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      action: input.action,
      beforeJson: input.before !== undefined ? JSON.stringify(input.before) : null,
      afterJson: input.after !== undefined ? JSON.stringify(input.after) : null,
    });
}
