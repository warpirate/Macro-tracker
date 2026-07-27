-- RLS controls which ROWS a role can touch; Postgres still enforces table-level
-- privileges first. Without this grant, every authenticated request to user_data fails
-- with 42501 "permission denied for table user_data" and cloud sync silently breaks,
-- even though the row-level policy is correct.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_data TO authenticated;
