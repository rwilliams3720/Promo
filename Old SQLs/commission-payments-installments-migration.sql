-- Commission payment installments
-- A month's commission_payments row previously held exactly one payment event
-- (amount_disbursed/paid_date/notes), so recording a second payment that settles the
-- remaining split-payment deficit overwrote the first payment's date instead of adding
-- a new one. installments is an ordered history of every individual disbursement; the
-- existing amount_disbursed/paid_date/notes columns stay in sync (amount_disbursed =
-- sum of installment amounts, paid_date = most recent installment's date) so every
-- existing reconciliation/carry-forward query keeps working unchanged. See CLAUDE.md
-- "Commission payment installments".

ALTER TABLE commission_payments ADD COLUMN IF NOT EXISTS installments jsonb NOT NULL DEFAULT '[]';

-- Backfill: give every existing paid row a single installment reflecting its current
-- amount_disbursed/paid_date/notes, so old and new rows display consistently.
UPDATE commission_payments
SET installments = jsonb_build_array(
  jsonb_build_object(
    'amount', COALESCE(amount_disbursed, amount_paid),
    'date',   paid_date,
    'notes',  notes
  )
)
WHERE amount_paid IS NOT NULL
  AND installments = '[]'::jsonb;
