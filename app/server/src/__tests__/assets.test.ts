import { describe, expect, it } from "bun:test";
import { setupTestContext } from "./testHelper";

describe("Milestone 11: Aset & Net Worth (Kekayaan Bersih)", () => {
  it("creates, updates, and deletes investment and fixed assets with accurate gain/loss", async () => {
    const { app } = await setupTestContext();

    // 1. Initial assets list should be empty
    const resInitial = await app.request("/api/assets");
    expect(resInitial.status).toBe(200);
    const bodyInitial = await resInitial.json();
    expect(bodyInitial.assets).toHaveLength(0);

    // 2. Create an investment asset with capital gain
    const resCreateStock = await app.request("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Saham BBCA (10 Lot)",
        category: "investment",
        type: "stocks",
        valuationAmount: 10_000_000,
        acquisitionCost: 8_000_000,
        notes: "Investasi dividen jangka panjang",
      }),
    });
    expect(resCreateStock.status).toBe(201);
    const { asset: stockAsset } = await resCreateStock.json();
    expect(stockAsset.name).toBe("Saham BBCA (10 Lot)");
    expect(stockAsset.category).toBe("investment");
    expect(stockAsset.valuationAmount).toBe(10_000_000);
    expect(stockAsset.unrealizedGainLoss).toBe(2_000_000);
    expect(stockAsset.unrealizedGainLossPercent).toBe(25);

    // 3. Create a fixed asset with depreciation
    const resCreateGadget = await app.request("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "MacBook Pro M2",
        category: "fixed",
        type: "electronics",
        valuationAmount: 20_000_000,
        acquisitionCost: 25_000_000,
        notes: "Laptop kerja produktif",
      }),
    });
    expect(resCreateGadget.status).toBe(201);
    const { asset: gadgetAsset } = await resCreateGadget.json();
    expect(gadgetAsset.category).toBe("fixed");
    expect(gadgetAsset.unrealizedGainLoss).toBe(-5_000_000);
    expect(gadgetAsset.unrealizedGainLossPercent).toBe(-20);

    // 4. Update valuation (Re-quote)
    const resUpdate = await app.request(`/api/assets/${stockAsset.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        valuationAmount: 12_000_000,
      }),
    });
    expect(resUpdate.status).toBe(200);
    const { asset: updatedStock } = await resUpdate.json();
    expect(updatedStock.valuationAmount).toBe(12_000_000);
    expect(updatedStock.unrealizedGainLoss).toBe(4_000_000);
    expect(updatedStock.unrealizedGainLossPercent).toBe(50);

    // 5. Delete an asset
    const resDelete = await app.request(`/api/assets/${gadgetAsset.id}`, {
      method: "DELETE",
    });
    expect(resDelete.status).toBe(200);

    const resAfterDelete = await app.request("/api/assets");
    const bodyAfterDelete = await resAfterDelete.json();
    expect(bodyAfterDelete.assets).toHaveLength(1);
    expect(bodyAfterDelete.assets[0].name).toBe("Saham BBCA (10 Lot)");
  });

  it("calculates comprehensive Net Worth summary, debt-to-asset ratio, and financial stage", async () => {
    const { app } = await setupTestContext();

    // 1. Check baseline Net Worth
    const resInitial = await app.request("/api/assets/net-worth-summary");
    expect(resInitial.status).toBe(200);
    const initialSummary = await resInitial.json();
    expect(typeof initialSummary.totalNetWorth).toBe("number");
    expect(typeof initialSummary.totalLiquidAssets).toBe("number");
    expect(initialSummary.totalInvestmentAssets).toBe(0);
    expect(initialSummary.totalFixedAssets).toBe(0);
    expect(initialSummary.breakdown.liquidWallets.length).toBeGreaterThan(0);

    // 2. Add an investment asset of 50.000.000 and fixed asset of 150.000.000
    await app.request("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Emas Logam Mulia 50gr",
        category: "investment",
        type: "gold",
        valuationAmount: 50_000_000,
        acquisitionCost: 45_000_000,
      }),
    });

    await app.request("/api/assets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Mobil Honda Brio",
        category: "fixed",
        type: "vehicle",
        valuationAmount: 150_000_000,
        acquisitionCost: 180_000_000,
      }),
    });

    // 3. Verify updated Net Worth calculation
    const resSummary = await app.request("/api/assets/net-worth-summary");
    expect(resSummary.status).toBe(200);
    const summary = await resSummary.json();

    expect(summary.totalInvestmentAssets).toBe(50_000_000);
    expect(summary.totalFixedAssets).toBe(150_000_000);
    expect(summary.totalAssets).toBe(
      summary.totalLiquidAssets + summary.totalInvestmentAssets + summary.totalFixedAssets,
    );
    expect(summary.totalNetWorth).toBe(summary.totalAssets - summary.totalLiabilities);
    expect(summary.debtToAssetRatio).toBeGreaterThanOrEqual(0);
    expect(summary.financialStage).toBeDefined();
    expect(summary.financialStage.title).toBeDefined();
    expect(summary.breakdown.investments).toHaveLength(1);
    expect(summary.breakdown.fixedAssets).toHaveLength(1);
  });
});
