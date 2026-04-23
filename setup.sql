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


-- ─── 3. CREATE DATA TABLES (safe to re-run) ────────────────────

CREATE TABLE IF NOT EXISTS race_data (
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id            text NOT NULL,
  name                text NOT NULL DEFAULT '',
  team                text NOT NULL DEFAULT 'sales',
  wl                  int  NOT NULL DEFAULT 0,
  ul                  int  NOT NULL DEFAULT 0,
  term                int  NOT NULL DEFAULT 0,
  health              int  NOT NULL DEFAULT 0,
  auto                int  NOT NULL DEFAULT 0,
  fire                int  NOT NULL DEFAULT 0,
  placed              int  NOT NULL DEFAULT 0,
  answered            int  NOT NULL DEFAULT 0,
  missed              int  NOT NULL DEFAULT 0,
  voicemail           int  NOT NULL DEFAULT 0,
  talk_min            numeric NOT NULL DEFAULT 0,
  avg_min             numeric NOT NULL DEFAULT 0,
  race_wide_missed    int  NOT NULL DEFAULT 0,
  race_wide_voicemail int  NOT NULL DEFAULT 0,
  last_updated        timestamptz,
  PRIMARY KEY (user_id, agent_id)
);

CREATE TABLE IF NOT EXISTS call_log (
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hash        text NOT NULL,
  agent_id    text,
  disposition text,
  talk_secs   int,
  call_dt     date,
  call_slot   smallint,
  PRIMARY KEY (user_id, hash)
);

CREATE TABLE IF NOT EXISTS sales_log (
  user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  hash      text NOT NULL,
  agent_id  text,
  product   text,
  sale_date date,
  PRIMARY KEY (user_id, hash)
);

CREATE TABLE IF NOT EXISTS historical_wins (
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  month               text NOT NULL,
  rank                int,
  agent_id            text,
  name                text,
  team                text,
  total_score         int,
  gross_score         int,
  deductions          int,
  wl                  int NOT NULL DEFAULT 0,
  ul                  int NOT NULL DEFAULT 0,
  term                int NOT NULL DEFAULT 0,
  health              int NOT NULL DEFAULT 0,
  auto                int NOT NULL DEFAULT 0,
  fire                int NOT NULL DEFAULT 0,
  placed              int NOT NULL DEFAULT 0,
  answered            int NOT NULL DEFAULT 0,
  missed              int NOT NULL DEFAULT 0,
  voicemail           int NOT NULL DEFAULT 0,
  talk_min            numeric NOT NULL DEFAULT 0,
  avg_min             numeric NOT NULL DEFAULT 0,
  race_wide_missed    int NOT NULL DEFAULT 0,
  race_wide_voicemail int NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS race_config (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  key     text NOT NULL,
  value   text NOT NULL DEFAULT '',
  PRIMARY KEY (user_id, key)
);

CREATE TABLE IF NOT EXISTS scoring_config (
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  config_key   text NOT NULL,
  config_value text NOT NULL DEFAULT '0',
  PRIMARY KEY (user_id, config_key)
);

CREATE TABLE IF NOT EXISTS vm_slot_log (
  user_id   uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  id        bigserial PRIMARY KEY,
  agent_id  text,
  call_slot smallint,
  call_dt   date
);

CREATE TABLE IF NOT EXISTS call_performance_log (
  user_id    uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  id         bigserial PRIMARY KEY,
  agent_id   text,
  period     text,
  metric     text,
  value      numeric
);

ALTER TABLE race_data           ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_log            ENABLE ROW LEVEL SECURITY;
ALTER TABLE sales_log           ENABLE ROW LEVEL SECURITY;
ALTER TABLE historical_wins     ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_config         ENABLE ROW LEVEL SECURITY;
ALTER TABLE scoring_config      ENABLE ROW LEVEL SECURITY;
ALTER TABLE vm_slot_log         ENABLE ROW LEVEL SECURITY;
ALTER TABLE call_performance_log ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS historical_wins_user_month ON historical_wins (user_id, month);

-- sales_log written premium
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS written_premium numeric;

-- AI analysis columns (added progressively — safe to re-run)
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ai_analysis_cache jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ai_analysis_at    timestamptz;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS ai_history_key    jsonb;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS timezone          text NOT NULL DEFAULT 'America/Los_Angeles';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS report_hour       smallint NOT NULL DEFAULT 7;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS last_report_date  date;


-- ─── 4. ADD user_id TO DATA TABLES (no-op if already created above) ──────────────────────────────

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
;

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
;

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
;

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
;

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
;

-- historical_wins (no PK change, just add user_id)
ALTER TABLE historical_wins ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;

-- vm_slot_log + call_performance_log
ALTER TABLE vm_slot_log           ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;
ALTER TABLE call_performance_log  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE;


-- ─── 5b. RLS POLICIES ON DATA TABLES ───────────────────────────

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
