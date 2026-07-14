-- Team Member Hours migration
-- Run in Supabase SQL Editor

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS member_hours_data jsonb;
