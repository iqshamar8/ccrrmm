-- CreateEnum
CREATE TYPE "MessageChannel" AS ENUM ('WHATSAPP', 'SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENDING', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MessageCategory" AS ENUM ('APPOINTMENT_CONFIRM', 'APPOINTMENT_REMINDER', 'PAYMENT_REMINDER', 'SUBSCRIPTION_EXPIRY', 'SESSION_REMINDER', 'FOLLOW_UP', 'BIRTHDAY', 'PROMOTION', 'REACTIVATION', 'CUSTOM');

-- CreateEnum
CREATE TYPE "MessagingProvider" AS ENUM ('DISABLED', 'SANDBOX', 'WHATSAPP_CLOUD');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENDING', 'SENT', 'CANCELLED');

-- AlterEnum
ALTER TYPE "JournalSource" ADD VALUE 'INFLUENCER';





-- AlterTable
ALTER TABLE "Client" ADD COLUMN     "campaignId" UUID,
ADD COLUMN     "influencerId" UUID,
ADD COLUMN     "marketingOptOut" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Coupon" ADD COLUMN     "influencerId" UUID;

-- CreateTable
CREATE TABLE "MessagingSettings" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "provider" "MessagingProvider" NOT NULL DEFAULT 'SANDBOX',
    "phoneNumberId" TEXT,
    "wabaId" TEXT,
    "accessTokenEnc" TEXT,
    "appSecretEnc" TEXT,
    "verifyToken" TEXT,
    "defaultCountryCode" TEXT NOT NULL DEFAULT '964',
    "quietStartHour" INTEGER NOT NULL DEFAULT 22,
    "quietEndHour" INTEGER NOT NULL DEFAULT 9,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessagingSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageTemplate" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "category" "MessageCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP',
    "language" TEXT NOT NULL DEFAULT 'ar',
    "body" TEXT NOT NULL,
    "waTemplateName" TEXT,
    "waLanguage" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MessageTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP',
    "category" "MessageCategory" NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "toPhone" TEXT NOT NULL,
    "clientId" UUID,
    "templateId" UUID,
    "campaignId" UUID,
    "body" TEXT NOT NULL,
    "params" TEXT[],
    "dedupeKey" TEXT,
    "relatedType" TEXT,
    "relatedId" UUID,
    "scheduledFor" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "providerMessageId" TEXT,
    "error" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "dedupeKey" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Segment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "filter" JSONB NOT NULL,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Segment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "objective" TEXT NOT NULL DEFAULT 'PROMOTION',
    "channel" "MessageChannel" NOT NULL DEFAULT 'WHATSAPP',
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "segmentId" UUID,
    "filter" JSONB NOT NULL DEFAULT '{}',
    "templateId" UUID,
    "body" TEXT,
    "couponId" UUID,
    "offerId" UUID,
    "budget" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "scheduledAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "attributionDays" INTEGER NOT NULL DEFAULT 30,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "couponId" UUID,
    "serviceIds" UUID[],
    "price" DECIMAL(14,2),
    "originalPrice" DECIMAL(14,2),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Influencer" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "handle" TEXT,
    "platform" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "commissionType" "CommissionType" NOT NULL DEFAULT 'PERCENT',
    "commissionValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "attributionDays" INTEGER NOT NULL DEFAULT 90,
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerCommission" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "influencerId" UUID NOT NULL,
    "invoiceId" UUID,
    "clientId" UUID,
    "source" TEXT NOT NULL,
    "baseAmount" DECIMAL(14,2) NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "status" "CommissionStatus" NOT NULL DEFAULT 'PENDING',
    "earnedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "journalEntryId" UUID,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfluencerCommission_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MessagingSettings_tenantId_key" ON "MessagingSettings"("tenantId");

-- CreateIndex
CREATE INDEX "MessageTemplate_tenantId_category_idx" ON "MessageTemplate"("tenantId", "category");

-- CreateIndex
CREATE INDEX "Message_tenantId_status_scheduledFor_idx" ON "Message"("tenantId", "status", "scheduledFor");

-- CreateIndex
CREATE INDEX "Message_tenantId_createdAt_idx" ON "Message"("tenantId", "createdAt" DESC);

-- CreateIndex
CREATE INDEX "Message_tenantId_campaignId_idx" ON "Message"("tenantId", "campaignId");

-- CreateIndex
CREATE INDEX "Message_providerMessageId_idx" ON "Message"("providerMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Message_tenantId_dedupeKey_key" ON "Message"("tenantId", "dedupeKey");

-- CreateIndex
CREATE INDEX "Notification_tenantId_userId_readAt_createdAt_idx" ON "Notification"("tenantId", "userId", "readAt", "createdAt" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "Notification_tenantId_userId_dedupeKey_key" ON "Notification"("tenantId", "userId", "dedupeKey");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_tenantId_code_key" ON "Campaign"("tenantId", "code");

-- CreateIndex
CREATE INDEX "InfluencerCommission_tenantId_influencerId_status_idx" ON "InfluencerCommission"("tenantId", "influencerId", "status");

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Client" ADD CONSTRAINT "Client_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Coupon" ADD CONSTRAINT "Coupon_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "Client"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_segmentId_fkey" FOREIGN KEY ("segmentId") REFERENCES "Segment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_couponId_fkey" FOREIGN KEY ("couponId") REFERENCES "Coupon"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerCommission" ADD CONSTRAINT "InfluencerCommission_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- =============================================================== Phase 6 security
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['MessagingSettings','MessageTemplate','Message','Notification','Segment','Campaign','Offer','Influencer','InfluencerCommission']
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON %I', t);
    EXECUTE format(
      'CREATE POLICY tenant_isolation ON %I USING ("tenantId" = app_current_tenant()) WITH CHECK ("tenantId" = app_current_tenant())', t);
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO crm_app, crm_platform', t);
  END LOOP;
END $$;

-- The message log is an audit trail: the app may cancel messages, never delete them.
REVOKE DELETE ON "Message" FROM crm_app;

CREATE TRIGGER msg_tenant_guard BEFORE INSERT OR UPDATE ON "Message" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('clientId','Client', 'templateId','MessageTemplate', 'campaignId','Campaign');
CREATE TRIGGER notif_tenant_guard BEFORE INSERT OR UPDATE ON "Notification" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('userId','User');
CREATE TRIGGER camp_tenant_guard BEFORE INSERT OR UPDATE ON "Campaign" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('segmentId','Segment', 'templateId','MessageTemplate', 'couponId','Coupon', 'offerId','Offer');
CREATE TRIGGER offer_tenant_guard BEFORE INSERT OR UPDATE ON "Offer" FOR EACH ROW EXECUTE FUNCTION trg_tenant_refs('couponId','Coupon');
CREATE TRIGGER infc_tenant_guard BEFORE INSERT OR UPDATE ON "InfluencerCommission" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('influencerId','Influencer', 'invoiceId','Invoice', 'clientId','Client', 'journalEntryId','JournalEntry');

-- Client / coupon attribution columns get the same guard (existing triggers are replaced).
DROP TRIGGER IF EXISTS client_attr_guard ON "Client";
CREATE TRIGGER client_attr_guard BEFORE INSERT OR UPDATE OF "influencerId", "campaignId" ON "Client" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('influencerId','Influencer', 'campaignId','Campaign');
DROP TRIGGER IF EXISTS coupon_infl_guard ON "Coupon";
CREATE TRIGGER coupon_infl_guard BEFORE INSERT OR UPDATE OF "influencerId" ON "Coupon" FOR EACH ROW
  EXECUTE FUNCTION trg_tenant_refs('influencerId','Influencer');

-- Data rules
ALTER TABLE "MessagingSettings" ADD CONSTRAINT msg_quiet_hours CHECK ("quietStartHour" BETWEEN 0 AND 23 AND "quietEndHour" BETWEEN 0 AND 23);
ALTER TABLE "Influencer" ADD CONSTRAINT infl_commission CHECK ("commissionValue" >= 0 AND ("commissionType" <> 'PERCENT' OR "commissionValue" <= 100) AND "attributionDays" BETWEEN 1 AND 3650);
ALTER TABLE "Campaign" ADD CONSTRAINT camp_budget CHECK (budget >= 0 AND "attributionDays" BETWEEN 1 AND 365);
ALTER TABLE "Offer" ADD CONSTRAINT offer_dates CHECK ("endsAt" >= "startsAt");
-- one positive commission per influencer & invoice (refund reversals are negative rows)
CREATE UNIQUE INDEX infl_comm_once ON "InfluencerCommission" ("influencerId", "invoiceId") WHERE amount > 0 AND "invoiceId" IS NOT NULL;
CREATE INDEX client_influencer_idx ON "Client" ("tenantId", "influencerId") WHERE "influencerId" IS NOT NULL;
CREATE INDEX client_campaign_idx ON "Client" ("tenantId", "campaignId") WHERE "campaignId" IS NOT NULL;
