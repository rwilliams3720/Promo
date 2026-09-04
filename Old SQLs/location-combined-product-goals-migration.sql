-- Adds combined product goal groups to sales_locations, mirroring the
-- combined_groups feature already available on individual/team/agency goals
-- (e.g. "Auto + Fire: 12"). Two separate columns since monthly and annual
-- product goals are already two independent maps on this same row.
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS combined_product_goals_monthly jsonb NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS combined_product_goals_annual  jsonb NOT NULL DEFAULT '[]'::jsonb;
