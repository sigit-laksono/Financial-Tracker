import { and, asc, eq, inArray, or, sql } from "drizzle-orm";
import { Hono } from "hono";
import { createCategorySchema, updateCategorySchema } from "../../../shared/src/schemas";
import type { AppDb } from "../db";
import { budgets, categories, recurringRules, transactions, transactionSplits } from "../db/schema";

export function createCategoryRoutes(db: AppDb) {
  const router = new Hono();

  router.get("/", async (c) => {
    const rows = await db
      .select()
      .from(categories)
      .orderBy(asc(categories.sortOrder), asc(categories.id));
    return c.json({ categories: rows });
  });

  router.post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const parsed = createCategorySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data kategori tidak valid." },
        400,
      );
    }

    const existing = await db.select().from(categories);
    const dup = existing.find(
      (cat) =>
        cat.type === parsed.data.type &&
        cat.name.trim().toLowerCase() === parsed.data.name.toLowerCase(),
    );
    if (dup) {
      return c.json({ error: "Kategori dengan nama dan tipe tersebut sudah ada." }, 409);
    }

    const [created] = await db
      .insert(categories)
      .values({
        name: parsed.data.name,
        type: parsed.data.type,
        bucket: parsed.data.bucket ?? "needs",
        isMandatory: parsed.data.isMandatory,
        color: parsed.data.color,
        sortOrder: existing.length + 1,
      })
      .returning();

    if (!created) {
      return c.json({ error: "Gagal membuat kategori baru." }, 500);
    }

    if (parsed.data.budgetLimit && parsed.data.budgetLimit > 0) {
      await db
        .insert(budgets)
        .values({
          category: created.name,
          categoryId: created.id,
          period: "default",
          limitAmount: parsed.data.budgetLimit,
        })
        .onConflictDoUpdate({
          target: [budgets.category, budgets.period],
          set: {
            limitAmount: parsed.data.budgetLimit,
            categoryId: created.id,
            updatedAt: new Date(),
          },
        });
    }

    return c.json({ category: created }, 201);
  });

  router.patch("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID kategori tidak valid." }, 400);

    const body = await c.req.json().catch(() => null);
    const parsed = updateCategorySchema.safeParse(body);
    if (!parsed.success) {
      return c.json(
        { error: parsed.error.issues[0]?.message ?? "Data kategori tidak valid." },
        400,
      );
    }

    const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!existing) return c.json({ error: "Kategori tidak ditemukan." }, 404);

    if (parsed.data.name !== undefined) {
      const allCats = await db.select().from(categories);
      const dup = allCats.find(
        (cat) =>
          cat.id !== id &&
          cat.type === existing.type &&
          cat.name.trim().toLowerCase() === parsed.data.name!.trim().toLowerCase(),
      );
      if (dup) {
        return c.json({ error: "Kategori dengan nama dan tipe tersebut sudah ada." }, 409);
      }
    }

    const { budgetLimit, ...categoryUpdates } = parsed.data;

    const updated = await db.transaction(async (tx) => {
      const [row] = await tx
        .update(categories)
        .set(categoryUpdates)
        .where(eq(categories.id, id))
        .returning();

      const effectiveName = parsed.data.name ?? existing.name;

      if (parsed.data.name !== undefined && parsed.data.name !== existing.name) {
        const nextName = parsed.data.name;
        const txTypeScope =
          existing.type === "income"
            ? eq(transactions.type, "income")
            : inArray(transactions.type, ["expense", "settlement"]);

        await tx
          .update(transactions)
          .set({ category: nextName, categoryId: id, updatedAt: new Date() })
          .where(
            or(
              eq(transactions.categoryId, id),
              and(
                txTypeScope,
                sql`LOWER(TRIM(${transactions.category})) = LOWER(TRIM(${existing.name}))`,
              ),
            ),
          );

        if (existing.type === "expense") {
          await tx
            .update(budgets)
            .set({ category: nextName, categoryId: id, updatedAt: new Date() })
            .where(
              or(
                eq(budgets.categoryId, id),
                sql`LOWER(TRIM(${budgets.category})) = LOWER(TRIM(${existing.name}))`,
              ),
            );
        }
      }

      if (budgetLimit !== undefined) {
        if (budgetLimit > 0) {
          await tx
            .insert(budgets)
            .values({
              category: effectiveName,
              categoryId: id,
              period: "default",
              limitAmount: budgetLimit,
            })
            .onConflictDoUpdate({
              target: [budgets.category, budgets.period],
              set: {
                limitAmount: budgetLimit,
                categoryId: id,
                updatedAt: new Date(),
              },
            });
        } else {
          await tx
            .delete(budgets)
            .where(and(eq(budgets.categoryId, id), eq(budgets.period, "default")));
        }
      }

      return row;
    });

    return c.json({ category: updated });
  });

  router.delete("/:id", async (c) => {
    const id = Number(c.req.param("id"));
    if (!Number.isInteger(id) || id <= 0) return c.json({ error: "ID kategori tidak valid." }, 400);

    const [existing] = await db.select().from(categories).where(eq(categories.id, id)).limit(1);
    if (!existing) return c.json({ error: "Kategori tidak ditemukan." }, 404);

    // Check if category has transactions
    const [txCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactions)
      .where(
        or(
          eq(transactions.categoryId, id),
          sql`LOWER(TRIM(${transactions.category})) = LOWER(TRIM(${existing.name}))`,
        ),
      );

    const count = Number(txCount?.count ?? 0);
    if (count > 0) {
      return c.json(
        {
          error: `Kategori "${existing.name}" tidak dapat dihapus karena digunakan oleh ${count} transaksi. Ubah transaksi terlebih dahulu.`,
        },
        400,
      );
    }

    // Check if category has transaction splits
    const [splitCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(transactionSplits)
      .where(
        or(
          eq(transactionSplits.categoryId, id),
          sql`LOWER(TRIM(${transactionSplits.category})) = LOWER(TRIM(${existing.name}))`,
        ),
      );

    const sCount = Number(splitCount?.count ?? 0);
    if (sCount > 0) {
      return c.json(
        {
          error: `Kategori "${existing.name}" tidak dapat dihapus karena digunakan oleh ${sCount} rincian split transaksi. Ubah transaksi terlebih dahulu.`,
        },
        400,
      );
    }

    // Check if category is used by recurring rules
    const [recurringCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(recurringRules)
      .where(
        or(
          eq(recurringRules.categoryId, id),
          sql`LOWER(TRIM(${recurringRules.category})) = LOWER(TRIM(${existing.name}))`,
        ),
      );

    const rCount = Number(recurringCount?.count ?? 0);
    if (rCount > 0) {
      return c.json(
        {
          error: `Kategori "${existing.name}" tidak dapat dihapus karena digunakan oleh ${rCount} aturan tagihan rutin. Ubah aturan terlebih dahulu.`,
        },
        400,
      );
    }

    await db.transaction(async (tx) => {
      await tx
        .delete(budgets)
        .where(
          or(
            eq(budgets.categoryId, id),
            sql`LOWER(TRIM(${budgets.category})) = LOWER(TRIM(${existing.name}))`,
          ),
        );
      await tx.delete(categories).where(eq(categories.id, id));
    });

    return c.json({ ok: true, message: `Kategori "${existing.name}" berhasil dihapus.` });
  });

  return router;
}
