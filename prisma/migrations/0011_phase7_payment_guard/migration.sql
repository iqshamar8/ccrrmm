-- Prisma INSERT ... RETURNING needs table-level INSERT rights. The trigger
-- below preserves the critical boundary: tenant app code may only create a
-- pending submission, never a confirmed/reviewed payment.
GRANT INSERT ON TABLE "PlatformPayment" TO crm_app;

CREATE OR REPLACE FUNCTION platform_payment_tenant_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF current_user = 'crm_app'
     AND (NEW.status <> 'PENDING' OR NEW."confirmedById" IS NOT NULL OR NEW."confirmedAt" IS NOT NULL) THEN
    RAISE EXCEPTION 'tenant app may only submit pending platform payments';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION platform_payment_tenant_insert_guard() FROM PUBLIC;
CREATE TRIGGER platform_payment_tenant_insert_guard
  BEFORE INSERT ON "PlatformPayment"
  FOR EACH ROW EXECUTE FUNCTION platform_payment_tenant_insert_guard();
