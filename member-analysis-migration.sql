-- Team Member Analysis add-on columns
-- Run in Supabase SQL Editor after agent-roster-migration.sql

ALTER TABLE accounts ADD COLUMN IF NOT EXISTS has_member_analysis          boolean     DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS member_analysis_count        smallint    DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS member_analysis_stripe_sub_id text;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS member_analysis_agents       jsonb       DEFAULT '[]'::jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS member_analysis_cache        jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS member_analysis_at           timestamptz;
