-- Analysis credit wallet
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_balance numeric NOT NULL DEFAULT 0;
ALTER TABLE accounts ADD COLUMN IF NOT EXISTS credit_waived  boolean NOT NULL DEFAULT false;
