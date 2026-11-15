/**
 * Phase 6 demo data (idempotent per tenant):
 *   - Professional plan gains the Marketing module (Elite).
 *   - Messaging in SANDBOX mode (simulated delivery — no real WhatsApp sends),
 *     default templates, 30 days of message history (confirmations, reminders,
 *     follow-ups, payment reminders) with delivered/read/failed statuses.
 *   - Influencers with referred clients, coupons and commissions (some paid).
 *   - Segments, offers, campaigns (sent with results, scheduled, draft).
 *   - A few marketing opt-outs; current automations + staff notifications.
 * Standalone: npx tsx prisma/seed-phase6.ts
 */
import "dotenv/config";
import { loadContext, type Ctx } from "../src/server/context";
import { disconnectAll, withPlatform } from "../src/server/db";
import { ensureTemplates, render, runAutomations, dispatchQueued, toE164 } from "../src/server/services/messaging";
import { influencerCommissionAction, influencerForInvoice, launchCampaign, saveCampaign, saveInfluencer, saveOffer, saveSegment, setInfluencerCoupons } from "../src/server/services/marketing";
import { notifyPermission } from "../src/server/services/notifications";
import { addPayment, createInvoice } from "../src/server/services/billing";

const DAY = 86400000;
function rng(seed: number) {
  return () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

const CONF: Record<string, { influencers: { name: string; handle: string; platform: "instagram" | "tiktok" | "snapchat"; pct: number; coupon?: string }[]; laserKind: string; offers: [string, string, number][] }> = {
  "elite-beauty": {
    influencers: [
      { name: "نور الهدى", handle: "@noor.beauty", platform: "instagram", pct: 10, coupon: "NOOR15" },
      { name: "ريم ستايل", handle: "@reem.style", platform: "tiktok", pct: 8 },
      { name: "سارة لايف", handle: "sara.live", platform: "snapchat", pct: 7 },
    ],
    laserKind: "LASER",
    offers: [["باقة الليزر الصيفية: جلستان + جلسة مجانية", "عرض محدود على ليزر الجسم الكامل", 25], ["هيدرافيشل + تنظيف عميق بسعر خاص", "مثالي قبل المناسبات", 20]],
  },
  "shifa-medical": {
    influencers: [
      { name: "Dr. Beauty Talks", handle: "@drbeautytalks", platform: "instagram", pct: 5 },
      { name: "Hala Vlogs", handle: "@hala.vlogs", platform: "tiktok", pct: 6 },
    ],
    laserKind: "COSMETIC",
    offers: [["استشارة تجميلية مجانية مع حجز العملية", "خلال هذا الشهر فقط", 100], ["خصم 15% على البوتوكس والفيلر", "للعملاء الجدد", 15]],
  },
};

async function seedTenant(slug: string, rand: () => number) {
  const t = await withPlatform((tx) => tx.tenant.findUnique({ where: { slug } }));
  if (!t) return;
  const admin = await withPlatform((tx) => tx.user.findFirstOrThrow({ where: { tenantId: t.id, role: { key: "tenant_admin" } }, orderBy: { createdAt: "asc" } }));
  const ctx = (await loadContext(admin.id, null)) as Ctx;
  const conf = CONF[slug];
  const tenantId = t.id;
  if (await withPlatform((tx) => tx.influencer.count({ where: { tenantId } }))) return console.log(`  ${slug}: already has Phase 6 data, skipped`);
  const has = (m: string) => ctx.features.has(m);
  const pick = <T,>(a: T[]) => a[Math.floor(rand() * a.length)];
  const out: string[] = [];

  // ----------------------------------------------------- messaging setup ----
  await withPlatform(async (tx) => {
    await tx.messagingSettings.upsert({ where: { tenantId }, create: { tenantId, provider: "SANDBOX", verifyToken: `demo-${slug}` }, update: {} });
    await ensureTemplates(tx, tenantId);
    // Approved WhatsApp template names (what you'd create in WhatsApp Manager) on two defaults.
    await tx.messageTemplate.updateMany({ where: { tenantId, category: "APPOINTMENT_REMINDER", isDefault: true }, data: { waTemplateName: "appointment_reminder_ar", waLanguage: "ar" } });
    await tx.messageTemplate.updateMany({ where: { tenantId, category: "APPOINTMENT_CONFIRM", isDefault: true }, data: { waTemplateName: "booking_confirmation_ar", waLanguage: "ar" } });
    // A few clients asked not to receive marketing messages.
    const some = await tx.client.findMany({ where: { tenantId, status: "ACTIVE", deletedAt: null }, take: 4, skip: 7, select: { id: true } });
    await tx.client.updateMany({ where: { id: { in: some.map((s) => s.id) } }, data: { marketingOptOut: true } });
  });

  // 30 days of history: confirmations + reminders for past appointments, follow-ups, payment reminders.
  if (has("notifications")) {
    const n = await withPlatform(async (tx) => {
      const tpl = await tx.messageTemplate.findMany({ where: { tenantId, isDefault: true } });
      const tname = (await tx.tenant.findUniqueOrThrow({ where: { id: tenantId } })).name;
      const cc = "964";
      const appts = await tx.appointment.findMany({ where: { tenantId, startsAt: { gte: new Date(Date.now() - 30 * DAY), lt: new Date() } }, include: { client: true, service: true, branch: true }, take: 400, orderBy: { startsAt: "desc" } });
      const rows = [];
      for (const a of appts) {
        for (const [cat, offH] of [["APPOINTMENT_CONFIRM", -72], ["APPOINTMENT_REMINDER", -24], ...(a.status === "COMPLETED" && rand() < 0.4 ? [["FOLLOW_UP", 24]] : [])] as [string, number][]) {
          const t0 = tpl.find((x) => x.category === cat)!;
          const at = new Date(+a.startsAt + offH * 3600000);
          if (at > new Date()) continue;
          const r = rand();
          const status = r < 0.05 ? "FAILED" : r < 0.55 ? "READ" : "DELIVERED";
          const { text, params } = render(t0.body, { client_name: a.client.fullName, clinic_name: tname, branch_name: a.branch.name, date: a.startsAt.toISOString().slice(0, 10), time: a.startsAt.toISOString().slice(11, 16), service: a.service?.name ?? "-" });
          rows.push({
            tenantId, category: cat as "FOLLOW_UP", status: status as "READ", toPhone: toE164(a.client.phone, cc), clientId: a.clientId, templateId: t0.id, body: text, params,
            dedupeKey: `${cat === "APPOINTMENT_CONFIRM" ? "appt-confirm" : cat === "FOLLOW_UP" ? "follow" : "appt-remind"}:${a.id}`, relatedType: "appointment", relatedId: a.id,
            scheduledFor: at, attempts: 1, createdAt: at, sentAt: status === "FAILED" ? null : at, deliveredAt: status === "FAILED" ? null : new Date(+at + 60000),
            readAt: status === "READ" ? new Date(+at + 3600000 * (1 + rand() * 5)) : null, failedAt: status === "FAILED" ? at : null,
            providerMessageId: status === "FAILED" ? null : `sandbox.hist.${a.id}.${cat}`, error: status === "FAILED" ? "131026: Message undeliverable (recipient not on WhatsApp)" : null,
          });
        }
      }
      await tx.message.createMany({ data: rows, skipDuplicates: true });
      return rows.length;
    }, { timeout: 120000 });
    out.push(`${n} historical messages`);
  }

  if (!has("marketing")) { console.log(`  ${slug}: ${out.join(" · ")}`); return; }

  // ------------------------------------------------------------ influencers ----
  const infl: { conf: (typeof conf.influencers)[number]; row: { id: string } }[] = [];
  for (const i of conf.influencers) infl.push({ conf: i, row: await saveInfluencer(ctx, null, { name: i.name, handle: i.handle, platform: i.platform, commissionType: "PERCENT", commissionValue: i.pct, attributionDays: 120, notes: "تعاون إعلاني شهري" }) });
  // Link the influencer coupon (e.g. NOOR15) and attribute recent clients.
  const coupons = await withPlatform((tx) => tx.coupon.findMany({ where: { tenantId } }));
  for (const x of infl) if (x.conf.coupon) { const c = coupons.find((k) => k.code === x.conf.coupon); if (c) await setInfluencerCoupons(ctx, x.row.id, { couponIds: [c.id] }); }
  const recent = await withPlatform((tx) => tx.client.findMany({ where: { tenantId, deletedAt: null, createdAt: { gte: new Date(Date.now() - 100 * DAY) } }, orderBy: { createdAt: "desc" }, take: 40 }));
  let referred = 0;
  await withPlatform(async (tx) => {
    for (const c of recent) {
      if (rand() > 0.45) continue;
      const x = pick(infl);
      await tx.client.update({ where: { id: c.id }, data: { influencerId: x.row.id, source: "influencer", sourceDetail: x.conf.handle } });
      referred++;
    }
  });
  // Commissions for their already-paid invoices (same rule the app applies at payment time).
  const n = await withPlatform(async (tx) => {
    const invs = await tx.invoice.findMany({ where: { tenantId, status: "PAID", OR: [{ client: { influencerId: { not: null } } }, { coupon: { influencerId: { not: null } } }] }, select: { id: true, issuedAt: true } });
    let k = 0;
    for (const i of invs) {
      k += await influencerForInvoice(tx, tenantId, i.id);
      await tx.influencerCommission.updateMany({ where: { invoiceId: i.id }, data: { earnedAt: i.issuedAt ?? new Date() } });
    }
    return k;
  }, { timeout: 120000 });
  // Approve older ones; pay the first influencer (posts Dr Marketing / Cr cash).
  for (const [ix, x] of infl.entries()) {
    const old = await withPlatform((tx) => tx.influencerCommission.findMany({ where: { tenantId, influencerId: x.row.id, status: "PENDING", earnedAt: { lt: new Date(Date.now() - 20 * DAY) } }, select: { id: true } }));
    if (old.length) await influencerCommissionAction(ctx, x.row.id, { action: "APPROVE", ids: old.map((o) => o.id) });
    if (ix === 0 && old.length) await influencerCommissionAction(ctx, x.row.id, { action: "PAY", ids: [] });
  }
  out.push(`${infl.length} influencers, ${referred} referred clients, ${n} commissions`);

  // --------------------------------------------------------------- segments ----
  const services = await withPlatform((tx) => tx.service.findMany({ where: { tenantId, isActive: true } }));
  const laser = services.filter((s) => s.kind === conf.laserKind).map((s) => s.id);
  const segs = [
    await saveSegment(ctx, null, { name: "غير نشطين منذ 30 يوماً", description: "لم يزوروا العيادة منذ شهر", filter: { statuses: ["ACTIVE"], lastVisitOlderThanDays: 30 } }),
    await saveSegment(ctx, null, { name: slug === "elite-beauty" ? "عملاء الليزر" : "عملاء التجميل", description: "نفذوا الخدمة مرة على الأقل", filter: { statuses: ["ACTIVE"], serviceIds: laser.slice(0, 6) } }),
    await saveSegment(ctx, null, { name: "عيد ميلادهم هذا الشهر", filter: { statuses: ["ACTIVE"], birthdayThisMonth: true } }),
    await saveSegment(ctx, null, { name: "عملاء محتملون لم يتحولوا", filter: { statuses: ["LEAD"] } }),
    await saveSegment(ctx, null, { name: "برامج غير مكتملة", description: "لديهم جلسات متبقية", filter: { statuses: ["ACTIVE"], incompleteProgram: true } }),
  ];

  // ----------------------------------------------------------------- offers ----
  const welcome = coupons.find((c) => c.code === "WELCOME10") ?? coupons[0];
  const offers: { id: string; title: string }[] = [];
  for (const [i, [title, description, pct]] of conf.offers.entries()) {
    offers.push(await saveOffer(ctx, null, { title, description, startsAt: new Date(Date.now() - 10 * DAY), endsAt: new Date(Date.now() + (20 + i * 15) * DAY), couponId: i === 0 ? welcome?.id ?? null : null, serviceIds: laser.slice(0, 2), originalPrice: null, price: null, isActive: true }));
    void pct;
  }
  await saveOffer(ctx, null, { title: "عرض رمضان (منتهي)", description: "عرض سابق للأرشيف", startsAt: new Date(Date.now() - 200 * DAY), endsAt: new Date(Date.now() - 170 * DAY), serviceIds: [], isActive: false });

  // -------------------------------------------------------------- campaigns ----
  const reTpl = await withPlatform((tx) => tx.messageTemplate.findFirstOrThrow({ where: { tenantId, category: "REACTIVATION", isDefault: true } }));
  const c1 = await saveCampaign(ctx, null, { name: "استعادة العملاء غير النشطين", objective: "REACTIVATION", segmentId: segs[0].id, templateId: reTpl.id, couponId: welcome?.id ?? null, budget: slug === "elite-beauty" ? 150000 : 120, attributionDays: 30, notes: "حملة واتساب + إعلان ممول" });
  const l1 = await launchCampaign(ctx, c1.id, {});
  // Back-date the campaign 25 days and give it realistic delivery results.
  await withPlatform(async (tx) => {
    const sentAt = new Date(Date.now() - 25 * DAY);
    await tx.campaign.update({ where: { id: c1.id }, data: { sentAt, scheduledAt: sentAt, status: "SENT", createdAt: sentAt } });
    const msgs = await tx.message.findMany({ where: { tenantId, campaignId: c1.id } });
    for (const m of msgs) {
      const r = rand();
      const st = m.status === "CANCELLED" ? "CANCELLED" : r < 0.06 ? "FAILED" : r < 0.6 ? "READ" : "DELIVERED";
      await tx.message.update({ where: { id: m.id }, data: { status: st, createdAt: sentAt, scheduledFor: sentAt, sentAt: st === "FAILED" || st === "CANCELLED" ? null : sentAt, deliveredAt: ["READ", "DELIVERED"].includes(st) ? new Date(+sentAt + 120000) : null, readAt: st === "READ" ? new Date(+sentAt + 7200000) : null, failedAt: st === "FAILED" ? sentAt : null, error: st === "FAILED" ? "131026: Message undeliverable" : m.error } });
    }
    // Some recipients came back: a booking within the window (attribution).
    const back = msgs.filter(() => rand() < 0.18).slice(0, 12);
    for (const [i, m] of back.entries()) {
      if (!m.clientId) continue;
      const cl = await tx.client.findUniqueOrThrow({ where: { id: m.clientId } });
      const svc = services[i % services.length];
      const startsAt = new Date(Date.now() - (20 - i) * DAY + 9 * 3600000);
      {
        await tx.appointment.create({ data: { tenantId, branchId: cl.branchId, clientId: cl.id, serviceId: svc.id, staffId: null, startsAt, endsAt: new Date(+startsAt + svc.durationMin * 60000), status: "COMPLETED", completedAt: startsAt, price: svc.price, bookingSource: "campaign", createdAt: new Date(+sentAt + (i + 1) * DAY) } });
      }
    }
  }, { timeout: 120000 });
  await billCampaignVisits(ctx, tenantId);
  const c2 = await saveCampaign(ctx, null, { name: `عرض: ${offers[0].title}`, objective: "PROMOTION", segmentId: segs[1].id, offerId: offers[0].id, couponId: welcome?.id ?? null, body: "مرحباً {{client_name}}! {{offer}} — احجز الآن واستخدم الكود {{coupon_code}}. {{clinic_name}}", budget: slug === "elite-beauty" ? 250000 : 200, attributionDays: 21 });
  await launchCampaign(ctx, c2.id, { scheduledAt: new Date(Date.now() + 3 * DAY) });
  await saveCampaign(ctx, null, { name: "تهنئة أعياد الميلاد الشهرية", objective: "EVENT", segmentId: segs[2].id, templateId: (await withPlatform((tx) => tx.messageTemplate.findFirstOrThrow({ where: { tenantId, category: "BIRTHDAY", isDefault: true } }))).id, budget: 0 });
  out.push(`${segs.length} segments, ${offers.length + 1} offers, 3 campaigns (${l1.queued} recipients sent)`);

  // ------------------------------------------- automations + notifications ----
  const created = await runAutomations(tenantId);
  const sent = await dispatchQueued(tenantId, new Date(), 500);
  await withPlatform((tx) => notifyPermission(tx, tenantId, "marketing.view", { type: "campaign.result", title: "نتائج حملة «استعادة العملاء غير النشطين»", body: "اطّلع على التحويلات والعائد في صفحة التسويق.", link: "/marketing", dedupeKey: "demo-campaign-result" }));
  out.push(`automations ${JSON.stringify(created)}, dispatched ${sent.sent}`);
  console.log(`  ${slug}: ${out.join(" · ")}`);
}

/** Bills (and back-dates) the visits that came from a campaign, so attribution shows real sales. */
export async function billCampaignVisits(ctx: Ctx, tenantId: string) {
  const appts = await withPlatform(async (tx) => {
    const billed = (await tx.invoiceLine.findMany({ where: { tenantId, appointmentId: { not: null }, voided: false }, select: { appointmentId: true } })).map((l) => l.appointmentId!);
    return tx.appointment.findMany({ where: { tenantId, bookingSource: "campaign", status: "COMPLETED", id: { notIn: billed } } });
  });
  let n = 0;
  for (const a of appts) {
    const inv = await createInvoice(ctx, { clientId: a.clientId, branchId: a.branchId, lines: [{ kind: "SERVICE", appointmentId: a.id, quantity: 1 }] }, { issue: true });
    if (Number(inv.total) > 0) await addPayment(ctx, inv.id, { amount: Number(inv.total), method: "CASH", paidAt: a.startsAt });
    await withPlatform(async (tx) => {
      await tx.invoice.update({ where: { id: inv.id }, data: { issuedAt: a.startsAt, createdAt: a.startsAt } });
      await tx.journalEntry.updateMany({ where: { tenantId, sourceId: inv.id }, data: { date: a.startsAt } });
      const pays = await tx.payment.findMany({ where: { invoiceId: inv.id }, select: { id: true } });
      await tx.journalEntry.updateMany({ where: { tenantId, sourceId: { in: pays.map((x) => x.id) } }, data: { date: a.startsAt } });
      await tx.commissionEntry.updateMany({ where: { invoiceId: inv.id }, data: { earnedAt: a.startsAt } });
    });
    n++;
  }
  return n;
}

export async function seedPhase6() {
  // Marketing becomes part of the Professional plan.
  await withPlatform(async (tx) => {
    const pro = await tx.plan.findFirst({ where: { code: "professional" } });
    if (pro && !pro.features.includes("marketing")) await tx.plan.update({ where: { id: pro.id }, data: { features: [...pro.features, "marketing"] } });
  });
  for (const [i, slug] of ["elite-beauty", "shifa-medical", "smile-dental"].entries()) {
    if (slug === "smile-dental") {
      const t = await withPlatform((tx) => tx.tenant.findUnique({ where: { slug } }));
      if (t) await withPlatform((tx) => tx.messagingSettings.upsert({ where: { tenantId: t.id }, create: { tenantId: t.id, provider: "DISABLED" }, update: {} }));
      continue;
    }
    await seedTenant(slug, rng(600 + i));
  }
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("prisma/seed-phase6.ts")) {
  seedPhase6().then(() => console.log("Phase 6 seed complete.")).catch((e) => { console.error(e); process.exit(1); }).finally(disconnectAll);
}
