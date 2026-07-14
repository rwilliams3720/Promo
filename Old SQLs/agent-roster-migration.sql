CREATE TABLE IF NOT EXISTS agent_roster (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id   text        NOT NULL,
  name       text        NOT NULL,
  active     boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_id)
);
ALTER TABLE agent_roster ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own" ON agent_roster USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "member_read" ON agent_roster FOR SELECT USING (
  user_id IN (SELECT owner_user_id FROM account_members WHERE member_user_id = auth.uid() AND status = 'active')
);
-- Seed existing users from race_data
INSERT INTO agent_roster (user_id, agent_id, name)
SELECT DISTINCT user_id, agent_id, name FROM race_data
WHERE agent_id IS NOT NULL AND agent_id != '' AND name IS NOT NULL AND name != ''
ON CONFLICT (user_id, agent_id) DO NOTHING;
