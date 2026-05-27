-- Split-sale weight tracking
-- Allows fractional policy counts (0.5 each for a 50/50 split)
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS sale_weight numeric NOT NULL DEFAULT 1;

-- Back-fill existing split_sale rows so they count as 0.5 each
-- (Only needed if you already have split sales in the system — safe to run either way)
UPDATE sales_log SET sale_weight = 0.5 WHERE split_sale = true AND sale_weight = 1;
