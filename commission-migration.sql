-- Commission Structures table
CREATE TABLE IF NOT EXISTS commission_structures (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  name text NOT NULL,
  default_split_ratio numeric(5,4) NOT NULL DEFAULT 0.5,
  rates jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, name)
);
ALTER TABLE commission_structures ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own" ON commission_structures USING (user_id = auth.uid());

-- Commission Payments table (paid tracking)
CREATE TABLE IF NOT EXISTS commission_payments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  month text NOT NULL,
  agent_id text NOT NULL,
  amount_paid numeric(10,2),
  paid_date date,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, month, agent_id)
);
ALTER TABLE commission_payments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own" ON commission_payments USING (user_id = auth.uid());

-- Add commission structure assignment to agent_roster
ALTER TABLE agent_roster ADD COLUMN IF NOT EXISTS commission_structure_id uuid REFERENCES commission_structures(id) ON DELETE SET NULL;

-- Add split ratio to sales_log (primary agent's share as decimal e.g. 0.6 = 60%)
ALTER TABLE sales_log ADD COLUMN IF NOT EXISTS split_ratio numeric(5,4);

-- Add commissions add-on flag to accounts
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS has_commissions_addon boolean NOT NULL DEFAULT false;
