## Project Domain Rules

- **Custom 100% Per-Cycle Budgeting (Not 50/30/20)**:
  - Each cycle (`YYYY-MM`) has independent allocations; never enforce or display fixed 50/30/20 targets.
  - Bucket budgets (`bucket:needs`, `bucket:wants`, `bucket:savings`) support bottom-up summation from active expense categories in that bucket.
  - When a manual `bucket:*` limit is configured (`> 0`), the effective bucket allocation is `Math.max(manualBucketLimit, categoryAllocatedTotal)` with `allocationSource = "manual"`; otherwise it falls back to `categoryAllocatedTotal` (`"categories"`) or `0` (`"none"`).
  - Clearing a category budget (`budgetLimit <= 0`) deletes both the target period row and any `"default"` fallback row so old limits never silently resurface.

- **Debt Accounts Lifecycle & Ledger-First Integrity**:
  - **Auto-Close on Full Payment**: When installments are settled (manual settlement or payroll auto-pay) and `paidAmount >= initialBalance`, `debt_accounts.closedAt` is set automatically.
  - **Auto-Reopen on Unsettle / Delete Settlement**: Reverting an installment (`unsettle`) or deleting a `settlement` / `debt_collection` transaction clears `closedAt` if `remainingBalance > 0`.
  - **Ledger-First Deletion (`DELETE /api/debts/:id`)**: Deleting a debt account removes only the debt account card and its installment schedule; historical `transactions` and `settlement_allocations` are preserved with `debtAccountId` / `installmentId` unlinked (`null`), keeping wallet balances untouched.
