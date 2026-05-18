-- Sales Locations migration
-- Run in Supabase SQL Editor after agent-roster-migration.sql

-- Named locations for manual sales entry and checklist forms
CREATE TABLE IF NOT EXISTS sales_locations (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  sort_order smallint    NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE sales_locations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON sales_locations USING (user_id = auth.uid());
CREATE POLICY "member_read" ON sales_locations FOR SELECT USING (
  user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  )
);

-- Add location column to sales_log
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS location text;

-- Add address, phone, and hours to sales_locations
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS address text;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS phone   text;
ALTER TABLE sales_locations ADD COLUMN IF NOT EXISTS hours   text;
