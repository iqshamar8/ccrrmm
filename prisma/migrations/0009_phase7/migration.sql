-- CreateEnum
CREATE TYPE "PlatformInvoiceStatus" AS ENUM ('ISSUED', 'PAID', 'VOID');

-- CreateEnum
CREATE TYPE "PlatformInvoiceKind" AS ENUM ('NEW', 'RENEWAL', 'UPGRADE', 'MANUAL');

-- CreateEnum
CREATE TYPE "PlatformPaymentStatus" AS ENUM ('PENDING', 'CONFIRMED', 'REJECTED');





-- AlterTable
ALTER TABLE "Plan" ADD COLUMN     "isPublic" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "TenantSubscription" ADD COLUMN     "autoRenew" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "couponCyclesUsed" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "couponId" UUID,
ADD COLUMN     "pastDueSince" TIMESTAMP(3),
ADD COLUMN     "pausedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "recoveryCodes" TEXT[],
ADD COLUMN     "totpEnabledAt" TIMESTAMP(3),
ADD COLUMN     "totpSecretEnc" TEXT;

-- CreateTable
CREATE TABLE "PlatformSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "companyName" TEXT NOT NULL DEFAULT 'MedCRM',
    "companyAddress" TEXT,
    "taxNo" TEXT,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "bankDetails" TEXT,
    "invoiceFooter" TEXT,
    "supportEmail" TEXT,
    "graceDays" INTEGER NOT NULL DEFAULT 7,
    "renewalLeadDays" INTEGER NOT NULL DEFAULT 7,
    "reminderDays" INTEGER[] DEFAULT ARRAY[14, 7, 3, 1]::INTEGER[],
    "allowSignup" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCoupon" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "durationCycles" INTEGER,
    "maxRedemptions" INTEGER,
    "redemptions" INTEGER NOT NULL DEFAULT 0,
    "planIds" UUID[],
    "validFrom" TIMESTAMP(3),
    "validUntil" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCoupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformInvoice" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID,
    "planId" UUID NOT NULL,
    "kind" "PlatformInvoiceKind" NOT NULL,
    "cycle" "BillingCycle" NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "tax" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "status" "PlatformInvoiceStatus" NOT NULL DEFAULT 'ISSUED',
    "dueDate" TIMESTAMP(3) NOT NULL,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "couponId" UUID,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformInvoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformPayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "status" "PlatformPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedById" UUID,
    "confirmedById" UUID,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlatformPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "count" INTEGER NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "PlatformCoupon_code_key" ON "PlatformCoupon"("code");

-- CreateIndex
CREATE UNIQUE INDEX "PlatformInvoice_number_key" ON "PlatformInvoice"("number");

-- CreateIndex
CREATE INDEX "PlatformInvoice_tenantId_status_idx" ON "PlatformInvoice"("tenantId", "status");

-- CreateIndex
CREATE INDEX "PlatformInvoice_status_dueDate_idx" ON "PlatformInvoice"("status", "dueDate");

-- CreateIndex
CREATE INDEX "PlatformPayment_tenantId_idx" ON "PlatformPayment"("tenantId");

-- CreateIndex
CREATE INDEX "PlatformPayment_status_idx" ON "PlatformPayment"("status");

-- AddForeignKey
ALTER TABLE "TenantSubscription" ADD CONSTRAINT "TenantSubscription_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "PlatformCoupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "TenantSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_planId_fkey" FOREIGN KEY ("planId") REFERENCES "Plan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformInvoice" ADD CONSTRAINT "PlatformInvoice_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "PlatformCoupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlatformPayment" ADD CONSTRAINT "PlatformPayment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "PlatformInvoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================== Phase 7 security
-- Platform billing: written only by the platform role; a tenant can READ its own invoices & payments.
GRANT SELECT, INSERT, UPDATE, DELETE ON "PlatformSettings", "PlatformCoupon", "PlatformInvoice", "PlatformPayment", "RateLimit" TO crm_platform;
GRANT SELECT ON "PlatformInvoice", "PlatformPayment" TO crm_app;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['PlatformInvoice','PlatformPayment'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
  END LOOP;
END $$;
-- Platform-only tables: no access at all for the tenant app role.
REVOKE ALL ON "PlatformSettings", "PlatformCoupon", "RateLimit" FROM crm_app;

CREATE SEQUENCE IF NOT EXISTS platform_invoice_seq START 1;
GRANT USAGE, SELECT ON SEQUENCE platform_invoice_seq TO crm_platform;

ALTER TABLE "PlatformInvoice" ADD CONSTRAINT pinv_amounts CHECK (subtotal >= 0 AND discount >= 0 AND credit >= 0 AND tax >= 0 AND total >= 0 AND "periodEnd" > "periodStart");
ALTER TABLE "PlatformPayment" ADD CONSTRAINT ppay_amount CHECK (amount > 0);
ALTER TABLE "PlatformCoupon" ADD CONSTRAINT pcoupon_value CHECK (value > 0 AND (type <> 'PERCENT' OR value <= 100) AND redemptions >= 0);
ALTER TABLE "PlatformSettings" ADD CONSTRAINT psettings_single CHECK (id = 1);
-- One renewal invoice per subscription period (idempotent lifecycle job).
CREATE UNIQUE INDEX pinv_one_per_period ON "PlatformInvoice" ("subscriptionId", "periodStart", kind) WHERE status <> 'VOID' AND kind IN ('NEW', 'RENEWAL');
INSERT INTO "PlatformSettings" (id, "updatedAt") VALUES (1, now()) ON CONFLICT DO NOTHING;

-- =============================================================== Phase 7 performance
-- Indexes for queries added in Phases 5–6 (reports, ledger, stock hooks), found by reviewing the query paths.
CREATE INDEX IF NOT EXISTS perf_invoice_issued ON "Invoice" ("tenantId", "issuedAt");
CREATE INDEX IF NOT EXISTS perf_invoice_seller ON "Invoice" ("tenantId", "salesStaffId") WHERE "salesStaffId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_invoice_coupon ON "Invoice" ("couponId") WHERE "couponId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_invoice_corp ON "Invoice" ("corporateAgreementId") WHERE "corporateAgreementId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_invline_service ON "InvoiceLine" ("tenantId", "serviceId") WHERE "serviceId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_jline_branch ON "JournalLine" ("tenantId", "branchId", "accountId");
CREATE INDEX IF NOT EXISTS perf_jline_supplier ON "JournalLine" ("tenantId", "supplierId") WHERE "supplierId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_smov_doc ON "StockMovement" ("documentId");
CREATE INDEX IF NOT EXISTS perf_sdoc_appt ON "StockDocument" ("tenantId", "appointmentId") WHERE "appointmentId" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_sdoc_wh ON "StockDocument" ("tenantId", "warehouseId", date);
CREATE INDEX IF NOT EXISTS perf_client_lastvisit ON "Client" ("tenantId", "lastVisitAt") WHERE "deletedAt" IS NULL;
CREATE INDEX IF NOT EXISTS perf_client_converted ON "Client" ("tenantId", "convertedAt") WHERE "convertedAt" IS NOT NULL;
CREATE INDEX IF NOT EXISTS perf_msg_client ON "Message" ("tenantId", "clientId");
CREATE INDEX IF NOT EXISTS perf_coupon_redeem ON "CouponRedemption" ("couponId", "createdAt");
CREATE INDEX IF NOT EXISTS perf_appt_completed ON "Appointment" ("tenantId", "completedAt") WHERE status = 'COMPLETED';
