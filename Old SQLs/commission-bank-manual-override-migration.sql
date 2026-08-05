-- Commission Bank manual override lock
-- Lets an admin manually correct a month's stored bank_balance_after (e.g. to account for
-- a pre-migration legacy tracking system whose totals don't derive from sales_log at all)
-- and lock it so the passive per-view auto-save and payment-time reconciliation both leave
-- it alone instead of silently recomputing and overwriting the correction. See CLAUDE.md
-- "commission_bank manual override" (2026-08-05).

ALTER TABLE commission_bank ADD COLUMN IF NOT EXISTS manual_override boolean NOT NULL DEFAULT false;
