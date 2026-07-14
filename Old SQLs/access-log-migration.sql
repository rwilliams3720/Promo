-- Access log table for sales log audit trail
-- Tracks export, edit, and delete events on sales_log records
-- Written via service key only — no client-side RLS policies intentionally

CREATE TABLE IF NOT EXISTS access_log (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  actor_user_id uuid        NOT NULL REFERENCES auth.users ON DELETE CASCADE,
  actor_email   text,
  action        text        NOT NULL CHECK (action IN ('export', 'edit', 'delete')),
  resource      text        NOT NULL DEFAULT 'sales_log',
  record_hash   text,
  row_count     int,
  metadata      jsonb,
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE access_log ENABLE ROW LEVEL SECURITY;
-- No SELECT/INSERT/UPDATE/DELETE policies — only accessible via service key.
-- This prevents any authenticated client from reading or tampering with audit logs.

-- Index for querying by account and time (most common audit query pattern)
CREATE INDEX IF NOT EXISTS access_log_user_created ON access_log (user_id, created_at DESC);
