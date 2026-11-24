import { and, desc, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDb } from "../db";
import { transactions } from "../db/schema";
import { isValidYearMonth, periodBounds } from "../lib/dates";
import { computeLedgerSnapshot } from "../lib/ledger";

function escapeCsvCell(value: unknown): string {
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  let str = String(value ?? "");
  // Neutralize spreadsheet formula injection payloads on text cells.
  if (/^[=+\-@\t\r]/.test(str)) {
    str = `'${str}`;
  }
  if (str.includes(",") || str.includes('"') || str.includes("\n") || str.includes("\r")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function createExportRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const format = c.req.query("format") === "csv" ? "csv" : "json";
    const period = c.req.query("period") ?? "all";
    const cycle = c.req.query("cycle") === "cc" ? "cc" : "gajian";

    if (period !== "all" && !isValidYearMonth(period)) {
      return c.json({ error: "Parameter period harus 'all' atau YYYY-MM yang valid." }, 400);
    }

    const snap = await computeLedgerSnapshot(db);
    const walletById = new Map(snap.wallets.map((w) => [w.id, w.name]));

    const bounds =
      period !== "all"
        ? periodBounds(period, cycle, snap.settings.gajianStartDay, snap.settings.cardCutoffDay)
        : null;

    const txRows = await db
      .select()
      .from(transactions)
      .where(
        bounds
          ? and(
              gte(transactions.transactionDate, bounds.start),
              lte(transactions.transactionDate, bounds.end),
            )
          : undefined,
      )
      .orderBy(desc(transactions.transactionDate), desc(transactions.id));

    if (format === "csv") {
      const headers = [
        "id",
        "transactionDate",
        "type",
        "merchant",
        "amount",
        "category",
        "wallet",
        "toWallet",
        "ccCycleKey",
        "isConvertedToInstallment",
        "source",
        "sourceRef",
        "note",
      ];
      const lines = [
        headers.join(","),
        ...txRows.map((t) =>
          [
            t.id,
            t.transactionDate,
            t.type,
            t.merchant,
            t.amount,
            t.category,
            walletById.get(t.walletId) ?? t.walletId,
            t.toWalletId ? (walletById.get(t.toWalletId) ?? t.toWalletId) : "",
            t.ccCycleKey ?? "",
            t.isConvertedToInstallment,
            t.source,
            t.sourceRef ?? "",
            t.note ?? "",
          ]
            .map(escapeCsvCell)
            .join(","),
        ),
      ];
      const filename = `financial-tracker-${period}.csv`;
      return new Response(lines.join("\n"), {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="${filename}"`,
        },
      });
    }

    const payload = {
      exportedAt: new Date().toISOString(),
      period,
      wallets: snap.wallets,
      accounts: snap.accounts,
      installments: snap.activeInstallments,
      budgets: snap.budgets,
      transactions: txRows.map((t) => ({
        ...t,
        walletName: walletById.get(t.walletId) ?? null,
        toWalletName: t.toWalletId ? (walletById.get(t.toWalletId) ?? null) : null,
      })),
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="financial-tracker-${period}.json"`,
      },
    });
  });

  return router;
}
