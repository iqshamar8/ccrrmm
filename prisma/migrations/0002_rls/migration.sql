-- =============================================================================
-- Row Level Security: the database-level tenant wall.
-- Applied by scripts/db-setup.ts after Prisma migrations (idempotent).
--
-- The app sets   SELECT set_config('app.tenant_id', '<uuid>', true)
-- at the start of every tenant transaction (src/server/db.ts withTenant()).
-- Role crm_app has NOBYPASSRLS, so it can ONLY see/write rows of that tenant.
-- If the setting is missing, current_setting(..., true) returns NULL/'' and
-- NO rows match: fail closed.
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_tenant() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.tenant_id', true), '')::uuid
$$;

-- Tables with a NOT NULL tenantId
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['Branch','Role','UserBranch','TenantSubscription'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END $$;

-- User: tenant users only (platform admins have tenantId NULL -> invisible)
ALTER TABLE "User" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "User" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "User";
CREATE POLICY tenant_isolation ON "User"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant() AND "isPlatformAdmin" = false);

-- AuditLog: tenant can read & append its own rows only
ALTER TABLE "AuditLog" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "AuditLog" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "AuditLog";
CREATE POLICY tenant_isolation ON "AuditLog"
  USING ("tenantId" = app_current_tenant())
  WITH CHECK ("tenantId" = app_current_tenant());

-- Tenant: a tenant session may read (not create/delete) its own tenant row
ALTER TABLE "Tenant" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Tenant" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS tenant_isolation ON "Tenant";
CREATE POLICY tenant_isolation ON "Tenant"
  USING ("id" = app_current_tenant())
  WITH CHECK ("id" = app_current_tenant());

-- ------------------------------------------------------------- grants ----
GRANT USAGE ON SCHEMA public TO crm_app, crm_platform;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO crm_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO crm_app, crm_platform;

-- crm_app: full CRUD on tenant tables (RLS filters rows) ...
GRANT SELECT, INSERT, UPDATE, DELETE ON "Branch", "Role", "User", "UserBranch" TO crm_app;
-- ... append-only audit log (no UPDATE/DELETE: audit trail is immutable)
GRANT SELECT, INSERT ON "AuditLog" TO crm_app;
-- ... read-only on its own tenant + subscription; only branding/contact
--     columns are updatable (status, type, slug stay platform-controlled)
GRANT SELECT ON "Tenant" TO crm_app;
GRANT UPDATE ("name", "logoUrl", "primaryColor", "timezone", "defaultLocale",
              "contactEmail", "contactPhone", "address", "updatedAt") ON "Tenant" TO crm_app;
GRANT SELECT ON "TenantSubscription", "Plan" TO crm_app;
-- crm_app gets no access to _prisma_migrations
REVOKE ALL ON "_prisma_migrations" FROM crm_app;
