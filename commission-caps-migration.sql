ALTER TABLE commission_structures ADD COLUMN IF NOT EXISTS cap_per_policy numeric;
ALTER TABLE commission_structures ADD COLUMN IF NOT EXISTS cap_per_structure numeric;
ALTER TABLE agent_roster ADD COLUMN IF NOT EXISTS commission_cap_total numeric;
