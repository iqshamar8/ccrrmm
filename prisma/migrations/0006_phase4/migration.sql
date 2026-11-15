-- CreateEnum
CREATE TYPE "InvoiceType" AS ENUM ('SERVICE', 'SALE', 'PROGRAM', 'SUBSCRIPTION', 'SURGERY', 'MIXED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "LineKind" AS ENUM ('SERVICE', 'PRODUCT', 'PROGRAM', 'SUBSCRIPTION', 'SURGERY', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'TRANSFER', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentKind" AS ENUM ('PAYMENT', 'REFUND');

-- CreateEnum
CREATE TYPE "CouponType" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "LoyaltyTxnType" AS ENUM ('EARN', 'REDEEM', 'ADJUST', 'REVERSE');

-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('ACTIVE', 'ON_LEAVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "AttendanceStatus" AS ENUM ('PRESENT', 'LATE', 'ABSENT', 'LEAVE');

-- CreateEnum
CREATE TYPE "LeaveType" AS ENUM ('ANNUAL', 'SICK', 'UNPAID', 'OTHER');

-- CreateEnum
CREATE TYPE "LeaveStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AdvanceStatus" AS ENUM ('OPEN', 'SETTLED');

-- CreateEnum
CREATE TYPE "PayrollStatus" AS ENUM ('DRAFT', 'APPROVED', 'PAID');

-- CreateEnum
CREATE TYPE "CommissionSource" AS ENUM ('SERVICE_EXEC', 'SERVICE_MARKETING', 'SURGERY', 'REVIEW', 'COUPON', 'PRODUCT_SALE', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "CommissionStatus" AS ENUM ('PENDING', 'APPROVED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "TenantSettings" (
    "tenantId" UUID NOT NULL,
    "taxName" TEXT NOT NULL DEFAULT 'ضريبة المبيعات',
    "defaultTaxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "invoiceDueDays" INTEGER NOT NULL DEFAULT 0,
    "invoiceFooter" TEXT,
    "loyaltyEnabled" BOOLEAN NOT NULL DEFAULT true,
    "pointsPerUnit" DECIMAL(14,6) NOT NULL DEFAULT 0,
    "pointValue" DECIMAL(14,4) NOT NULL DEFAULT 0,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 0,
    "reviewCommissionAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "productCommissionPercent" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TenantSettings_pkey" PRIMARY KEY ("tenantId")
);

-- CreateTable
CREATE TABLE "Product" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "sku" TEXT,
    "barcode" TEXT,
    "unit" TEXT NOT NULL DEFAULT 'قطعة',
    "price" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invoice" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT,
    "clientId" UUID,
    "branchId" UUID NOT NULL,
    "type" "InvoiceType" NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" VARCHAR(3) NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "dueDate" DATE,
    "subtotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "discountAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "couponDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "loyaltyDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "paidTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "refundedTotal" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "couponId" UUID,
    "loyaltyPointsRedeemed" INTEGER NOT NULL DEFAULT 0,
    "salesStaffId" UUID,
    "notes" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Invoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "kind" "LineKind" NOT NULL,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL DEFAULT 1,
    "unitPrice" DECIMAL(14,2) NOT NULL,
    "discount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "taxRate" DECIMAL(5,2) NOT NULL DEFAULT 0,
    "lineTotal" DECIMAL(14,2) NOT NULL,
    "taxAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "serviceId" UUID,
    "productId" UUID,
    "appointmentId" UUID,
    "clientProgramId" UUID,
    "subscriptionId" UUID,
    "surgeryId" UUID,
    "performedById" UUID,
    "voided" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "InvoiceLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "kind" "PaymentKind" NOT NULL DEFAULT 'PAYMENT',
    "receiptNo" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "reference" TEXT,
    "note" TEXT,
    "paidAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "receivedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InvoiceInstallment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "seq" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,

    CONSTRAINT "InvoiceInstallment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Coupon" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "CouponType" NOT NULL,
    "value" DECIMAL(14,2) NOT NULL,
    "maxDiscount" DECIMAL(14,2),
    "minAmount" DECIMAL(14,2),
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "usageLimit" INTEGER,
    "perClientLimit" INTEGER,
    "allServices" BOOLEAN NOT NULL DEFAULT true,
    "serviceIds" UUID[],
    "clientIds" UUID[],
    "ownerUserId" UUID,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'NONE',
    "commissionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Coupon_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CouponRedemption" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "couponId" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "clientId" UUID,
    "discount" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CouponRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "minPoints" INTEGER NOT NULL,
    "multiplier" DECIMAL(5,2) NOT NULL DEFAULT 1,
    "color" TEXT,

    CONSTRAINT "LoyaltyTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LoyaltyTransaction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "type" "LoyaltyTxnType" NOT NULL,
    "points" INTEGER NOT NULL,
    "invoiceId" UUID,
    "note" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeProfile" (
    "userId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "employeeNo" TEXT,
    "department" TEXT,
    "specialty" TEXT,
    "hireDate" DATE,
    "baseSalary" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "fixedAllowance" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "monthlyTarget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "dailyHours" DECIMAL(4,2) NOT NULL DEFAULT 8,
    "status" "EmploymentStatus" NOT NULL DEFAULT 'ACTIVE',
    "emergencyContact" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmployeeProfile_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE "WorkShift" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "branchId" UUID,
    "dayOfWeek" INTEGER NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,

    CONSTRAINT "WorkShift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttendanceRecord" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "checkIn" TIMESTAMP(3),
    "checkOut" TIMESTAMP(3),
    "status" "AttendanceStatus" NOT NULL,
    "lateMinutes" INTEGER NOT NULL DEFAULT 0,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeaveRequest" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" "LeaveType" NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "days" INTEGER NOT NULL,
    "reason" TEXT,
    "status" "LeaveStatus" NOT NULL DEFAULT 'PENDING',
    "decidedById" UUID,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeaveRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryAdvance" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "givenAt" DATE NOT NULL,
    "note" TEXT,
    "status" "AdvanceStatus" NOT NULL DEFAULT 'OPEN',
    "payrollRunId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalaryAdvance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollRun" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "status" "PayrollStatus" NOT NULL DEFAULT 'DRAFT',
    "totalNet" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PayrollRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayrollItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "baseSalary" DECIMAL(14,2) NOT NULL,
    "allowances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "commissions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deductions" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "advances" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "absenceDays" DECIMAL(6,2) NOT NULL DEFAULT 0,
    "absenceDeduction" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "net" DECIMAL(14,2) NOT NULL,
    "note" TEXT,

    CONSTRAINT "PayrollItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommissionEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "source" "CommissionSource" NOT NULL,
    "invoiceId" UUID,
    "invoiceLineId" UUID,
    "reviewId" UUID,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "rateType" "CommissionType" NOT NULL,
    "rateValue" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "earnedAt" TIMESTAMP(3) NOT NULL,
    "approvedById" UUID,
    "approvedAt" TIMESTAMP(3),
    "payrollRunId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommissionEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmployeeEvaluation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "period" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "notes" TEXT,
    "evaluatorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmployeeEvaluation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Product_tenantId_isActive_idx" ON "Product"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_status_issuedAt_idx" ON "Invoice"("tenantId", "status", "issuedAt");

-- CreateIndex
CREATE INDEX "Invoice_tenantId_clientId_idx" ON "Invoice"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Invoice_tenantId_code_key" ON "Invoice"("tenantId", "code");

-- CreateIndex
CREATE INDEX "InvoiceLine_tenantId_invoiceId_idx" ON "InvoiceLine"("tenantId", "invoiceId");

-- CreateIndex
CREATE INDEX "Payment_tenantId_paidAt_idx" ON "Payment"("tenantId", "paidAt");

-- CreateIndex
CREATE INDEX "Payment_invoiceId_idx" ON "Payment"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_tenantId_receiptNo_key" ON "Payment"("tenantId", "receiptNo");

-- CreateIndex
CREATE INDEX "InvoiceInstallment_tenantId_dueDate_idx" ON "InvoiceInstallment"("tenantId", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "InvoiceInstallment_invoiceId_seq_key" ON "InvoiceInstallment"("invoiceId", "seq");

-- CreateIndex
CREATE UNIQUE INDEX "Coupon_tenantId_code_key" ON "Coupon"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "CouponRedemption_invoiceId_key" ON "CouponRedemption"("invoiceId");

-- CreateIndex
CREATE INDEX "CouponRedemption_tenantId_couponId_idx" ON "CouponRedemption"("tenantId", "couponId");

-- CreateIndex
CREATE INDEX "LoyaltyTier_tenantId_idx" ON "LoyaltyTier"("tenantId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_tenantId_clientId_idx" ON "LoyaltyTransaction"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "LoyaltyTransaction_invoiceId_idx" ON "LoyaltyTransaction"("invoiceId");

-- CreateIndex
CREATE INDEX "EmployeeProfile_tenantId_idx" ON "EmployeeProfile"("tenantId");

-- CreateIndex
CREATE INDEX "WorkShift_tenantId_idx" ON "WorkShift"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkShift_userId_dayOfWeek_key" ON "WorkShift"("userId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "AttendanceRecord_tenantId_date_idx" ON "AttendanceRecord"("tenantId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "AttendanceRecord_userId_date_key" ON "AttendanceRecord"("userId", "date");

-- CreateIndex
CREATE INDEX "LeaveRequest_tenantId_status_idx" ON "LeaveRequest"("tenantId", "status");

-- CreateIndex
CREATE INDEX "SalaryAdvance_tenantId_status_idx" ON "SalaryAdvance"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollRun_tenantId_period_key" ON "PayrollRun"("tenantId", "period");

-- CreateIndex
CREATE INDEX "PayrollItem_tenantId_idx" ON "PayrollItem"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "PayrollItem_runId_userId_key" ON "PayrollItem"("runId", "userId");

-- CreateIndex
CREATE INDEX "CommissionEntry_tenantId_userId_status_idx" ON "CommissionEntry"("tenantId", "userId", "status");

-- CreateIndex
CREATE INDEX "CommissionEntry_tenantId_earnedAt_idx" ON "CommissionEntry"("tenantId", "earnedAt");

-- CreateIndex
CREATE INDEX "EmployeeEvaluation_tenantId_userId_idx" ON "EmployeeEvaluation"("tenantId", "userId");

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invoice" ADD CONSTRAINT "Invoice_salesStaffId_fkey" FOREIGN KEY ("salesStaffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceLine" ADD CONSTRAINT "InvoiceLine_performedById_fkey" FOREIGN KEY ("performedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InvoiceInstallment" ADD CONSTRAINT "InvoiceInstallment_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CouponRedemption" ADD CONSTRAINT "CouponRedemption_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeProfile" ADD CONSTRAINT "EmployeeProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkShift" ADD CONSTRAINT "WorkShift_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeaveRequest" ADD CONSTRAINT "LeaveRequest_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryAdvance" ADD CONSTRAINT "SalaryAdvance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "PayrollRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayrollItem" ADD CONSTRAINT "PayrollItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CommissionEntry" ADD CONSTRAINT "CommissionEntry_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "Invoice"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmployeeEvaluation" ADD CONSTRAINT "EmployeeEvaluation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Phase 4 — RLS, grants, cross-tenant guards, billing integrity.
-- =============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TenantSettings','Product','Invoice','InvoiceLine','Payment','InvoiceInstallment','Coupon','CouponRedemption',
                           'LoyaltyTier','LoyaltyTransaction','EmployeeProfile','WorkShift','AttendanceRecord','LeaveRequest',
                           'SalaryAdvance','PayrollRun','PayrollItem','CommissionEntry','EmployeeEvaluation'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_platform', t);
  END LOOP;
END $$;

-- Financial records are not hard-deleted by the app: cancellations/refunds are new rows.
REVOKE DELETE ON "Payment", "CouponRedemption" FROM crm_app;
GRANT DELETE ON "CouponRedemption" TO crm_app; -- redemption is removed when an invoice is cancelled

CREATE TRIGGER invoice_tenant_guard BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'branchId','Branch', 'couponId','Coupon', 'salesStaffId','User');
CREATE TRIGGER invline_tenant_guard BEFORE INSERT OR UPDATE ON "InvoiceLine" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('invoiceId','Invoice', 'serviceId','Service', 'productId','Product', 'appointmentId','Appointment',
    'clientProgramId','ClientProgram', 'subscriptionId','ClientSubscription', 'surgeryId','Surgery', 'performedById','User');
CREATE TRIGGER payment_tenant_guard BEFORE INSERT OR UPDATE ON "Payment" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('invoiceId','Invoice', 'receivedById','User');
CREATE TRIGGER inst_tenant_guard BEFORE INSERT OR UPDATE ON "InvoiceInstallment" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('invoiceId','Invoice');
CREATE TRIGGER redemption_tenant_guard BEFORE INSERT OR UPDATE ON "CouponRedemption" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('couponId','Coupon', 'invoiceId','Invoice', 'clientId','Client');
CREATE TRIGGER loyalty_tenant_guard BEFORE INSERT OR UPDATE ON "LoyaltyTransaction" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'invoiceId','Invoice');
CREATE TRIGGER emp_tenant_guard BEFORE INSERT OR UPDATE ON "EmployeeProfile" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User');
CREATE TRIGGER shift_tenant_guard BEFORE INSERT OR UPDATE ON "WorkShift" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User', 'branchId','Branch');
CREATE TRIGGER att_tenant_guard BEFORE INSERT OR UPDATE ON "AttendanceRecord" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User');
CREATE TRIGGER leave_tenant_guard BEFORE INSERT OR UPDATE ON "LeaveRequest" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User');
CREATE TRIGGER adv_tenant_guard BEFORE INSERT OR UPDATE ON "SalaryAdvance" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User', 'payrollRunId','PayrollRun');
CREATE TRIGGER pitem_tenant_guard BEFORE INSERT OR UPDATE ON "PayrollItem" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('runId','PayrollRun', 'userId','User');
CREATE TRIGGER comm_tenant_guard BEFORE INSERT OR UPDATE ON "CommissionEntry" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('userId','User', 'invoiceId','Invoice', 'payrollRunId','PayrollRun', 'reviewId','MedicalReview');
CREATE TRIGGER eval_tenant_guard BEFORE INSERT OR UPDATE ON "EmployeeEvaluation" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User');

-- Integrity
ALTER TABLE "Invoice" ADD CONSTRAINT inv_amounts CHECK ("total" >= 0 AND "paidTotal" >= 0 AND "paidTotal" <= "total" AND "refundedTotal" >= 0);
ALTER TABLE "Payment" ADD CONSTRAINT pay_positive CHECK ("amount" > 0);
ALTER TABLE "InvoiceLine" ADD CONSTRAINT line_qty CHECK ("quantity" > 0 AND "unitPrice" >= 0 AND "discount" >= 0);
ALTER TABLE "Coupon" ADD CONSTRAINT coupon_value CHECK ("value" > 0 AND ("type" <> 'PERCENT' OR "value" <= 100));
ALTER TABLE "LeaveRequest" ADD CONSTRAINT leave_dates CHECK ("endDate" >= "startDate" AND "days" > 0);
ALTER TABLE "EmployeeEvaluation" ADD CONSTRAINT eval_rating CHECK ("rating" BETWEEN 1 AND 5);
ALTER TABLE "WorkShift" ADD CONSTRAINT shift_dow CHECK ("dayOfWeek" BETWEEN 0 AND 6);

-- No double billing: a source can be on only one live (non-cancelled) invoice line.
CREATE UNIQUE INDEX bill_once_appointment ON "InvoiceLine" ("appointmentId") WHERE "appointmentId" IS NOT NULL AND NOT "voided";
CREATE UNIQUE INDEX bill_once_program ON "InvoiceLine" ("clientProgramId") WHERE "clientProgramId" IS NOT NULL AND NOT "voided";
CREATE UNIQUE INDEX bill_once_subscription ON "InvoiceLine" ("subscriptionId") WHERE "subscriptionId" IS NOT NULL AND NOT "voided";
CREATE UNIQUE INDEX bill_once_surgery ON "InvoiceLine" ("surgeryId") WHERE "surgeryId" IS NOT NULL AND NOT "voided";
-- One commission per (line, source, user) — re-running "paid" side effects can't duplicate it.
CREATE UNIQUE INDEX comm_once ON "CommissionEntry" ("invoiceLineId", "source", "userId") WHERE "invoiceLineId" IS NOT NULL AND "amount" > 0;
