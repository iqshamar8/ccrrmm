-- Tenants may submit a pending payment against their own visible invoices.
-- Keep review fields and all UPDATE/DELETE rights platform-only.
GRANT INSERT ("id", "tenantId", "invoiceId", "amount", "method", "reference", "note", "paidAt", "submittedById", "createdAt")
  ON TABLE "PlatformPayment" TO crm_app;
