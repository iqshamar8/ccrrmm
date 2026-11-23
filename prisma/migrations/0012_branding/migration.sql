-- Clinic branding: a second (accent) colour. The logo stays in "logoUrl",
-- which may now hold a small data:image URL uploaded from the settings page.
ALTER TABLE "Tenant" ADD COLUMN IF NOT EXISTS "accentColor" TEXT NOT NULL DEFAULT '#dcf36b';

-- crm_app has column-level UPDATE grants on Tenant (see 0002_rls); add the new column.
GRANT UPDATE ("accentColor") ON "Tenant" TO crm_app;
