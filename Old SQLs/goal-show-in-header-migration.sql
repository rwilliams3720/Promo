-- Lets a Whole Agency goal be pinned as a condensed progress bar in the app
-- header, visible to everyone (account-wide setting, not per-viewer).
-- Enforced in application code (api/agent-goals.js) to only ever be settable
-- on agent_id = '__agency__' rows, and to only ever have one true at a time
-- per account (unsetting any other __agency__ goal's flag when a new one is
-- pinned), rather than a DB constraint.
ALTER TABLE agent_goals ADD COLUMN IF NOT EXISTS show_in_header boolean NOT NULL DEFAULT false;
