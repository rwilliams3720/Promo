-- Agent Goals — run in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS agent_goals (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id     text        NOT NULL,
  period_type  text        NOT NULL CHECK (period_type IN ('monthly','quarterly','semi_annual','annual')),
  period_label text        NOT NULL,
  period_start date        NOT NULL,
  period_end   date        NOT NULL,
  goals        jsonb       NOT NULL DEFAULT '{}',
  is_public    boolean     NOT NULL DEFAULT false,
  is_recurring boolean     NOT NULL DEFAULT false,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_id, period_type, period_label)
);

ALTER TABLE agent_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_own" ON agent_goals
  USING (user_id = auth.uid());

CREATE POLICY "member_read" ON agent_goals FOR SELECT
  USING (
    user_id IN (
      SELECT owner_user_id FROM account_members
      WHERE member_user_id = auth.uid() AND status = 'active'
    )
  );
