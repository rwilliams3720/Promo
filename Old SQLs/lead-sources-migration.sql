-- Lead Sources migration
-- Run in Supabase SQL Editor

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS lead_sources jsonb;
