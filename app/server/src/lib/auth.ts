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
const RATE_LIMIT_MAX_LOCKOUT_MS = 60 * 60_000;
const RATE_LIMIT_FORGET_MS = 24 * 60 * 60_000;
const DEV_FALLBACK_SECRET = "dev-local-financial-tracker-secret-key";
const KNOWN_PLACEHOLDER_SECRETS = new Set([
  DEV_FALLBACK_SECRET,
  "financial-tracker-production-secret-min-32-chars-long",
  "change-this-to-a-long-random-secret-before-vps-deploy",
  "replace-with-at-least-32-random-characters",
]);

interface RateLimitEntry {
  /** Failures recorded in the current window. */
  count: number;
  /** Attempts that passed the check and are still being verified (bcrypt is async). */
  inFlight: number;
  windowEndsAt: number;
  blockedUntil: number;
  /** Consecutive lockouts; each one doubles the next lockout duration. */
  lockouts: number;
  forgetAt: number;
}

type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };

function newRateLimitEntry(now: number): RateLimitEntry {
  return {
    count: 0,
    inFlight: 0,
    windowEndsAt: now + RATE_LIMIT_WINDOW_MS,
    blockedUntil: 0,
    lockouts: 0,
    forgetAt: now + RATE_LIMIT_FORGET_MS,
  };
}

function evaluateEntry(entry: RateLimitEntry | null, max: number, now: number): RateLimitResult {
  if (!entry) return { allowed: true, retryAfterSeconds: 0 };
  if (now < entry.blockedUntil) {
    return {
      allowed: false,
      retryAfterSeconds: Math.max(1, Math.ceil((entry.blockedUntil - now) / 1000)),
    };
  }
  const failures = now >= entry.windowEndsAt ? 0 : entry.count;
  if (failures + entry.inFlight >= max) {
    // Too many attempts are already being verified concurrently; ask the client to retry.
    return { allowed: false, retryAfterSeconds: 1 };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

function bumpFailure(entry: RateLimitEntry, max: number, now: number): void {
  // Already locked out: late failures from in-flight attempts must not stack extra lockouts.
  if (now < entry.blockedUntil) return;
  if (now >= entry.forgetAt) entry.lockouts = 0;
  if (now >= entry.windowEndsAt) {
    entry.count = 0;
    entry.windowEndsAt = now + RATE_LIMIT_WINDOW_MS;
  }
  entry.count += 1;
  entry.forgetAt = now + RATE_LIMIT_FORGET_MS;
  if (entry.count >= max) {
    entry.lockouts += 1;
    const lockMs = Math.min(
      RATE_LIMIT_WINDOW_MS * 2 ** (entry.lockouts - 1),
      RATE_LIMIT_MAX_LOCKOUT_MS,
    );
    entry.blockedUntil = now + lockMs;
    entry.count = 0;
    entry.windowEndsAt = entry.blockedUntil;
  }
}

/**
 * Brute-force guard for PIN checks. Use `tryAcquire` before verifying a PIN and `release`
 * afterwards: attempts still in flight count against the limit, so parallel requests cannot
 * all slip past the check while bcrypt runs. Repeated lockouts double in length (capped).
 */
export class LoginRateLimiter {
  static readonly MAX_ENTRIES = 1000;
  private attempts = new Map<string, RateLimitEntry>();
  private globalEntry: RateLimitEntry | null = null;

  private prune(now: number): void {
    for (const [key, entry] of this.attempts.entries()) {
      if (entry.inFlight === 0 && now >= entry.forgetAt && now >= entry.blockedUntil) {
        this.attempts.delete(key);
      }
    }
  }

  private entryFor(key: string, now: number): RateLimitEntry {
    let entry = this.attempts.get(key);
    if (entry) return entry;
    if (this.attempts.size >= LoginRateLimiter.MAX_ENTRIES) {
      this.prune(now);
      while (this.attempts.size >= LoginRateLimiter.MAX_ENTRIES) {
        const oldestKey = this.attempts.keys().next().value;
        if (oldestKey === undefined) break;
        this.attempts.delete(oldestKey);
      }
    }
    entry = newRateLimitEntry(now);
    this.attempts.set(key, entry);
    return entry;
  }

  private globalFor(now: number): RateLimitEntry {
    if (!this.globalEntry) this.globalEntry = newRateLimitEntry(now);
    return this.globalEntry;
  }

  checkGlobal(now = Date.now()): RateLimitResult {
    return evaluateEntry(this.globalEntry, RATE_LIMIT_GLOBAL_MAX_ATTEMPTS, now);
  }

  check(key: string, now = Date.now()): RateLimitResult {
    const globalCheck = this.checkGlobal(now);
    if (!globalCheck.allowed) return globalCheck;
    return evaluateEntry(this.attempts.get(key) ?? null, RATE_LIMIT_MAX_ATTEMPTS, now);
  }

  /** Checks the limit and, if allowed, reserves an in-flight attempt. Synchronous on purpose. */
  tryAcquire(key: string, now = Date.now()): RateLimitResult {
    const result = this.check(key, now);
    if (!result.allowed) return result;
    this.entryFor(key, now).inFlight += 1;
    this.globalFor(now).inFlight += 1;
    return result;
  }

  /**
   * Ends a reservation from `tryAcquire`. "failure" records a wrong PIN, "success" clears the
   * key's history, "neutral" (e.g. malformed input) only frees the reservation.
   */
  release(key: string, outcome: "success" | "failure" | "neutral", now = Date.now()): void {
    const entry = this.attempts.get(key);
    if (entry && entry.inFlight > 0) entry.inFlight -= 1;
    if (this.globalEntry && this.globalEntry.inFlight > 0) this.globalEntry.inFlight -= 1;
    if (outcome === "failure") {
      this.recordFailure(key, now);
    } else if (outcome === "success" && entry && entry.inFlight === 0) {
      this.attempts.delete(key);
    }
  }

  recordFailure(key: string, now = Date.now()): void {
    bumpFailure(this.globalFor(now), RATE_LIMIT_GLOBAL_MAX_ATTEMPTS, now);
    bumpFailure(this.entryFor(key, now), RATE_LIMIT_MAX_ATTEMPTS, now);
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

/**
 * In production a PIN is mandatory: until one is set, the data API stays locked and only the
 * PIN setup endpoint is reachable. Set ALLOW_NO_PIN=true to restore the optional-PIN mode
 * (only safe when the app is not reachable from the internet).
 */
export function isPinRequired(): boolean {
  return process.env.NODE_ENV === "production" && process.env.ALLOW_NO_PIN !== "true";
}

export async function isRequestAuthenticated(
  c: Context,
  db: AppDb,
  secret = getSessionSecret(),
): Promise<{ pinConfigured: boolean; authenticated: boolean; pinRequired: boolean }> {
  const { pinHash, sessionVersion } = await getAuthSettings(db);
  const pinRequired = isPinRequired();
  if (!pinHash) {
    return { pinConfigured: false, authenticated: !pinRequired, pinRequired };
  }
  const cookie = getCookie(c, SESSION_COOKIE_NAME);
  return {
    pinConfigured: true,
    authenticated: verifySessionToken(cookie, secret, sessionVersion),
    pinRequired,
  };
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const FORM_CONTENT_TYPES = ["application/x-www-form-urlencoded", "multipart/form-data", "text/plain"];

/**
 * Blocks cross-site state-changing requests. The API only accepts JSON from its own pages, so
 * a request flagged cross-site by the browser, or one using a content type an HTML form can
 * send without a CORS preflight, is rejected before it reaches any route.
 */
export function createCsrfGuard(): MiddlewareHandler {
  return async (c, next) => {
    if (SAFE_METHODS.has(c.req.method)) return next();

    const fetchSite = c.req.header("sec-fetch-site");
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      return c.json({ error: "Permintaan lintas situs ditolak.", code: "CSRF_REJECTED" }, 403);
    }

    const contentType = (c.req.header("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
    if (FORM_CONTENT_TYPES.includes(contentType)) {
      return c.json(
        { error: "Content-Type harus application/json.", code: "UNSUPPORTED_MEDIA_TYPE" },
        415,
      );
    }
    return next();
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
      if (!status.pinConfigured) {
        return c.json(
          { error: "Buat PIN terlebih dahulu untuk membuka aplikasi.", code: "PIN_SETUP_REQUIRED" },
          401,
        );
      }
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
