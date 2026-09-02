-- Annual Raise-Eligibility Tracker
-- Adds a flag + config bundle to agent_goals so an existing annual goal can be
-- marked as counting toward an end-of-year raise, with configurable
-- combination mode (individual/blended/separate vs an Agency Goal),
-- reward calculation (proportional or threshold tiers), an optional
-- individual-performance gate, and a stretch breakpoint for exceeding goal.
--
-- Only meaningful when period_type = 'annual' — enforced in application code
-- (api/agent-goals.js), not a DB constraint, matching this table's existing
-- style (no CHECK constraints on period_type/goals shape either).

ALTER TABLE agent_goals ADD COLUMN IF NOT EXISTS is_raise_goal boolean NOT NULL DEFAULT false;
ALTER TABLE agent_goals ADD COLUMN IF NOT EXISTS raise_config  jsonb   NOT NULL DEFAULT '{}'::jsonb;

-- raise_config shape (all fields optional/defaulted in application code):
-- {
--   "combination_mode": "individual" | "blended" | "separate",
--   "agency_location_id": uuid | null,       -- required when mode != individual
--   "agency_metric": "count" | "premium",
--   "blend_individual_weight": number,       -- 0-100, blended mode only
--   "reward_mode": "proportional" | "threshold",
--   "proportional": {
--     "target_pct": number,                  -- raise earned in full at 100% of goal
--     "max_pct": number,                     -- cap for exceeding goal
--     "stretch_mode": "auto" | "custom",
--     "stretch_breakpoint_pct": number | null
--   },
--   "threshold_tiers": [{ "pct": number, "raise": number }, ...],
--   "gate_enabled": boolean,
--   "gate_floor_pct": number
-- }
