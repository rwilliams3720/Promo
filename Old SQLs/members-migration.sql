-- ── DIRECTIVE 1: Agency Management — Team Members ────────────────────────────
-- Run this in the Supabase SQL Editor (project: boat-race)

-- 1. account_members table
CREATE TABLE IF NOT EXISTS account_members (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id     uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  member_user_id    uuid        REFERENCES auth.users ON DELETE SET NULL,
  email             text        NOT NULL,
  role              text        NOT NULL DEFAULT 'bosun',
  -- role values: 'captain' | 'chief_officer' | 'bosun' | 'custom'
  custom_tabs       jsonb,
  -- custom_tabs example: ["race","performance","history"]
  status            text        NOT NULL DEFAULT 'invited',
  -- status values: 'invited' | 'active' | 'removed'
  invite_token      text        UNIQUE,
  invite_expires_at timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(owner_user_id, email)
);

ALTER TABLE account_members ENABLE ROW LEVEL SECURITY;

-- Owner can do everything with their own member records
CREATE POLICY "owner_all" ON account_members
  USING (owner_user_id = auth.uid());

-- Member can read their own record (to resolve which account they belong to)
CREATE POLICY "member_read_own" ON account_members FOR SELECT
  USING (member_user_id = auth.uid());

-- 2. Member read policies on data tables
-- These allow sub-users to read their owner's data via the anon client.
-- All policies are additive (OR'd with existing user_id = auth.uid() policies).

CREATE POLICY "member_read" ON race_data FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "member_read" ON race_config FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "member_read" ON scoring_config FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "member_read" ON historical_wins FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "member_read" ON historical_months FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "member_read" ON call_log FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

CREATE POLICY "member_read" ON sales_log FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

-- Members can read their owner's account row (company name, plan, status)
-- but the existing user_id = auth.uid() policy still covers owners reading their own row.
CREATE POLICY "member_read_owner_account" ON accounts FOR SELECT
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  ));

-- Captain-role members can update race_data on behalf of the owner (team assignments, scoring)
CREATE POLICY "captain_write_race_data" ON race_data FOR UPDATE
  USING (user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active' AND role = 'captain'
  ));
