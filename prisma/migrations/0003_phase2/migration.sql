-- CreateEnum
CREATE TYPE "ClientStatus" AS ENUM ('LEAD', 'ACTIVE', 'INACTIVE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "InteractionType" AS ENUM ('NOTE', 'CALL', 'WHATSAPP', 'EMAIL', 'VISIT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "MedicalEntryType" AS ENUM ('DIAGNOSIS', 'NOTE', 'TREATMENT_PLAN', 'FOLLOW_UP_RESULT');

-- CreateEnum
CREATE TYPE "FileCategory" AS ENUM ('CLIENT_PHOTO', 'MEDICAL_BEFORE', 'MEDICAL_AFTER', 'MEDICAL_DOCUMENT');

-- CreateEnum
CREATE TYPE "ServiceKind" AS ENUM ('CONSULTATION', 'MEDICAL', 'COSMETIC', 'LASER', 'DENTAL', 'SURGERY', 'FOLLOW_UP', 'OTHER');

-- CreateEnum
CREATE TYPE "CommissionType" AS ENUM ('NONE', 'PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "AppointmentStatus" AS ENUM ('SCHEDULED', 'CONFIRMED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('WAITING', 'BOOKED', 'REMOVED');

-- CreateTable
CREATE TABLE "TenantCounter" (
    "tenantId" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TenantCounter_pkey" PRIMARY KEY ("tenantId","key")
);

-- CreateTable
CREATE TABLE "Client" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "phoneNormalized" TEXT NOT NULL,
    "email" TEXT,
    "gender" "Gender",
    "birthDate" DATE,
    "address" TEXT,
    "source" TEXT,
    "sourceDetail" TEXT,
    "status" "ClientStatus" NOT NULL DEFAULT 'ACTIVE',
    "category" TEXT,
    "tags" TEXT[],
    "notes" TEXT,
    "branchId" UUID NOT NULL,
    "ownerId" UUID,
    "photoFileId" UUID,
    "lastVisitAt" TIMESTAMP(3),
    "convertedAt" TIMESTAMP(3),
    "deletedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientInteraction" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "type" "InteractionType" NOT NULL,
    "content" TEXT NOT NULL,
    "userId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientInteraction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalRecord" (
    "clientId" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "bloodType" TEXT,
    "allergies" TEXT,
    "currentMedications" TEXT,
    "chronicConditions" TEXT,
    "pastSurgeries" TEXT,
    "medicalHistory" TEXT,
    "familyHistory" TEXT,
    "notes" TEXT,
    "updatedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalRecord_pkey" PRIMARY KEY ("clientId")
);

-- CreateTable
CREATE TABLE "MedicalEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "type" "MedicalEntryType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "appointmentId" UUID,
    "authorId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FileObject" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID,
    "category" "FileCategory" NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storageKey" TEXT NOT NULL,
    "note" TEXT,
    "uploadedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FileObject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceCategory" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "parentId" UUID,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ServiceCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Service" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "categoryId" UUID,
    "code" TEXT,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "kind" "ServiceKind" NOT NULL DEFAULT 'OTHER',
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "cost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "durationMin" INTEGER NOT NULL DEFAULT 30,
    "execCommissionType" "CommissionType" NOT NULL DEFAULT 'NONE',
    "execCommissionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "marketingCommissionType" "CommissionType" NOT NULL DEFAULT 'NONE',
    "marketingCommissionValue" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "color" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Service_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ServiceStaff" (
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "userId" UUID NOT NULL,

    CONSTRAINT "ServiceStaff_pkey" PRIMARY KEY ("serviceId","userId")
);

-- CreateTable
CREATE TABLE "ServiceBranchPrice" (
    "tenantId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ServiceBranchPrice_pkey" PRIMARY KEY ("serviceId","branchId")
);

-- CreateTable
CREATE TABLE "Room" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'TREATMENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Room_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Appointment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "serviceId" UUID,
    "staffId" UUID,
    "roomId" UUID,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "status" "AppointmentStatus" NOT NULL DEFAULT 'SCHEDULED',
    "price" DECIMAL(12,2),
    "notes" TEXT,
    "cancelReason" TEXT,
    "bookingSource" TEXT,
    "recurrenceGroupId" UUID,
    "confirmedAt" TIMESTAMP(3),
    "checkedInAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WaitlistEntry" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "serviceId" UUID,
    "staffId" UUID,
    "preferredDate" DATE,
    "preferredTime" TEXT,
    "notes" TEXT,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'WAITING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WaitlistEntry_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Client_tenantId_status_idx" ON "Client"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Client_tenantId_branchId_idx" ON "Client"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "Client_tenantId_phoneNormalized_idx" ON "Client"("tenantId", "phoneNormalized");

-- CreateIndex
CREATE INDEX "Client_tenantId_createdAt_idx" ON "Client"("tenantId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Client_tenantId_code_key" ON "Client"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ClientInteraction_tenantId_clientId_createdAt_idx" ON "ClientInteraction"("tenantId", "clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "MedicalRecord_tenantId_idx" ON "MedicalRecord"("tenantId");

-- CreateIndex
CREATE INDEX "MedicalEntry_tenantId_clientId_createdAt_idx" ON "MedicalEntry"("tenantId", "clientId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "FileObject_tenantId_clientId_idx" ON "FileObject"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "ServiceCategory_tenantId_parentId_idx" ON "ServiceCategory"("tenantId", "parentId");

-- CreateIndex
CREATE INDEX "Service_tenantId_categoryId_idx" ON "Service"("tenantId", "categoryId");

-- CreateIndex
CREATE INDEX "Service_tenantId_isActive_idx" ON "Service"("tenantId", "isActive");

-- CreateIndex
CREATE INDEX "ServiceStaff_tenantId_idx" ON "ServiceStaff"("tenantId");

-- CreateIndex
CREATE INDEX "ServiceBranchPrice_tenantId_idx" ON "ServiceBranchPrice"("tenantId");

-- CreateIndex
CREATE INDEX "Room_tenantId_branchId_idx" ON "Room"("tenantId", "branchId");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_startsAt_idx" ON "Appointment"("tenantId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_staffId_startsAt_idx" ON "Appointment"("tenantId", "staffId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_roomId_startsAt_idx" ON "Appointment"("tenantId", "roomId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_clientId_startsAt_idx" ON "Appointment"("tenantId", "clientId", "startsAt");

-- CreateIndex
CREATE INDEX "Appointment_tenantId_status_startsAt_idx" ON "Appointment"("tenantId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "WaitlistEntry_tenantId_status_idx" ON "WaitlistEntry"("tenantId", "status");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInteraction" ADD CONSTRAINT "ClientInteraction_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientInteraction" ADD CONSTRAINT "ClientInteraction_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalRecord" ADD CONSTRAINT "MedicalRecord_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalEntry" ADD CONSTRAINT "MedicalEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalEntry" ADD CONSTRAINT "MedicalEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceCategory" ADD CONSTRAINT "ServiceCategory_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ServiceCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Service" ADD CONSTRAINT "Service_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "ServiceCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStaff" ADD CONSTRAINT "ServiceStaff_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceStaff" ADD CONSTRAINT "ServiceStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBranchPrice" ADD CONSTRAINT "ServiceBranchPrice_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ServiceBranchPrice" ADD CONSTRAINT "ServiceBranchPrice_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Room" ADD CONSTRAINT "Room_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WaitlistEntry" ADD CONSTRAINT "WaitlistEntry_staffId_fkey" FOREIGN KEY ("staffId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- Phase 2 — isolation, integrity and search (hand-written, appended to the
-- Prisma-generated DDL above).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ---------------------------------------------------------------- RLS ----
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['TenantCounter','Client','ClientInteraction','MedicalRecord','MedicalEntry','FileObject',
                           'ServiceCategory','Service','ServiceStaff','ServiceBranchPrice','Room','Appointment','WaitlistEntry'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_platform', t);
  END LOOP;
END $$;

-- ------------------------------------------- cross-tenant FK guard ----
-- RLS hides foreign rows, but a FK check runs with owner rights. These
-- triggers make sure a row can only reference parents of the SAME tenant
-- (e.g. an appointment can't point to another tenant's client or room).
CREATE OR REPLACE FUNCTION app_same_tenant(child_tenant uuid, parent_table text, parent_id uuid) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE pt uuid;
BEGIN
  IF parent_id IS NULL THEN RETURN; END IF;
  EXECUTE format('SELECT "tenantId" FROM %I WHERE id = $1', parent_table) INTO pt USING parent_id;
  IF pt IS DISTINCT FROM child_tenant THEN
    RAISE EXCEPTION 'cross-tenant reference to % %', parent_table, parent_id USING ERRCODE = '42501';
  END IF;
END $$;
REVOKE ALL ON FUNCTION app_same_tenant(uuid, text, uuid) FROM PUBLIC;

CREATE OR REPLACE FUNCTION trg_appointment_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_same_tenant(NEW."tenantId", 'Client', NEW."clientId");
  PERFORM app_same_tenant(NEW."tenantId", 'Branch', NEW."branchId");
  PERFORM app_same_tenant(NEW."tenantId", 'Service', NEW."serviceId");
  PERFORM app_same_tenant(NEW."tenantId", 'Room', NEW."roomId");
  PERFORM app_same_tenant(NEW."tenantId", 'User', NEW."staffId");
  RETURN NEW;
END $$;
CREATE TRIGGER appointment_tenant_guard BEFORE INSERT OR UPDATE ON "Appointment"
  FOR EACH ROW EXECUTE FUNCTION trg_appointment_tenant();

CREATE OR REPLACE FUNCTION trg_client_child_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_same_tenant(NEW."tenantId", 'Client', NEW."clientId");
  RETURN NEW;
END $$;
CREATE TRIGGER interaction_tenant_guard BEFORE INSERT OR UPDATE ON "ClientInteraction" FOR EACH ROW EXECUTE FUNCTION trg_client_child_tenant();
CREATE TRIGGER medrec_tenant_guard BEFORE INSERT OR UPDATE ON "MedicalRecord" FOR EACH ROW EXECUTE FUNCTION trg_client_child_tenant();
CREATE TRIGGER medentry_tenant_guard BEFORE INSERT OR UPDATE ON "MedicalEntry" FOR EACH ROW EXECUTE FUNCTION trg_client_child_tenant();
CREATE TRIGGER file_tenant_guard BEFORE INSERT OR UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION trg_client_child_tenant();
CREATE TRIGGER waitlist_tenant_guard BEFORE INSERT OR UPDATE ON "WaitlistEntry" FOR EACH ROW EXECUTE FUNCTION trg_client_child_tenant();

CREATE OR REPLACE FUNCTION trg_client_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_same_tenant(NEW."tenantId", 'Branch', NEW."branchId");
  PERFORM app_same_tenant(NEW."tenantId", 'User', NEW."ownerId");
  RETURN NEW;
END $$;
CREATE TRIGGER client_tenant_guard BEFORE INSERT OR UPDATE ON "Client" FOR EACH ROW EXECUTE FUNCTION trg_client_tenant();

CREATE OR REPLACE FUNCTION trg_service_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_same_tenant(NEW."tenantId", 'ServiceCategory', NEW."categoryId");
  RETURN NEW;
END $$;
CREATE TRIGGER service_tenant_guard BEFORE INSERT OR UPDATE ON "Service" FOR EACH ROW EXECUTE FUNCTION trg_service_tenant();

CREATE OR REPLACE FUNCTION trg_category_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_same_tenant(NEW."tenantId", 'ServiceCategory', NEW."parentId");
  RETURN NEW;
END $$;
CREATE TRIGGER category_tenant_guard BEFORE INSERT OR UPDATE ON "ServiceCategory" FOR EACH ROW EXECUTE FUNCTION trg_category_tenant();

CREATE OR REPLACE FUNCTION trg_room_tenant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM app_same_tenant(NEW."tenantId", 'Branch', NEW."branchId");
  RETURN NEW;
END $$;
CREATE TRIGGER room_tenant_guard BEFORE INSERT OR UPDATE ON "Room" FOR EACH ROW EXECUTE FUNCTION trg_room_tenant();

-- ------------------------------------------------ booking integrity ----
ALTER TABLE "Appointment" ADD CONSTRAINT appt_time_order CHECK ("endsAt" > "startsAt");
ALTER TABLE "Appointment" ADD CONSTRAINT appt_no_staff_overlap EXCLUDE USING gist (
  "tenantId" WITH =, "staffId" WITH =, tsrange("startsAt", "endsAt") WITH &&
) WHERE ("staffId" IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW'));
ALTER TABLE "Appointment" ADD CONSTRAINT appt_no_room_overlap EXCLUDE USING gist (
  "tenantId" WITH =, "roomId" WITH =, tsrange("startsAt", "endsAt") WITH &&
) WHERE ("roomId" IS NOT NULL AND status NOT IN ('CANCELLED', 'NO_SHOW'));

-- ------------------------------------------------- clients: dedupe/search ----
-- One live client per phone per tenant (soft-deleted rows don't count).
CREATE UNIQUE INDEX client_phone_unique ON "Client" ("tenantId", "phoneNormalized") WHERE "deletedAt" IS NULL;
CREATE INDEX client_name_trgm ON "Client" USING gin ("fullName" gin_trgm_ops);
CREATE INDEX client_phone_trgm ON "Client" USING gin ("phoneNormalized" gin_trgm_ops);
CREATE INDEX client_tags_gin ON "Client" USING gin ("tags");
