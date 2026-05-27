-- Commission Bank feature
-- Smooths out large commission payouts by capping per-period pay and rolling excess into a bank.
-- Interest can optionally accrue on the banked balance.

-- 1. Bank configuration stored per account
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS commission_bank_config jsonb NOT NULL DEFAULT '{}';
-- Shape: { "enabled": true, "cap_per_period": 5000, "interest_rate": 0, "interest_period": "monthly" }

-- 2. Ledger table — one row per agent per month showing what was earned, paid, banked, and interest
CREATE TABLE IF NOT EXISTS commission_bank (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  agent_id         text        NOT NULL,
  month            text        NOT NULL,  -- e.g. "May 2026"
  earned           numeric     NOT NULL DEFAULT 0,
  cap_amount       numeric,               -- NULL means no cap was configured
  paid_out         numeric     NOT NULL DEFAULT 0,
  banked_amount    numeric     NOT NULL DEFAULT 0,  -- added to bank this month (earned - paid_out when earned > cap)
  interest_amount  numeric     NOT NULL DEFAULT 0,  -- interest credited this month on prior balance
  bank_balance_before numeric  NOT NULL DEFAULT 0,  -- balance at start of month
  bank_balance_after  numeric  NOT NULL DEFAULT 0,  -- balance after this month (before + banked + interest - drawdown)
  drawdown_amount  numeric     NOT NULL DEFAULT 0,  -- amount pulled from bank to top up to cap (when earned < cap)
  notes            text,
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, agent_id, month)
);

ALTER TABLE commission_bank ENABLE ROW LEVEL SECURITY;
CREATE POLICY "user_own" ON commission_bank USING (user_id = auth.uid());
CREATE POLICY "member_read" ON commission_bank FOR SELECT USING (
  user_id IN (
    SELECT owner_user_id FROM account_members
    WHERE member_user_id = auth.uid() AND status = 'active'
  )
);
