-- Trigger helper must be executable by the runtime roles (it was revoked from PUBLIC).
GRANT EXECUTE ON FUNCTION app_same_tenant(uuid, text, uuid) TO crm_app, crm_platform;
