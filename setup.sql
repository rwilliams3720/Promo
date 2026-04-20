-- ═══════════════════════════════════════════════════════════════
-- BOAT RACE — Multi-tenant migration
-- Run in Supabase SQL Editor (safe to re-run — uses IF NOT EXISTS)
-- ═══════════════════════════════════════════════════════════════


-- ─── 1. ACCOUNTS TABLE ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS accounts (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email             text NOT NULL,
  company_name      text NOT NULL DEFAULT '',
  contact_name      text NOT NULL DEFAULT '',
  phone             text NOT NULL DEFAULT '',
  plan              text NOT NULL DEFAULT 'basic',
  agent_count       int  NOT NULL DEFAULT 1,
  referral_source   text NOT NULL DEFAULT '',
  status            text NOT NULL DEFAULT 'trial'
                    CHECK (status IN ('trial','paid','deferred','past_due','cancelled')),
  is_admin          boolean NOT NULL DEFAULT false,
  notes             text NOT NULL DEFAULT '',
  trial_ends_at     timestamptz,
  paid_through      timestamptz,
  stripe_customer_id text,
  sales_column_map  jsonb,
  created_at        timestamptz NOT NULL DEFAULT now(),
  last_login        timestamptz
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

-- ─── 2. HELPER FUNCTION (avoids RLS recursion) ──────────────────
-- Must come AFTER accounts table exists
CREATE OR REPLACE FUNCTION is_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT COALESCE((SELECT is_admin FROM accounts WHERE user_id = auth.uid()), false);
$$;

DROP POLICY IF EXISTS "accounts_own"  ON accounts;
DROP POLICY IF EXISTS "accounts_admin" ON accounts;
CREATE POLICY "accounts_own"   ON accounts FOR ALL USING (user_id = auth.uid());
CREATE POLICY "accounts_admin" ON accounts FOR ALL USING (is_admin());


-- ─── 3. CLEAR ORPHANED SINGLE-TENANT DATA ───────────────────────
-- Existing rows have no user_id — safe to remove before schema change.
-- Race data will be re-seeded on first upload; scoring defaults are hardcoded.
DELETE FROM scoring_config;
DELETE FROM race_config;
DELETE FROM race_data;
DELETE FROM call_log;
DELETE FROM sales_log;
DELETE FROM historical_wins;
DELETE FROM vm_slot_log         WHERE TRUE;
DELETE FROM call_performance_log WHERE TRUE;


-- ─── 4. ADD user_id TO DATA TABLES ──────────────────────────────

-- call_log  (hash was PK → composite PK with user_id)
ALTER TABLE call_log ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='call_log' AND constraint_name='call_log_pkey'
      AND constraint_type='PRIMARY KEY'
  ) THEN
    ALTER TABLE call_log DROP CONSTRAINT call_log_pkey;
  END IF;
END $$;
ALTER TABLE call_log ADD CONSTRAINT call_log_pkey PRIMARY KEY (user_id, hash)
  DEFERRABLE INITIALLY DEFERRED;

-- sales_log (hash was PK → composite PK with user_id)
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='sales_log' AND constraint_name='sales_log_pkey'
      AND constraint_type='PRIMARY KEY'
  ) THEN
    ALTER TABLE sales_log DROP CONSTRAINT sales_log_pkey;
  END IF;
END $$;
ALTER TABLE sales_log ADD CONSTRAINT sales_log_pkey PRIMARY KEY (user_id, hash)
  DEFERRABLE INITIALLY DEFERRED;

-- race_data (agent_id was PK → composite PK)
ALTER TABLE race_data ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='race_data' AND constraint_name='race_data_pkey'
      AND constraint_type='PRIMARY KEY'
  ) THEN
    ALTER TABLE race_data DROP CONSTRAINT race_data_pkey;
  END IF;
END $$;
ALTER TABLE race_data ADD CONSTRAINT race_data_pkey PRIMARY KEY (user_id, agent_id)
  DEFERRABLE INITIALLY DEFERRED;

-- scoring_config (config_key was PK → composite PK)
ALTER TABLE scoring_config ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='scoring_config' AND constraint_name='scoring_config_pkey'
      AND constraint_type='PRIMARY KEY'
  ) THEN
    ALTER TABLE scoring_config DROP CONSTRAINT scoring_config_pkey;
  END IF;
END $$;
ALTER TABLE scoring_config ADD CONSTRAINT scoring_config_pkey PRIMARY KEY (user_id, config_key)
  DEFERRABLE INITIALLY DEFERRED;

-- race_config (key was PK → composite PK)
ALTER TABLE race_config ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name='race_config' AND constraint_name='race_config_pkey'
      AND constraint_type='PRIMARY KEY'
  ) THEN
    ALTER TABLE race_config DROP CONSTRAINT race_config_pkey;
  END IF;
END $$;
ALTER TABLE race_config ADD CONSTRAINT race_config_pkey PRIMARY KEY (user_id, key)
  DEFERRABLE INITIALLY DEFERRED;

-- historical_wins (no PK change, just add user_id + index)
ALTER TABLE historical_wins ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS historical_wins_user_month ON historical_wins (user_id, month);

-- vm_slot_log + call_performance_log
ALTER TABLE vm_slot_log           ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE call_performance_log  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;


-- ─── 4. RLS ON DATA TABLES ──────────────────────────────────────
-- (already enabled per your confirmation; dropping + recreating policies)

DROP POLICY IF EXISTS "user_isolation" ON race_data;
DROP POLICY IF EXISTS "user_isolation" ON scoring_config;
DROP POLICY IF EXISTS "user_isolation" ON race_config;
DROP POLICY IF EXISTS "user_isolation" ON historical_wins;
DROP POLICY IF EXISTS "user_isolation" ON call_log;
DROP POLICY IF EXISTS "user_isolation" ON sales_log;
DROP POLICY IF EXISTS "user_isolation" ON vm_slot_log;
DROP POLICY IF EXISTS "user_isolation" ON call_performance_log;

CREATE POLICY "user_isolation" ON race_data          FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON scoring_config     FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON race_config        FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON historical_wins    FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON call_log           FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON sales_log          FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON vm_slot_log        FOR ALL USING (user_id = auth.uid());
CREATE POLICY "user_isolation" ON call_performance_log FOR ALL USING (user_id = auth.uid());


-- ─── 5. SEED ADMIN ACCOUNT ──────────────────────────────────────
-- Inserts/updates the admin row for russelsaiassistant@gmail.com
-- The user must already exist in Supabase Auth before running this.

INSERT INTO accounts (user_id, email, company_name, contact_name, status, is_admin, trial_ends_at)
SELECT
  id,
  email,
  'Boat Race Admin',
  'Russel Williams',
  'paid',
  true,
  NULL
FROM auth.users
WHERE email = 'russelsaiassistant@gmail.com'
ON CONFLICT (user_id) DO UPDATE
  SET is_admin = true,
      status   = 'paid',
      trial_ends_at = NULL;


-- ─── 6. TRIGGER: auto-create account row on signup ──────────────
CREATE OR REPLACE FUNCTION handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  INSERT INTO accounts (
    user_id, email, company_name, contact_name, phone,
    plan, agent_count, referral_source,
    status, trial_ends_at
  ) VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'company_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'contact_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'phone', ''),
    COALESCE(NEW.raw_user_meta_data->>'plan', 'basic'),
    COALESCE((NEW.raw_user_meta_data->>'agent_count')::int, 1),
    COALESCE(NEW.raw_user_meta_data->>'referral_source', ''),
    'trial',
    now() + interval '21 days'
  )
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION handle_new_user();
