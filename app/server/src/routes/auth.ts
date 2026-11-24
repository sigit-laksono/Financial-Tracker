import { and, eq, isNull, sql } from "drizzle-orm";
import { Hono } from "hono";
import { changePinSchema, pinSchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { appSettings } from "../db/schema";
import { recordAuditLog } from "../lib/auditService";
import {
  clearSessionCookie,
  clientRateKey,
  getSessionSecret,
  hashPin,
  invalidateAuthCache,
  isRequestAuthenticated,
  issueSessionCookie,
  LoginRateLimiter,
  verifyPin,
} from "../lib/auth";
import { getSettings, runDailyLedgerSync } from "../lib/ledger";

export function createAuthRoutes(
  db: AppDb,
  options: { secret?: string; rateLimiter?: LoginRateLimiter } = {},
) {
  const router = new Hono();
  const secret = options.secret ?? getSessionSecret();
  const limiter = options.rateLimiter ?? new LoginRateLimiter();

  router.get("/status", async (c) => {
    const status = await isRequestAuthenticated(c, db, secret);
    return c.json(status);
  });

  router.post("/setup", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = pinSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "PIN tidak valid." }, 400);
    }

    const pinHash = await hashPin(parsed.data.pin);
    const updated = await db.transaction(async (tx) => {
      await tx.insert(appSettings).values({ id: 1 }).onConflictDoNothing();
      const rows = await tx
        .update(appSettings)
        .set({
          pinHash,
          sessionVersion: sql`${appSettings.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(and(eq(appSettings.id, 1), isNull(appSettings.pinHash)))
        .returning({ sessionVersion: appSettings.sessionVersion });
      return rows[0] ?? null;
    });

    if (!updated) {
      return c.json({ error: "PIN sudah pernah diatur. Gunakan menu Ubah PIN." }, 409);
    }

    invalidateAuthCache(db);
    await runDailyLedgerSync(db);
    issueSessionCookie(c, secret, updated.sessionVersion);
    return c.json({ ok: true, pinConfigured: true, authenticated: true });
  });

  router.post("/login", async (c) => {
    const key = `login:${clientRateKey(c)}`;
    const limit = limiter.check(key);
    if (!limit.allowed) {
      return c.json(
        { error: `Terlalu banyak percobaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.` },
        429,
      );
    }

    const body = await c.req.json().catch(() => null);
    const parsed = pinSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Masukkan PIN atau kata sandi." }, 400);
    }

    const settings = await getSettings(db);
    if (!settings.pinHash) {
      return c.json({ ok: true, pinConfigured: false, authenticated: true });
    }

    const valid = await verifyPin(parsed.data.pin, settings.pinHash);
    if (!valid) {
      limiter.recordFailure(key);
      return c.json({ error: "PIN atau kata sandi salah." }, 401);
    }

    limiter.reset(key);
    await runDailyLedgerSync(db);
    issueSessionCookie(c, secret, settings.sessionVersion);
    return c.json({ ok: true, pinConfigured: true, authenticated: true });
  });

  router.post("/logout", async (c) => {
    const body = (await c.req.json().catch(() => null)) as { all?: boolean } | null;
    const revokeAll = c.req.query("all") === "true" || body?.all === true;
    if (revokeAll) {
      await db
        .update(appSettings)
        .set({
          sessionVersion: sql`${appSettings.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 1));
      invalidateAuthCache(db);
    }
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  router.post("/logout-all", async (c) => {
    await db
      .update(appSettings)
      .set({
        sessionVersion: sql`${appSettings.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1));
    invalidateAuthCache(db);
    clearSessionCookie(c);
    return c.json({ ok: true });
  });

  router.post("/change-pin", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = changePinSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: "Payload ubah PIN tidak valid." }, 400);
    }

    const key = `change-pin:${clientRateKey(c)}`;
    const settings = await getSettings(db);
    if (settings.pinHash) {
      const limit = limiter.check(key);
      if (!limit.allowed) {
        return c.json(
          { error: `Terlalu banyak percobaan. Coba lagi dalam ${limit.retryAfterSeconds} detik.` },
          429,
        );
      }

      const current = parsed.data.currentPin?.trim() ?? "";
      if (!current) {
        return c.json({ error: "Masukkan PIN saat ini untuk konfirmasi." }, 400);
      }
      const ok = await verifyPin(current, settings.pinHash);
      if (!ok) {
        limiter.recordFailure(key);
        return c.json({ error: "PIN saat ini tidak sesuai." }, 401);
      }
      limiter.reset(key);
    }

    const nextPin = parsed.data.newPin?.trim() ?? "";
    if (nextPin.length === 0) {
      await db
        .update(appSettings)
        .set({
          pinHash: null,
          sessionVersion: sql`${appSettings.sessionVersion} + 1`,
          updatedAt: new Date(),
        })
        .where(eq(appSettings.id, 1));
      invalidateAuthCache(db);
      await recordAuditLog(db, {
        entityType: "auth",
        entityId: 1,
        action: "change_pin",
        before: { pinConfigured: Boolean(settings.pinHash) },
        after: { pinConfigured: false },
      });
      clearSessionCookie(c);
      return c.json({ ok: true, pinConfigured: false });
    }

    if (nextPin.length < 4) {
      return c.json({ error: "PIN baru minimal 4 karakter." }, 400);
    }

    const pinHash = await hashPin(nextPin);
    const [updated] = await db
      .update(appSettings)
      .set({
        pinHash,
        sessionVersion: sql`${appSettings.sessionVersion} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(appSettings.id, 1))
      .returning({ sessionVersion: appSettings.sessionVersion });

    invalidateAuthCache(db);

    await recordAuditLog(db, {
      entityType: "auth",
      entityId: 1,
      action: "change_pin",
      before: { pinConfigured: Boolean(settings.pinHash) },
      after: { pinConfigured: true },
    });

    issueSessionCookie(c, secret, updated?.sessionVersion ?? settings.sessionVersion + 1);
    return c.json({ ok: true, pinConfigured: true });
  });

  return router;
}
