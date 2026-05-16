-- ── DIRECTIVE 2: Manual Sales Entry, Sales Tracking Add-On, Checklist ─────────
-- Run in Supabase SQL Editor (project: boat-race) AFTER members-migration.sql

-- ── 1. accounts additions ────────────────────────────────────────────────────
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS checklist_token        uuid        UNIQUE DEFAULT gen_random_uuid();
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS has_sales_addon        boolean     NOT NULL DEFAULT false;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS sales_entry_mode       text        NOT NULL DEFAULT 'upload';
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS checklist_email_config jsonb;

-- Backfill token for existing rows that got NULL (DEFAULT only applies to new rows)
UPDATE accounts SET checklist_token = gen_random_uuid() WHERE checklist_token IS NULL;

-- ── 2. sales_log extensions ──────────────────────────────────────────────────
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS source          text    NOT NULL DEFAULT 'upload';
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS customer_name   text;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS subcategory     text;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS lead_source     text;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS period          smallint;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS auto_issued     boolean;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS split_sale      boolean;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS teammate        text;
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS checklist_id    uuid;

-- ── 3. checklist_config ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_config (
  user_id    uuid     NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  form_key   text     NOT NULL,
  label      text     NOT NULL,
  active     boolean  NOT NULL DEFAULT true,
  sort_order smallint NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, form_key)
);
ALTER TABLE checklist_config ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON checklist_config USING (user_id = auth.uid());
CREATE POLICY "member_read" ON checklist_config FOR SELECT USING (
  user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  )
);

-- ── 4. checklist_submissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS checklist_submissions (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id          uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  sub_date         date        NOT NULL,
  appt_date        date,
  customer_name    text        NOT NULL,
  salesperson_id   text,
  form_completions jsonb       NOT NULL DEFAULT '{}',
  created_at       timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE checklist_submissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON checklist_submissions USING (user_id = auth.uid());
CREATE POLICY "member_read" ON checklist_submissions FOR SELECT USING (
  user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  )
);

-- ── 5. sales_subcategories ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_subcategories (
  id                   uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id              uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  scoring_category     text        NOT NULL,
  label                text        NOT NULL,
  is_financial_service boolean     NOT NULL DEFAULT false,
  active               boolean     NOT NULL DEFAULT true,
  sort_order           smallint    NOT NULL DEFAULT 0,
  is_default           boolean     NOT NULL DEFAULT false
);
ALTER TABLE sales_subcategories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own"    ON sales_subcategories USING (user_id = auth.uid());
CREATE POLICY "member_read" ON sales_subcategories FOR SELECT USING (
  user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  )
);

-- ── 6. FK from sales_log → checklist_submissions (both tables now exist) ─────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'sales_log_checklist_id_fkey'
      AND table_name = 'sales_log'
  ) THEN
    ALTER TABLE sales_log
      ADD CONSTRAINT sales_log_checklist_id_fkey
      FOREIGN KEY (checklist_id)
      REFERENCES checklist_submissions(id)
      ON DELETE SET NULL;
  END IF;
END $$;

-- ── 7. Captain write on checklist_submissions ────────────────────────────────
-- Captains can create checklist submissions on behalf of the owner
CREATE POLICY "captain_write" ON checklist_submissions FOR INSERT
  WITH CHECK (
    user_id IN (
      SELECT owner_user_id FROM account_members
      WHERE member_user_id = auth.uid() AND status = 'active' AND role = 'captain'
    )
  );

-- ── DONE ─────────────────────────────────────────────────────────────────────
-- After running, set the Vercel env var:
--   STRIPE_PRICE_SALES_ADDON = price_xxxx  (create in Stripe Dashboard: $25/mo)
-- Admin test: UPDATE accounts SET has_sales_addon=true WHERE email='russelsaiassistant@gmail.com';
