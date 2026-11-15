-- CreateEnum
CREATE TYPE "ProgramStatus" AS ENUM ('ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SubscriptionKind" AS ENUM ('TIME', 'VISITS', 'SESSIONS');

-- CreateEnum
CREATE TYPE "ClientSubscriptionStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "SurgeryStatus" AS ENUM ('PLANNED', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'POSTPONED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecoveryStatus" AS ENUM ('NOT_STARTED', 'STABLE', 'NEEDS_ATTENTION', 'COMPLICATED', 'RECOVERED');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED');

-- (Prisma wanted to drop the hand-made pg_trgm / GIN indexes from 0003 — intentionally kept.)

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "programItemId" UUID,
ADD COLUMN     "subscriptionId" UUID;

-- AlterTable
ALTER TABLE "FileObject" ADD COLUMN     "reviewId" UUID,
ADD COLUMN     "surgeryId" UUID;

-- CreateTable
CREATE TABLE "ProgramTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "validityDays" INTEGER,
    "intervalDays" INTEGER,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProgramTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramTemplateItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "templateId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "sessions" INTEGER NOT NULL,

    CONSTRAINT "ProgramTemplateItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProgram" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "templateId" UUID,
    "doctorId" UUID,
    "name" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "status" "ProgramStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "endDate" DATE,
    "intervalDays" INTEGER,
    "notes" TEXT,
    "results" TEXT,
    "renewedFromId" UUID,
    "pausedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientProgram_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientProgramItem" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientProgramId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,
    "sessionsTotal" INTEGER NOT NULL,

    CONSTRAINT "ClientProgramItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProgramSession" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientProgramId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "appointmentId" UUID,
    "sessionNo" INTEGER NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL,
    "performedById" UUID,
    "notes" TEXT,
    "result" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProgramSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlan" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "nameEn" TEXT,
    "description" TEXT,
    "kind" "SubscriptionKind" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "durationDays" INTEGER NOT NULL,
    "visitsLimit" INTEGER,
    "maxFreezeDays" INTEGER NOT NULL DEFAULT 0,
    "allServices" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SubscriptionPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionPlanService" (
    "tenantId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "serviceId" UUID NOT NULL,

    CONSTRAINT "SubscriptionPlanService_pkey" PRIMARY KEY ("planId","serviceId")
);

-- CreateTable
CREATE TABLE "ClientSubscription" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "planId" UUID,
    "name" TEXT NOT NULL,
    "kind" "SubscriptionKind" NOT NULL,
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "visitsTotal" INTEGER,
    "allServices" BOOLEAN NOT NULL DEFAULT true,
    "coveredServiceIds" UUID[],
    "status" "ClientSubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "frozenAt" TIMESTAMP(3),
    "frozenDaysUsed" INTEGER NOT NULL DEFAULT 0,
    "maxFreezeDays" INTEGER NOT NULL DEFAULT 0,
    "renewedFromId" UUID,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientSubscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubscriptionUsage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "subscriptionId" UUID NOT NULL,
    "appointmentId" UUID,
    "serviceId" UUID,
    "usedAt" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "recordedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Surgery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "clientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "serviceId" UUID,
    "surgeryType" TEXT NOT NULL,
    "surgeonId" UUID,
    "roomId" UUID,
    "appointmentId" UUID,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL,
    "status" "SurgeryStatus" NOT NULL DEFAULT 'PLANNED',
    "price" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "anesthesiaType" TEXT,
    "preOpNotes" TEXT,
    "postOpNotes" TEXT,
    "operativeReport" TEXT,
    "complications" TEXT,
    "recoveryStatus" "RecoveryStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Surgery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SurgeryTeamMember" (
    "tenantId" UUID NOT NULL,
    "surgeryId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "role" TEXT NOT NULL,

    CONSTRAINT "SurgeryTeamMember_pkey" PRIMARY KEY ("surgeryId","userId")
);

-- CreateTable
CREATE TABLE "SurgerySupply" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "surgeryId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "quantity" DECIMAL(12,3) NOT NULL,
    "unitCost" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SurgerySupply_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MedicalReview" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "clientId" UUID NOT NULL,
    "branchId" UUID NOT NULL,
    "doctorId" UUID,
    "surgeryId" UUID,
    "clientProgramId" UUID,
    "previousReviewId" UUID,
    "appointmentId" UUID,
    "reasonType" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "scheduledAt" TIMESTAMP(3) NOT NULL,
    "durationMin" INTEGER NOT NULL DEFAULT 20,
    "status" "ReviewStatus" NOT NULL DEFAULT 'SCHEDULED',
    "diagnosis" TEXT,
    "notes" TEXT,
    "procedures" TEXT,
    "outcome" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MedicalReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProgramTemplate_tenantId_idx" ON "ProgramTemplate"("tenantId");

-- CreateIndex
CREATE INDEX "ProgramTemplateItem_tenantId_templateId_idx" ON "ProgramTemplateItem"("tenantId", "templateId");

-- CreateIndex
CREATE INDEX "ClientProgram_tenantId_status_idx" ON "ClientProgram"("tenantId", "status");

-- CreateIndex
CREATE INDEX "ClientProgram_tenantId_clientId_idx" ON "ClientProgram"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientProgram_tenantId_code_key" ON "ClientProgram"("tenantId", "code");

-- CreateIndex
CREATE INDEX "ClientProgramItem_tenantId_clientProgramId_idx" ON "ClientProgramItem"("tenantId", "clientProgramId");

-- CreateIndex
CREATE UNIQUE INDEX "ProgramSession_appointmentId_key" ON "ProgramSession"("appointmentId");

-- CreateIndex
CREATE INDEX "ProgramSession_tenantId_clientProgramId_idx" ON "ProgramSession"("tenantId", "clientProgramId");

-- CreateIndex
CREATE INDEX "SubscriptionPlan_tenantId_idx" ON "SubscriptionPlan"("tenantId");

-- CreateIndex
CREATE INDEX "SubscriptionPlanService_tenantId_idx" ON "SubscriptionPlanService"("tenantId");

-- CreateIndex
CREATE INDEX "ClientSubscription_tenantId_status_endDate_idx" ON "ClientSubscription"("tenantId", "status", "endDate");

-- CreateIndex
CREATE INDEX "ClientSubscription_tenantId_clientId_idx" ON "ClientSubscription"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "ClientSubscription_tenantId_code_key" ON "ClientSubscription"("tenantId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "SubscriptionUsage_appointmentId_key" ON "SubscriptionUsage"("appointmentId");

-- CreateIndex
CREATE INDEX "SubscriptionUsage_tenantId_subscriptionId_idx" ON "SubscriptionUsage"("tenantId", "subscriptionId");

-- CreateIndex
CREATE UNIQUE INDEX "Surgery_appointmentId_key" ON "Surgery"("appointmentId");

-- CreateIndex
CREATE INDEX "Surgery_tenantId_scheduledAt_idx" ON "Surgery"("tenantId", "scheduledAt");

-- CreateIndex
CREATE INDEX "Surgery_tenantId_status_idx" ON "Surgery"("tenantId", "status");

-- CreateIndex
CREATE INDEX "Surgery_tenantId_clientId_idx" ON "Surgery"("tenantId", "clientId");

-- CreateIndex
CREATE UNIQUE INDEX "Surgery_tenantId_code_key" ON "Surgery"("tenantId", "code");

-- CreateIndex
CREATE INDEX "SurgeryTeamMember_tenantId_idx" ON "SurgeryTeamMember"("tenantId");

-- CreateIndex
CREATE INDEX "SurgerySupply_tenantId_surgeryId_idx" ON "SurgerySupply"("tenantId", "surgeryId");

-- CreateIndex
CREATE UNIQUE INDEX "MedicalReview_appointmentId_key" ON "MedicalReview"("appointmentId");

-- CreateIndex
CREATE INDEX "MedicalReview_tenantId_status_scheduledAt_idx" ON "MedicalReview"("tenantId", "status", "scheduledAt");

-- CreateIndex
CREATE INDEX "MedicalReview_tenantId_clientId_idx" ON "MedicalReview"("tenantId", "clientId");

-- CreateIndex
CREATE INDEX "MedicalReview_surgeryId_idx" ON "MedicalReview"("surgeryId");

-- CreateIndex
CREATE INDEX "Appointment_programItemId_idx" ON "Appointment"("programItemId");

-- CreateIndex
CREATE INDEX "Appointment_subscriptionId_idx" ON "Appointment"("subscriptionId");

-- CreateIndex
CREATE INDEX "FileObject_surgeryId_idx" ON "FileObject"("surgeryId");

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FileObject" ADD CONSTRAINT "FileObject_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "MedicalReview"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_programItemId_fkey" FOREIGN KEY ("programItemId") REFERENCES "ClientProgramItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTemplateItem" ADD CONSTRAINT "ProgramTemplateItem_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProgramTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramTemplateItem" ADD CONSTRAINT "ProgramTemplateItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "ProgramTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgram" ADD CONSTRAINT "ClientProgram_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgramItem" ADD CONSTRAINT "ClientProgramItem_clientProgramId_fkey" FOREIGN KEY ("clientProgramId") REFERENCES "ClientProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientProgramItem" ADD CONSTRAINT "ClientProgramItem_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSession" ADD CONSTRAINT "ProgramSession_clientProgramId_fkey" FOREIGN KEY ("clientProgramId") REFERENCES "ClientProgram"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSession" ADD CONSTRAINT "ProgramSession_itemId_fkey" FOREIGN KEY ("itemId") REFERENCES "ClientProgramItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProgramSession" ADD CONSTRAINT "ProgramSession_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanService" ADD CONSTRAINT "SubscriptionPlanService_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPlanService" ADD CONSTRAINT "SubscriptionPlanService_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientSubscription" ADD CONSTRAINT "ClientSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "SubscriptionPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionUsage" ADD CONSTRAINT "SubscriptionUsage_subscriptionId_fkey" FOREIGN KEY ("subscriptionId") REFERENCES "ClientSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionUsage" ADD CONSTRAINT "SubscriptionUsage_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_serviceId_fkey" FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_surgeonId_fkey" FOREIGN KEY ("surgeonId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Surgery" ADD CONSTRAINT "Surgery_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryTeamMember" ADD CONSTRAINT "SurgeryTeamMember_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgeryTeamMember" ADD CONSTRAINT "SurgeryTeamMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SurgerySupply" ADD CONSTRAINT "SurgerySupply_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalReview" ADD CONSTRAINT "MedicalReview_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalReview" ADD CONSTRAINT "MedicalReview_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalReview" ADD CONSTRAINT "MedicalReview_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalReview" ADD CONSTRAINT "MedicalReview_surgeryId_fkey" FOREIGN KEY ("surgeryId") REFERENCES "Surgery"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalReview" ADD CONSTRAINT "MedicalReview_clientProgramId_fkey" FOREIGN KEY ("clientProgramId") REFERENCES "ClientProgram"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MedicalReview" ADD CONSTRAINT "MedicalReview_appointmentId_fkey" FOREIGN KEY ("appointmentId") REFERENCES "Appointment"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- Phase 3 — RLS, grants, cross-tenant reference guards, integrity checks.
-- =============================================================================

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['ProgramTemplate','ProgramTemplateItem','ClientProgram','ClientProgramItem','ProgramSession',
                           'SubscriptionPlan','SubscriptionPlanService','ClientSubscription','SubscriptionUsage',
                           'Surgery','SurgeryTeamMember','SurgerySupply','MedicalReview'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_platform', t);
  END LOOP;
END $$;

-- Generic guard: TG_ARGV = pairs of (column, parent table). Every non-null
-- reference must point at a parent row of the SAME tenant.
CREATE OR REPLACE FUNCTION trg_tenant_refs() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE i int := 0; v uuid;
BEGIN
  WHILE i < TG_NARGS LOOP
    EXECUTE format('SELECT ($1).%I::uuid', TG_ARGV[i]) INTO v USING NEW;
    PERFORM app_same_tenant(NEW."tenantId", TG_ARGV[i + 1], v);
    i := i + 2;
  END LOOP;
  RETURN NEW;
END $$;

-- Appointment now also references program items & subscriptions: replace its guard.
DROP TRIGGER IF EXISTS appointment_tenant_guard ON "Appointment";
CREATE TRIGGER appointment_tenant_guard BEFORE INSERT OR UPDATE ON "Appointment" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs(
  'clientId','Client', 'branchId','Branch', 'serviceId','Service', 'roomId','Room', 'staffId','User',
  'programItemId','ClientProgramItem', 'subscriptionId','ClientSubscription');

DROP TRIGGER IF EXISTS file_tenant_guard ON "FileObject";
CREATE TRIGGER file_tenant_guard BEFORE INSERT OR UPDATE ON "FileObject" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs(
  'clientId','Client', 'surgeryId','Surgery', 'reviewId','MedicalReview');

CREATE TRIGGER tpl_item_tenant_guard BEFORE INSERT OR UPDATE ON "ProgramTemplateItem" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('templateId','ProgramTemplate', 'serviceId','Service');
CREATE TRIGGER cprog_tenant_guard BEFORE INSERT OR UPDATE ON "ClientProgram" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'branchId','Branch', 'templateId','ProgramTemplate', 'doctorId','User');
CREATE TRIGGER cprog_item_tenant_guard BEFORE INSERT OR UPDATE ON "ClientProgramItem" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientProgramId','ClientProgram', 'serviceId','Service');
CREATE TRIGGER psession_tenant_guard BEFORE INSERT OR UPDATE ON "ProgramSession" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientProgramId','ClientProgram', 'itemId','ClientProgramItem', 'appointmentId','Appointment', 'performedById','User');
CREATE TRIGGER planservice_tenant_guard BEFORE INSERT OR UPDATE ON "SubscriptionPlanService" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('planId','SubscriptionPlan', 'serviceId','Service');
CREATE TRIGGER csub_tenant_guard BEFORE INSERT OR UPDATE ON "ClientSubscription" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'branchId','Branch', 'planId','SubscriptionPlan');
CREATE TRIGGER usage_tenant_guard BEFORE INSERT OR UPDATE ON "SubscriptionUsage" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('subscriptionId','ClientSubscription', 'appointmentId','Appointment', 'serviceId','Service');
CREATE TRIGGER surgery_tenant_guard BEFORE INSERT OR UPDATE ON "Surgery" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'branchId','Branch', 'serviceId','Service', 'surgeonId','User', 'roomId','Room', 'appointmentId','Appointment');
CREATE TRIGGER steam_tenant_guard BEFORE INSERT OR UPDATE ON "SurgeryTeamMember" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('surgeryId','Surgery', 'userId','User');
CREATE TRIGGER ssupply_tenant_guard BEFORE INSERT OR UPDATE ON "SurgerySupply" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('surgeryId','Surgery');
CREATE TRIGGER review_tenant_guard BEFORE INSERT OR UPDATE ON "MedicalReview" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'branchId','Branch', 'doctorId','User', 'surgeryId','Surgery',
                                   'clientProgramId','ClientProgram', 'previousReviewId','MedicalReview', 'appointmentId','Appointment');

-- Integrity
ALTER TABLE "ProgramTemplateItem" ADD CONSTRAINT tpl_item_sessions_pos CHECK ("sessions" > 0);
ALTER TABLE "ClientProgramItem" ADD CONSTRAINT cprog_item_sessions_pos CHECK ("sessionsTotal" > 0);
ALTER TABLE "ClientSubscription" ADD CONSTRAINT csub_dates CHECK ("endDate" >= "startDate");
ALTER TABLE "ClientSubscription" ADD CONSTRAINT csub_visits_pos CHECK ("visitsTotal" IS NULL OR "visitsTotal" > 0);
ALTER TABLE "ClientProgram" ADD CONSTRAINT cprog_dates CHECK ("endDate" IS NULL OR "endDate" >= "startDate");
-- One session number per program item (no double-count of a session)
CREATE UNIQUE INDEX psession_item_no ON "ProgramSession" ("itemId", "sessionNo");
