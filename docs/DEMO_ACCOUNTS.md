# Demo accounts (local development only)

Password for every account: **`Demo@12345`** (from `prisma/seed.ts`).

| Account | Role | Organization |
|---|---|---|
| owner@medcrm.test | Platform owner (Super Admin) | — |
| admin@elite.test | Organization admin | عيادات النخبة للتجميل والليزر (Professional, 2 branches) |
| manager@elite.test | Branch manager (Zayouna branch only) | Elite |
| accountant@elite.test | Accountant | Elite |
| reception@elite.test | Receptionist | Elite |
| doctor@elite.test | Doctor | Elite |
| nurse@elite.test | Nurse | Elite |
| sales@elite.test | Sales | Elite |
| stock@elite.test | Inventory manager | Elite |
| hr@elite.test | HR manager | Elite |
| marketing@elite.test | Marketing | Elite |
| admin@smile.test / reception@smile.test / doctor@smile.test | Admin / Receptionist / Doctor | مركز ابتسامة لطب الأسنان (Starter, trial) |
| admin@shifa.test / manager@shifa.test / doctor@shifa.test / reception@shifa.test | Admin / Branch manager / Doctor / Receptionist | مجمع الشفاء الطبي (Enterprise, 3 branches) |
| admin@glow.test | Admin | مركز جلو للجلدية — **SUSPENDED** (login is refused) |

Elite also has a custom role "أخصائي ليزر" (laser_technician).

Phase 2 practitioners: dr.rana@elite.test (doctor, Zayouna), laser@elite.test (laser technician),
dr.ari@smile.test, dr.ali@shifa.test, dr.hiba@shifa.test.

Phase 2 demo data: Elite ~180 clients / ~1,700 appointments, Smile ~70 / ~900, Shifa ~120 / ~900,
spanning 90 days back and 21 days ahead, with medical records, interactions, rooms and a waitlist.

Phase 3 demo data: program templates and ~60 sold programs with session history (some stalled,
paused, cancelled, completed), subscription plans and ~55 subscriptions (active, expiring soon,
frozen, cancelled, expired), 13 surgeries at Shifa (past with reports and post-op reviews, upcoming
planned/confirmed) and routine/program follow-up reviews including a few overdue ones.
Best views: **admin@shifa.test** → Surgeries / Reviews; **admin@elite.test** → Programs / Subscriptions.

Phase 4 demo data (created through the real billing services, back-dated): ~1,700 invoices for
past visits, programs, subscriptions, surgeries and retail sales — paid, part-paid, unpaid,
installments; coupons `WELCOME10`, `LASER25`, `NOOR15` (influencer, owned by marketing@elite.test),
expired `SUMMER`; loyalty tiers & balances; employee profiles, shifts, 5 weeks of attendance,
leave requests, an advance; last month's payroll approved & paid (Elite, Shifa).
Smile Dental's Starter plan has no coupons/loyalty/HR/commissions — a good example of plan gating.
Best views: **admin@elite.test** → POS / Invoices / Commissions / HR; **accountant@elite.test** → Invoices;
**sales@elite.test** → own commissions only.

Phase 5 demo data: every past invoice, payment, refund, advance and payroll has its journal entries
(dated like the original). Elite and Shifa have item groups, consumable materials with lots (one
expired, one expiring soon), three suppliers, a central store plus a store per branch, receipts,
branch transfers, waste, three purchase orders (part-received, sent, draft), an open stock count,
service bills of materials and material consumption for recent visits. Shifa (Enterprise) also has
a bank account, exchange rates (IQD / EUR / SAR), opening balances, three months of expense vouchers,
a EUR supplier payment, and three corporate companies with agreements, beneficiaries and discounted
invoices. Elite's Professional plan has Inventory but not Accounting or Corporate.
Best views: **admin@shifa.test** → Accounting → Financial reports, Corporate contracts;
**admin@elite.test** → Inventory.

Phase 6 demo data: messaging runs in **Sandbox** mode (nothing reaches real phones) with ~30 days of
confirmations, reminders and follow-ups (delivered / read / some failed), current automatic reminders
in the queue, two default templates mapped to approved WhatsApp template names, and a few clients who
opted out of marketing. Elite and Shifa each have influencers with referred clients and commissions
(the first influencer's approved commissions are paid through the ledger; Elite's NOOR15 code belongs
to "نور الهدى"), five segments, three offers, and three campaigns: a win-back sent 25 days ago with
results and ROI, a scheduled promotion and a draft. Smile Dental has messaging turned off.
Best views: **admin@elite.test** → Campaigns / Influencers / Follow-up lists / Reports;
**marketing@elite.test** → marketing without money columns; bell icon for staff notifications.

Good accounts to compare permissions: **admin@elite.test** (everything), **doctor@elite.test**
(medical yes, money no), **reception@elite.test** (booking yes, medical no, main branch only),
**manager@elite.test** (Zayouna branch only).

Never deploy these accounts to production.
