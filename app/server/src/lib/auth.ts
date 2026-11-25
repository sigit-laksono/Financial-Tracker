import { createHmac, timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { eq } from "drizzle-orm";
import type { AppDb } from "../db";
import { appSettings } from "../db/schema";

const SESSION_COOKIE_NAME = "ft_session";
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;
const RATE_LIMIT_MAX_ATTEMPTS = 5;
const RATE_LIMIT_GLOBAL_MAX_ATTEMPTS = 20;
const RATE_LIMIT_WINDOW_MS = 60_000;
const DEV_FALLBACK_SECRET = "dev-local-financial-tracker-secret-key";
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  DEV_FALLBACK_SECRET,
  "financial-tracker-production-secret-min-32-chars-long",
  "change-this-to-a-long-random-secret-before-vps-deploy",
  "replace-with-at-least-32-random-characters",
]);

export class LoginRateLimiter {
  static readonly MAX_ENTRIES = 1000;
  private attempts = new Map<string, { count: number; resetAt: number }>();
  private globalEntry: { count: number; resetAt: number } | null = null;

  private prune(now: number): void {
    for (const [key, entry] of this.attempts.entries()) {
      if (now >= entry.resetAt) {
        this.attempts.delete(key);
      }
    }
  }

  checkGlobal(now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    if (!this.globalEntry || now >= this.globalEntry.resetAt) {
      this.globalEntry = null;
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (this.globalEntry.count >= RATE_LIMIT_GLOBAL_MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((this.globalEntry.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  check(key: string, now = Date.now()): { allowed: boolean; retryAfterSeconds: number } {
    const globalCheck = this.checkGlobal(now);
    if (!globalCheck.allowed) {
      return globalCheck;
    }

    const entry = this.attempts.get(key);
    if (!entry || now >= entry.resetAt) {
      if (entry) this.attempts.delete(key);
      return { allowed: true, retryAfterSeconds: 0 };
    }
    if (entry.count >= RATE_LIMIT_MAX_ATTEMPTS) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - now) / 1000)),
      };
    }
    return { allowed: true, retryAfterSeconds: 0 };
  }

  recordFailure(key: string, now = Date.now()): void {
    if (!this.globalEntry || now >= this.globalEntry.resetAt) {
      this.globalEntry = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    } else {
      this.globalEntry.count += 1;
    }

    if (!this.attempts.has(key) && this.attempts.size >= LoginRateLimiter.MAX_ENTRIES) {
      this.prune(now);
      while (this.attempts.size >= LoginRateLimiter.MAX_ENTRIES) {
        const oldestKey = this.attempts.keys().next().value;
        if (oldestKey === undefined) break;
        this.attempts.delete(oldestKey);
      }
    }

    const entry = this.attempts.get(key);
    if (!entry || now >= entry.resetAt) {
      this.attempts.set(key, { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS });
      return;
    }
    entry.count += 1;
  }

  reset(key: string): void {
    this.attempts.delete(key);
  }
}

export function getSessionSecret(): string {
  const configured = process.env.SESSION_SECRET?.trim() ?? "";
  if (process.env.NODE_ENV === "production") {
    if (!configured || KNOWN_PLACEHOLDER_SECRETS.has(configured) || configured.length < 32) {
      throw new Error(
        "SESSION_SECRET wajib diset minimal 32 karakter non-default saat NODE_ENV=production.",
      );
    }
    return configured;
  }
  return configured || DEV_FALLBACK_SECRET;
}

export function signSessionToken(
  secret: string,
  sessionVersion = 1,
  nowSeconds = Math.floor(Date.now() / 1000),
): string {
  const exp = nowSeconds + SESSION_TTL_SECONDS;
  const payload = `owner.v${sessionVersion}.${exp}`;
  const sig = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifySessionToken(
  token: string | undefined,
  secret: string,
  expectedSessionVersion = 1,
  nowSeconds = Math.floor(Date.now() / 1000),
): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 4) return false;
  const [role, versionText, expText, sig] = parts;
  if (role !== "owner" || versionText !== `v${expectedSessionVersion}` || !expText || !sig) {
    return false;
  }
  const exp = Number(expText);
  if (!Number.isFinite(exp) || exp < nowSeconds) return false;

  const expectedSig = createHmac("sha256", secret)
    .update(`${role}.${versionText}.${expText}`)
    .digest("base64url");
  const sigBuf = Buffer.from(sig);
  const expectedBuf = Buffer.from(expectedSig);
  if (sigBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(sigBuf, expectedBuf);
}

export async function hashPin(pin: string): Promise<string> {
  return Bun.password.hash(pin, { algorithm: "bcrypt", cost: 10 });
}

export async function verifyPin(pin: string, hash: string): Promise<boolean> {
  return Bun.password.verify(pin, hash);
}

function isHttpsRequest(c: Context): boolean {
  if (process.env.TRUST_PROXY === "true") {
    const proto = c.req.header("x-forwarded-proto");
    if (proto) return proto.split(",")[0]?.trim() === "https";
  }
  return c.req.url.startsWith("https://");
}

export function issueSessionCookie(
  c: Context,
  secret = getSessionSecret(),
  sessionVersion = 1,
): void {
  const token = signSessionToken(secret, sessionVersion);
  setCookie(c, SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "Lax",
    secure: isHttpsRequest(c),
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE_NAME, { path: "/" });
}

interface AuthSettingsCache {
  pinHash: string | null;
  sessionVersion: number;
  cachedAt: number;
}

let authCache = new WeakMap<object, AuthSettingsCache>();
const AUTH_CACHE_TTL_MS = 60_000;

export function invalidateAuthCache(db?: AppDb): void {
  if (db) {
    authCache.delete(db as object);
  } else {
    authCache = new WeakMap();
  }
}

export function setCachedAuthSettings(
  db: AppDb,
  pinHash: string | null,
  sessionVersion: number,
): void {
  authCache.set(db as object, {
    pinHash,
    sessionVersion,
    cachedAt: Date.now(),
  });
}

export async function getAuthSettings(
  db: AppDb,
): Promise<{ pinHash: string | null; sessionVersion: number }> {
  const now = Date.now();
  const cached = authCache.get(db as object);
  if (cached && now - cached.cachedAt < AUTH_CACHE_TTL_MS) {
    return {
      pinHash: cached.pinHash,
      sessionVersion: cached.sessionVersion,
    };
  }

  const row = await db
    .select({
      pinHash: appSettings.pinHash,
      sessionVersion: appSettings.sessionVersion,
    })
    .from(appSettings)
    .where(eq(appSettings.id, 1))
    .limit(1);

  const pinHash = row[0]?.pinHash ?? null;
  const sessionVersion = row[0]?.sessionVersion ?? 1;

  authCache.set(db as object, {
    pinHash,
    sessionVersion,
    cachedAt: now,
  });

  return { pinHash, sessionVersion };
}

export async function isRequestAuthenticated(
  c: Context,
  db: AppDb,
  secret = getSessionSecret(),
): Promise<{ pinConfigured: boolean; authenticated: boolean }> {
  const { pinHash, sessionVersion } = await getAuthSettings(db);
  if (!pinHash) {
    return { pinConfigured: false, authenticated: true };
  }
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  return {
    pinConfigured: true,
    authenticated: verifySessionToken(cookie, secret, sessionVersion),
  };
}

export function createAuthMiddleware(db: AppDb, secret = getSessionSecret()): MiddlewareHandler {
  return async (c, next) => {
    const path = c.req.path;
    if (
      path === "/api/health" ||
      path === "/api/auth/status" ||
      path === "/api/auth/setup" ||
      path === "/api/auth/login"
    ) {
      return next();
    }
    const status = await isRequestAuthenticated(c, db, secret);
    if (!status.authenticated) {
      return c.json({ error: "Sesi terkunci. Masukkan PIN untuk melanjutkan." }, 401);
    }
    return next();
  };
}

export function clientRateKey(c: Context): string {
  // Trust forwarding headers only behind an explicitly configured reverse proxy; prefer proxy-set IP over spoofable leftmost hops.
  if (process.env.TRUST_PROXY === "true") {
    const realIp = c.req.header("x-real-ip")?.trim();
    if (realIp) return realIp;
    const xff = c.req.header("x-forwarded-for");
    if (xff) {
      const hops = xff
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
      const rightmost = hops[hops.length - 1];
      if (rightmost) return rightmost;
    }
  }
  return "local";
}
