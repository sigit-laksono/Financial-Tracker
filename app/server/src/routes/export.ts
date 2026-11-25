import { and, desc, gte, lte } from "drizzle-orm";
import { Hono } from "hono";
import type { AppDb } from "../db";
import { transactions } from "../db/schema";
import { buildFullJsonBackupData, importBackupSnapshot } from "../lib/backupService";
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

    const txIdsFilter = period === "all" ? undefined : txRows.map((t) => t.id);
    const fullBackupData = await buildFullJsonBackupData(db, txIdsFilter);

    const payload = {
      version: 2 as const,
      exportedAt: new Date().toISOString(),
      period,
      scope: period === "all" ? ("full" as const) : ("period" as const),
      settings: fullBackupData.settings,
      categories: fullBackupData.categories,
      wallets: snap.wallets,
      walletRecurringFees: fullBackupData.walletRecurringFees,
      accounts: snap.accounts,
      installments:
        period === "all" ? fullBackupData.installments : snap.activeInstallments,
      budgets: snap.budgets,
      transactions: txRows.map((t) => ({
        ...t,
        walletName: walletById.get(t.walletId) ?? null,
        toWalletName: t.toWalletId ? (walletById.get(t.toWalletId) ?? null) : null,
      })),
      transactionSplits: fullBackupData.transactionSplits,
      settlementAllocations: fullBackupData.settlementAllocations,
      goals: fullBackupData.goals,
      assets: fullBackupData.assets,
      recurringRules: fullBackupData.recurringRules,
    };
    return new Response(JSON.stringify(payload, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": `attachment; filename="financial-tracker-${period}.json"`,
      },
    });
  });

  router.post("/import", async (c) => {
    const body = (await c.req.json().catch(() => null)) as {
      confirmation?: unknown;
      snapshot?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return c.json({ error: "Payload impor tidak valid." }, 400);
    }

    if (body.confirmation !== "IMPORT_CONFIRMED") {
      return c.json(
        {
          error: 'Konfirmasi impor tidak valid. Ketik "IMPORT_CONFIRMED" untuk melanjutkan.',
        },
        400,
      );
    }

    const result = await importBackupSnapshot(db, body.snapshot);
    return c.json({
      ok: true,
      message: `Data berhasil dipulihkan (${result.counts.wallets} dompet, ${result.counts.transactions} transaksi).`,
      exportedAt: result.exportedAt,
      counts: result.counts,
    });
  });

  return router;
}
