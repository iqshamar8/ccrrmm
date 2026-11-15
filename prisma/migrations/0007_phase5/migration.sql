-- CreateEnum
CREATE TYPE "StockDocType" AS ENUM ('RECEIPT', 'ISSUE', 'TRANSFER', 'WASTE', 'ADJUSTMENT', 'SALE', 'CONSUMPTION', 'RETURN');

-- CreateEnum
CREATE TYPE "PurchaseOrderStatus" AS ENUM ('DRAFT', 'ORDERED', 'PARTIAL', 'RECEIVED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StockCountStatus" AS ENUM ('DRAFT', 'POSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "AccountType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "CashAccountKind" AS ENUM ('CASH', 'BANK');

-- CreateEnum
CREATE TYPE "JournalSource" AS ENUM ('MANUAL', 'OPENING', 'INVOICE', 'INVOICE_CANCEL', 'PAYMENT', 'REFUND', 'STOCK', 'PAYROLL', 'PAYROLL_PAYMENT', 'ADVANCE', 'VOUCHER');

-- CreateEnum
CREATE TYPE "VoucherType" AS ENUM ('RECEIPT', 'PAYMENT');

-- CreateEnum
CREATE TYPE "VoucherStatus" AS ENUM ('POSTED', 'VOID');





-- AlterTable
ALTER TABLE "Invoice" ADD COLUMN     "corporateAgreementId" UUID,
ADD COLUMN     "corporateDiscount" DECIMAL(14,2) NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "cashAccountId" UUID;

-- AlterTable
ALTER TABLE "PayrollRun" ADD COLUMN     "paidFromCashAccountId" UUID;

-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "expiryTracking" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "groupId" UUID,
ADD COLUMN     "isConsumable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isSellable" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "minStock" DECIMAL(14,3) NOT NULL DEFAULT 0,
ADD COLUMN     "trackStock" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "SalaryAdvance" ADD COLUMN     "cashAccountId" UUID;

-- AlterTable
ALTER TABLE "SurgerySupply" ADD COLUMN     "consumed" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "itemId" UUID;

-- AlterTable
ALTER TABLE "TenantSettings" ADD COLUMN     "autoConsumeMaterials" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "blockOnStockShortage" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ItemGroup" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ItemGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Warehouse" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Warehouse_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Supplier" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNo" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Supplier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockLot" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "lotNo" TEXT,
    "expiryDate" DATE,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockDocument" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "StockDocType" NOT NULL,
    "warehouseId" UUID NOT NULL,
    "toWarehouseId" UUID,
    "supplierId" UUID,
    "cashAccountId" UUID,
    "purchaseOrderId" UUID,
    "invoiceId" UUID,
    "appointmentId" UUID,
    "surgeryId" UUID,
    "countId" UUID,
    "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reference" TEXT,
    "notes" TEXT,
    "totalCost" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockMovement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "documentId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "lotId" UUID,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "totalCost" DECIMAL(14,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockMovement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrder" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "supplierId" UUID NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "PurchaseOrderStatus" NOT NULL DEFAULT 'DRAFT',
    "orderDate" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDate" DATE,
    "notes" TEXT,
    "total" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PurchaseOrder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PurchaseOrderLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unitCost" DECIMAL(14,4) NOT NULL,
    "receivedQty" DECIMAL(14,3) NOT NULL DEFAULT 0,

    CONSTRAINT "PurchaseOrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "warehouseId" UUID NOT NULL,
    "status" "StockCountStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "postedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StockCount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StockCountLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "countId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "expectedQty" DECIMAL(14,3) NOT NULL,
    "countedQty" DECIMAL(14,3),

    CONSTRAINT "StockCountLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceMaterial" (
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,

    CONSTRAINT "ServiceMaterial_pkey" PRIMARY KEY ("serviceId","itemId")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "type" "AccountType" NOT NULL,
    "parentId" UUID,
    "isGroup" BOOLEAN NOT NULL DEFAULT false,
    "systemKey" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CashAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "kind" "CashAccountKind" NOT NULL,
    "name" TEXT NOT NULL,
    "branchId" UUID,
    "accountId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "bankName" TEXT,
    "accountNo" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CashAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeRate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "date" DATE NOT NULL,

    CONSTRAINT "ExchangeRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT NOT NULL,
    "source" "JournalSource" NOT NULL,
    "sourceId" UUID,
    "branchId" UUID,
    "reversalOfId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalLine" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "entryId" UUID NOT NULL,
    "accountId" UUID NOT NULL,
    "debit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(16,2) NOT NULL DEFAULT 0,
    "fcCurrency" VARCHAR(3),
    "fcAmount" DECIMAL(16,2),
    "description" TEXT,
    "branchId" UUID,
    "clientId" UUID,
    "supplierId" UUID,

    CONSTRAINT "JournalLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Voucher" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "type" "VoucherType" NOT NULL,
    "status" "VoucherStatus" NOT NULL DEFAULT 'POSTED',
    "date" TIMESTAMP(3) NOT NULL,
    "cashAccountId" UUID NOT NULL,
    "counterAccountId" UUID NOT NULL,
    "amount" DECIMAL(16,2) NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "fcAmount" DECIMAL(16,2) NOT NULL,
    "rate" DECIMAL(18,8) NOT NULL,
    "supplierId" UUID,
    "clientId" UUID,
    "payee" TEXT,
    "description" TEXT NOT NULL,
    "branchId" UUID,
    "journalEntryId" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Voucher_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateAccount" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "contactName" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "taxNo" TEXT,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CorporateAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateAgreement" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "corporateId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "discountPercent" DECIMAL(5,2) NOT NULL,
    "allServices" BOOLEAN NOT NULL DEFAULT true,
    "serviceIds" UUID[],
    "memberTypes" TEXT[],
    "allowCoupons" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateAgreement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorporateMember" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "corporateId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "memberType" TEXT NOT NULL DEFAULT 'EMPLOYEE',
    "employeeNo" TEXT,
    "validUntil" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorporateMember_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ItemGroup_tenantId_idx" ON "ItemGroup"("tenantId");

-- CreateIndex
CREATE INDEX "Warehouse_tenantId_branchId_idx" ON "Warehouse"("tenantId", "branchId");

-- CreateIndex
CREATE UNIQUE INDEX "Warehouse_tenantId_code_key" ON "Warehouse"("tenantId", "code");

-- CreateIndex
CREATE INDEX "Supplier_tenantId_idx" ON "Supplier"("tenantId");

-- CreateIndex
CREATE INDEX "StockLot_tenantId_itemId_warehouseId_idx" ON "StockLot"("tenantId", "itemId", "warehouseId");

-- CreateIndex
CREATE INDEX "StockLot_tenantId_expiryDate_idx" ON "StockLot"("tenantId", "expiryDate");

-- CreateIndex
CREATE INDEX "StockDocument_tenantId_type_date_idx" ON "StockDocument"("tenantId", "type", "date");

-- CreateIndex
CREATE INDEX "StockDocument_invoiceId_idx" ON "StockDocument"("invoiceId");

-- CreateIndex
CREATE UNIQUE INDEX "StockDocument_tenantId_code_key" ON "StockDocument"("tenantId", "code");

-- CreateIndex
CREATE INDEX "StockMovement_tenantId_itemId_createdAt_idx" ON "StockMovement"("tenantId", "itemId", "createdAt");

-- CreateIndex
CREATE INDEX "PurchaseOrder_tenantId_status_idx" ON "PurchaseOrder"("tenantId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "PurchaseOrder_tenantId_code_key" ON "PurchaseOrder"("tenantId", "code");

-- CreateIndex
CREATE INDEX "PurchaseOrderLine_tenantId_orderId_idx" ON "PurchaseOrderLine"("tenantId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "StockCount_tenantId_code_key" ON "StockCount"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "StockCountLine_countId_itemId_key" ON "StockCountLine"("countId", "itemId");

-- CreateIndex
CREATE INDEX "ServiceMaterial_tenantId_idx" ON "ServiceMaterial"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_code_key" ON "Account"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Account_tenantId_systemKey_key" ON "Account"("tenantId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "CashAccount_accountId_key" ON "CashAccount"("accountId");

-- CreateIndex
CREATE INDEX "CashAccount_tenantId_idx" ON "CashAccount"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeRate_tenantId_currency_date_key" ON "ExchangeRate"("tenantId", "currency", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_date_idx" ON "JournalEntry"("tenantId", "date");

-- CreateIndex
CREATE INDEX "JournalEntry_tenantId_source_sourceId_idx" ON "JournalEntry"("tenantId", "source", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "JournalEntry_tenantId_code_key" ON "JournalEntry"("tenantId", "code");

-- CreateIndex
CREATE INDEX "JournalLine_tenantId_accountId_idx" ON "JournalLine"("tenantId", "accountId");

-- CreateIndex
CREATE INDEX "JournalLine_entryId_idx" ON "JournalLine"("entryId");

-- CreateIndex
CREATE INDEX "Voucher_tenantId_type_date_idx" ON "Voucher"("tenantId", "type", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Voucher_tenantId_code_key" ON "Voucher"("tenantId", "code");

-- CreateIndex
CREATE INDEX "CorporateAccount_tenantId_idx" ON "CorporateAccount"("tenantId");

-- CreateIndex
CREATE INDEX "CorporateAgreement_tenantId_corporateId_idx" ON "CorporateAgreement"("tenantId", "corporateId");

-- CreateIndex
CREATE INDEX "CorporateMember_tenantId_clientId_idx" ON "CorporateMember"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "CorporateMember_corporateId_clientId_key" ON "CorporateMember"("corporateId", "clientId");

-- AddForeignKey
ALTER TABLE "Product" ADD CONSTRAINT "Product_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "ItemGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemGroup" ADD CONSTRAINT "ItemGroup_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ItemGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Warehouse" ADD CONSTRAINT "Warehouse_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMovement" ADD CONSTRAINT "StockMovement_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "StockDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT "PurchaseOrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PurchaseOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockCountLine" ADD CONSTRAINT "StockCountLine_countId_fkey" FOREIGN KEY ("countId") REFERENCES "StockCount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT "ServiceMaterial_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "JournalEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalLine" ADD CONSTRAINT "JournalLine_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateAgreement" ADD CONSTRAINT "CorporateAgreement_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "CorporateAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateMember" ADD CONSTRAINT "CorporateMember_corporateId_fkey" FOREIGN KEY ("corporateId") REFERENCES "CorporateAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorporateMember" ADD CONSTRAINT "CorporateMember_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================================
-- Phase 5 — RLS, grants, cross-tenant guards, accounting & stock integrity.
-- =============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ItemGroup','Warehouse','Supplier','StockLot','StockDocument','StockMovement','PurchaseOrder','PurchaseOrderLine',
                           'StockCount','StockCountLine','ServiceMaterial','Account','CashAccount','ExchangeRate','JournalEntry','JournalLine',
                           'Voucher','CorporateAccount','CorporateAgreement','CorporateMember'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_platform', t);
  END LOOP;
END $$;

-- The ledger and the stock ledger are append-only for the app: corrections are new rows.
REVOKE UPDATE, DELETE ON "JournalEntry", "JournalLine", "StockMovement" FROM crm_app;

-- Cross-tenant reference guards (new tables + new columns on existing ones)
CREATE TRIGGER itemgroup_tenant_guard BEFORE INSERT OR UPDATE ON "ItemGroup" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('parentId','ItemGroup');
CREATE TRIGGER wh_tenant_guard BEFORE INSERT OR UPDATE ON "Warehouse" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('branchId','Branch');
CREATE TRIGGER lot_tenant_guard BEFORE INSERT OR UPDATE ON "StockLot" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('itemId','Product', 'warehouseId','Warehouse');
CREATE TRIGGER sdoc_tenant_guard BEFORE INSERT OR UPDATE ON "StockDocument" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs(
  'warehouseId','Warehouse', 'toWarehouseId','Warehouse', 'supplierId','Supplier', 'cashAccountId','CashAccount', 'purchaseOrderId','PurchaseOrder',
  'invoiceId','Invoice', 'appointmentId','Appointment', 'surgeryId','Surgery', 'countId','StockCount');
CREATE TRIGGER smov_tenant_guard BEFORE INSERT ON "StockMovement" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs(
  'documentId','StockDocument', 'itemId','Product', 'warehouseId','Warehouse', 'lotId','StockLot');
CREATE TRIGGER po_tenant_guard BEFORE INSERT OR UPDATE ON "PurchaseOrder" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('supplierId','Supplier', 'warehouseId','Warehouse');
CREATE TRIGGER pol_tenant_guard BEFORE INSERT OR UPDATE ON "PurchaseOrderLine" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('orderId','PurchaseOrder', 'itemId','Product');
CREATE TRIGGER cnt_tenant_guard BEFORE INSERT OR UPDATE ON "StockCount" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('warehouseId','Warehouse');
CREATE TRIGGER cntl_tenant_guard BEFORE INSERT OR UPDATE ON "StockCountLine" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('countId','StockCount', 'itemId','Product');
CREATE TRIGGER smat_tenant_guard BEFORE INSERT OR UPDATE ON "ServiceMaterial" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('serviceId','Service', 'itemId','Product');
CREATE TRIGGER acc_tenant_guard BEFORE INSERT OR UPDATE ON "Account" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('parentId','Account');
CREATE TRIGGER cash_tenant_guard BEFORE INSERT OR UPDATE ON "CashAccount" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('branchId','Branch', 'accountId','Account');
CREATE TRIGGER je_tenant_guard BEFORE INSERT ON "JournalEntry" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('branchId','Branch', 'reversalOfId','JournalEntry');
CREATE TRIGGER jl_tenant_guard BEFORE INSERT ON "JournalLine" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs(
  'entryId','JournalEntry', 'accountId','Account', 'branchId','Branch', 'clientId','Client', 'supplierId','Supplier');
CREATE TRIGGER vch_tenant_guard BEFORE INSERT OR UPDATE ON "Voucher" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs(
  'cashAccountId','CashAccount', 'counterAccountId','Account', 'supplierId','Supplier', 'clientId','Client', 'branchId','Branch', 'journalEntryId','JournalEntry');
CREATE TRIGGER cagr_tenant_guard BEFORE INSERT OR UPDATE ON "CorporateAgreement" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('corporateId','CorporateAccount');
CREATE TRIGGER cmem_tenant_guard BEFORE INSERT OR UPDATE ON "CorporateMember" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('corporateId','CorporateAccount', 'clientId','Client');
CREATE TRIGGER product_tenant_guard BEFORE INSERT OR UPDATE ON "Product" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('groupId','ItemGroup');
DROP TRIGGER IF EXISTS invoice_tenant_guard ON "Invoice";
CREATE TRIGGER invoice_tenant_guard BEFORE INSERT OR UPDATE ON "Invoice" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'branchId','Branch', 'couponId','Coupon', 'salesStaffId','User', 'corporateAgreementId','CorporateAgreement');
DROP TRIGGER IF EXISTS payment_tenant_guard ON "Payment";
CREATE TRIGGER payment_tenant_guard BEFORE INSERT OR UPDATE ON "Payment" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('invoiceId','Invoice', 'receivedById','User', 'cashAccountId','CashAccount');
DROP TRIGGER IF EXISTS ssupply_tenant_guard ON "SurgerySupply";
CREATE TRIGGER ssupply_tenant_guard BEFORE INSERT OR UPDATE ON "SurgerySupply" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('surgeryId','Surgery', 'itemId','Product');
DROP TRIGGER IF EXISTS adv_tenant_guard ON "SalaryAdvance";
CREATE TRIGGER adv_tenant_guard BEFORE INSERT OR UPDATE ON "SalaryAdvance" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('userId','User', 'payrollRunId','PayrollRun', 'cashAccountId','CashAccount');

-- ------------------------------------------------------ stock integrity ----
ALTER TABLE "StockLot" ADD CONSTRAINT lot_no_negative CHECK ("quantity" >= 0 AND "unitCost" >= 0);
ALTER TABLE "PurchaseOrderLine" ADD CONSTRAINT pol_qty CHECK ("quantity" > 0 AND "receivedQty" >= 0 AND "unitCost" >= 0);
ALTER TABLE "ServiceMaterial" ADD CONSTRAINT smat_qty CHECK ("quantity" > 0);
-- one default warehouse per branch
CREATE UNIQUE INDEX wh_one_default ON "Warehouse" ("branchId") WHERE "isDefault";

-- ------------------------------------------------- accounting integrity ----
ALTER TABLE "JournalLine" ADD CONSTRAINT jl_amounts CHECK ("debit" >= 0 AND "credit" >= 0 AND ("debit" = 0 OR "credit" = 0) AND ("debit" + "credit") > 0);
ALTER TABLE "Voucher" ADD CONSTRAINT vch_amount CHECK ("amount" > 0 AND "fcAmount" > 0 AND "rate" > 0);
ALTER TABLE "ExchangeRate" ADD CONSTRAINT fx_rate CHECK ("rate" > 0);
ALTER TABLE "CorporateAgreement" ADD CONSTRAINT cagr_pct CHECK ("discountPercent" > 0 AND "discountPercent" <= 100 AND "endDate" >= "startDate");

-- Every journal entry must balance. Checked at COMMIT (deferred), so a
-- multi-line entry can be inserted line by line inside one transaction.
CREATE OR REPLACE FUNCTION trg_journal_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d numeric; c numeric; eid uuid := NEW."entryId";
BEGIN
  SELECT COALESCE(SUM(debit), 0), COALESCE(SUM(credit), 0) INTO d, c FROM "JournalLine" WHERE "entryId" = eid;
  IF d <> c THEN
    RAISE EXCEPTION 'unbalanced journal entry % (debit % <> credit %)', eid, d, c USING ERRCODE = '23514';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER journal_balanced AFTER INSERT ON "JournalLine"
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION trg_journal_balanced();
