import { desc, eq } from "drizzle-orm";
import { Hono } from "hono";
import type { AssetDto, NetWorthSummaryDto } from "../../../shared/src/dtos";
import { createAssetSchema, updateAssetSchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { assets } from "../db/schema";
import { computeLedgerSnapshot } from "../lib/ledgerSnapshot";

function mapAssetRow(row: typeof assets.$inferSelect): AssetDto {
  const valuation = row.valuationAmount;
  const cost = row.acquisitionCost ?? null;
  let gainLoss: number | null = null;
  let gainLossPercent: number | null = null;

  if (cost != null && cost > 0) {
    gainLoss = valuation - cost;
    gainLossPercent = Number(((gainLoss / cost) * 100).toFixed(1));
  }

  return {
    id: row.id,
    name: row.name,
    category: row.category,
    type: row.type as AssetDto["type"],
    valuationAmount: valuation,
    acquisitionCost: cost,
    unrealizedGainLoss: gainLoss,
    unrealizedGainLossPercent: gainLossPercent,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

export function createAssetRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const rows = await db
      .select()
      .from(assets)
      .orderBy(desc(assets.valuationAmount), desc(assets.id));

    return c.json({ assets: rows.map(mapAssetRow) });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createAssetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: parsed.error.issues[0]?.message ?? "Data aset tidak valid." }, 400);
    }

    const [created] = await db
      .insert(assets)
      .values({
        name: parsed.data.name,
        category: parsed.data.category,
        type: parsed.data.type,
        valuationAmount: parsed.data.valuationAmount,
        acquisitionCost: parsed.data.acquisitionCost ?? null,
        notes: parsed.data.notes ?? null,
      })
      .returning();

    if (!created) {
      return c.json({ error: "Gagal menyimpan data aset." }, 500);
    }

    return c.json({ ok: true, asset: mapAssetRow(created) }, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "ID aset tidak valid." }, 400);
    }

    const body = await c.req.json().catch(() => null);
    const parsed = updateAssetSchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data edit aset tidak valid." },
        400,
      );
    }

    const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
    if (!existing) {
      return c.json({ error: "Aset tidak ditemukan." }, 404);
    }

    const [updated] = await db
      .update(assets)
      .set({
        ...parsed.data,
        updatedAt: new Date(),
      })
      .where(eq(assets.id, id))
      .returning();

    if (!updated) {
      return c.json({ error: "Gagal memperbarui data aset." }, 500);
    }

    return c.json({ ok: true, asset: mapAssetRow(updated) });
  });

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) {
      return c.json({ error: "ID aset tidak valid." }, 400);
    }

    const [existing] = await db.select().from(assets).where(eq(assets.id, id)).limit(1);
    if (!existing) {
      return c.json({ error: "Aset tidak ditemukan." }, 404);
    }

    await db.delete(assets).where(eq(assets.id, id));

    return c.json({ ok: true, message: `Aset "${existing.name}" berhasil dihapus.` });
  });

  router.get("/net-worth-summary", async (c) => {
    const [snapshot, assetRows] = await Promise.all([
      computeLedgerSnapshot(db),
      db.select().from(assets).orderBy(desc(assets.valuationAmount)),
    ]);

    const mappedAssets = assetRows.map(mapAssetRow);

    // 1. Liquid Assets
    const liquidWallets = snapshot.wallets
      .filter((w) => w.isActive && w.type !== "credit_card")
      .map((w) => ({
        id: w.id,
        name: w.name,
        balance: w.balance,
        provider: w.provider,
        color: w.color,
      }));
    const totalLiquidAssets = snapshot.totalLiquidCash;

    // 2. Investment & Fixed Assets
    const investments = mappedAssets.filter((a) => a.category === "investment");
    const fixedAssets = mappedAssets.filter((a) => a.category === "fixed");

    const totalInvestmentAssets = investments.reduce((sum, a) => sum + a.valuationAmount, 0);
    const totalFixedAssets = fixedAssets.reduce((sum, a) => sum + a.valuationAmount, 0);
    const totalAssets = totalLiquidAssets + totalInvestmentAssets + totalFixedAssets;

    // 3. Liabilities (Debts & Unpaid CC)
    const payableAccounts = snapshot.accounts.filter(
      (a) => a.direction === "payable" && !a.closed && a.remainingBalance > 0,
    );
    const totalDebtPrincipal = payableAccounts.reduce((sum, a) => sum + a.remainingBalance, 0);
    const totalCcLiabilities = snapshot.unpaidCcDailyTotalAllCycles;
    const totalLiabilities = totalDebtPrincipal + totalCcLiabilities;

    const liabilitiesBreakdown = [
      ...payableAccounts.map((a) => ({
        id: a.id,
        name: a.name,
        balance: a.remainingBalance,
        lender: a.lender,
        kind: a.kind,
      })),
      ...(totalCcLiabilities > 0
        ? [
            {
              id: -1,
              name: "Tagihan Kartu Kredit Berjalan",
              balance: totalCcLiabilities,
              lender: "Bank Penerbit CC",
              kind: "card_cycle",
            },
          ]
        : []),
    ];

    // 4. Net Worth & Debt-to-Asset Ratio
    const totalNetWorth = totalAssets - totalLiabilities;
    const debtToAssetRatio =
      totalAssets > 0
        ? Number(((totalLiabilities / totalAssets) * 100).toFixed(1))
        : totalLiabilities > 0
          ? null
          : 0;

    // 5. Monthly Living Expense Baseline for Financial Stage
    const monthlyBurnEstimate =
      snapshot.settings.netSalary > 0 ? snapshot.settings.netSalary * 0.5 : 3_000_000;
    const liquidPlusInvest = totalLiquidAssets + totalInvestmentAssets;

    let financialStage: NetWorthSummaryDto["financialStage"];
    if (totalNetWorth < 0) {
      financialStage = {
        level: "debt_hazard",
        title: "Defisit Bersih / Perlu Restrukturisasi",
        description:
          "Total liabilitas dan utang melebihi akumulasi aset. Prioritaskan pelunasan utang dan stop penambahan liabilitas baru.",
        badgeTone: "danger",
      };
    } else if (liquidPlusInvest < 3 * monthlyBurnEstimate) {
      financialStage = {
        level: "starting",
        title: "Tahap Memulai (Starting Out)",
        description:
          "Kekayaan bersih positif. Fokus berikutnya adalah mengakumulasi dana darurat likuid hingga mencukupi 3-6 bulan kebutuhan.",
        badgeTone: "highlight",
      };
    } else if (liquidPlusInvest < 12 * monthlyBurnEstimate) {
      financialStage = {
        level: "secure",
        title: "Keamanan Finansial (Financial Security)",
        description:
          "Cadangan dana likuid dan portofolio investasi telah mencukupi kebutuhan biaya hidup 6-12 bulan. Fondasi finansial Anda kokoh.",
        badgeTone: "soft",
      };
    } else if (liquidPlusInvest < 60 * monthlyBurnEstimate) {
      financialStage = {
        level: "stable",
        title: "Stabilitas Finansial (Financial Stability)",
        description:
          "Kekayaan bersih dan aset produktif telah mencukupi kebutuhan biaya hidup beberapa tahun ke depan.",
        badgeTone: "primary",
      };
    } else {
      financialStage = {
        level: "independent",
        title: "Kemandirian Finansial (Financial Independence)",
        description:
          "Aset investasi dan kekayaan bersih telah mencapai tingkat kebebasan finansial jangka panjang.",
        badgeTone: "primary",
      };
    }

    const summary: NetWorthSummaryDto = {
      totalNetWorth,
      totalLiquidAssets,
      totalInvestmentAssets,
      totalFixedAssets,
      totalAssets,
      totalLiabilities,
      debtToAssetRatio,
      financialStage,
      breakdown: {
        liquidWallets,
        investments,
        fixedAssets,
        liabilities: liabilitiesBreakdown,
      },
    };

    return c.json(summary);
  });

  return router;
}
