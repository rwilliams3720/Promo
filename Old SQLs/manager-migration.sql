-- Manager assignment: each member can have a "managed by" pointing to a captain/CO member
ALTER TABLE account_members ADD COLUMN IF NOT EXISTS managed_by uuid REFERENCES account_members(id) ON DELETE SET NULL;
