-- Commission Structures v2 additions
ALTER TABLE commission_structures ADD COLUMN IF NOT EXISTS pay_on_issue boolean NOT NULL DEFAULT false;

-- Production thresholds: array of {products:[key,...], min_count:n} — all must be met each month before any commission is paid
ALTER TABLE commission_structures ADD COLUMN IF NOT EXISTS thresholds jsonb NOT NULL DEFAULT '[]';

-- Link account_members to an agent roster entry
ALTER TABLE account_members ADD COLUMN IF NOT EXISTS roster_agent_id text;
