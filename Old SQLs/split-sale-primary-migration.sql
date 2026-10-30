-- Adds the "primary for count" designation on a split sale, used only by the My
-- Production report (Perf tab) — every other count in the app (Race tab, Goals,
-- Commissions thresholds) keeps the existing sale_weight 0.5/0.5 convention unchanged.
-- NULL means "not yet designated" — the report falls back to treating the original
-- submitting agent (not the teammate) as primary until this is explicitly set.
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS is_primary boolean;
