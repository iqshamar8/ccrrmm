# MedCRM — منصة SaaS لإدارة العيادات والمراكز الطبية والتجميلية

Multi-tenant CRM/ERP for medical, dental, dermatology, laser/beauty clinics, hospitals and
clinic-management companies. Arabic RTL first, English supported, light/dark themes.

## Status — Phase 1 ✅ (foundation)
- Multi-tenant core with **database-enforced isolation** (PostgreSQL RLS + separate DB roles)
- Super Admin: organizations (provisioning, edit, suspend/activate, plan change/renew,
  subscription history), plans with limits & module flags, platform stats/MRR, activity log
- Tenant: organization settings & branding, branches, users (branch access), roles with a
  per-permission matrix (view/create/update/delete/approve/print/export + special), audit log + CSV export
- Auth: secure login, lockout, session revocation, password change
- 25 automated tests for isolation, RBAC, plan limits, suspension and lockout

## Status — Phase 2 ✅ (core clinic operations)
- **Dashboard**: live KPIs (today / upcoming / completed / cancelled / no-show, clients, new clients,
  leads), visits & new-client trends with day/week/month/year grouping, top services, top staff,
  branch comparison, table view; money figures only for users with financial access
- **Clients (CRM)**: search by name/phone/code, filters (status, source, tag, branch), duplicate
  prevention by phone (app + DB), sequential codes, tags & categories, leads with one-click conversion,
  responsible staff, interaction timeline, CSV import/export, merge duplicates, soft delete
- **Medical record**: allergies/medications/history profile, diagnoses, notes, treatment plans,
  follow-up results, before/after photos and documents — behind `medical.view_data`; every access audited,
  medical content never copied into the audit log
- **Services**: multi-level category tree, price/cost/duration, execution & marketing commissions
  (% or fixed), qualified staff, branch-specific prices, activation
- **Appointments**: day (by doctor or by room) / week / month calendar, click-to-book, quick new
  client, recurring bookings, reschedule, confirm → check-in → complete / no-show / cancel with reason,
  waitlist, **double-booking blocked by PostgreSQL exclusion constraints**
- 47 automated tests

## Status — Phase 3 ✅ (treatment & follow-up)
- **Treatment programs**: templates (services × sessions, price, validity, interval), assign to a
  client (snapshot), book sessions from the program, sessions consumed automatically when the visit is
  completed (or recorded manually), progress %, session notes/results, pause/resume (validity extended),
  cancel (future sessions cancelled), renew, auto-complete, expired & **stalled** (30+ days idle) views
- **Client subscriptions** (separate from the SaaS plans): time-based / visit packs / session packs,
  covered services, freeze allowance, sell, freeze/unfreeze (end date extended by frozen days),
  cancel, renew (continues after current period), visits consumed on completed appointments,
  auto-close when exhausted, expiring-in-7-days list
- **Surgeries**: surgeon, team (assistant/anesthetist/nurse…), operating room — time blocked on the
  calendar by the same DB exclusion constraints; plan → confirm → start → complete / postpone / cancel;
  pre-/post-op notes, operative report, complications, recovery status, supplies with cost,
  attachments; auto-scheduled post-op reviews
- **Medical reviews**: scheduled with the doctor's calendar, reason types, findings (diagnosis,
  procedures, notes, outcome), next-review chain, overdue list, full per-patient history; review
  outcomes update the surgery's recovery status
- Booking form can charge a visit to a program session or a subscription; dashboard KPIs for all four
- 59 automated tests

## Status — Phase 4 ✅ (sales, money & staff)
- **Invoices**: draft → issued (INV numbers only at issue), partial/full payments with receipt numbers,
  refunds, cancellation, installment plans, line & invoice discounts, per-line tax, printable
  invoice/receipt, receivables with aging (1–30 / 31–60 / 61–90 / 90+). Visits, programs,
  subscriptions and surgeries are billed with one click — **each can be billed only once** (app check +
  DB partial unique indexes); prepaid visits can't be billed again.
- **POS**: services & products, barcode/SKU search, client or walk-in, coupon, points, split payments.
- **Products** for retail (stock-tracked since Phase 5).
- **Coupons**: % / fixed, max discount, min amount, dates, total & per-client limits, service and
  client targeting, influencer/staff commission.
- **Loyalty**: points earned on full payment × tier multiplier, redeemed as discount, reversed on
  refund/cancel, tiers, manual adjustments.
- **Commissions** generated when an invoice is paid: service execution, service marketing, surgery,
  sales, coupon, medical review; proportional reversal on refunds; approve → paid via payroll.
- **HR**: profiles (salary, allowance, target), weekly shifts, clock in/out from the top bar with
  lateness, attendance board, leave requests/approvals, salary advances, monthly payroll
  (base + allowances + approved commissions − advances − absences), performance & ratings.
- **Dashboard**: revenue collected, sales issued, receivables & overdue, revenue trend.
- Plan gating: coupons / loyalty / commissions / HR only work if the clinic's plan includes them.
- 74 automated tests

## Status — Phase 5 ✅ (inventory, accounting, branches, corporate contracts)
- **Inventory**: warehouses per branch (one default store each + extra stores), item groups, one
  catalog for retail products and consumable materials, suppliers, **lots with expiry**, receipts
  (on supplier credit or paid from a cash box), issues, waste, transfers between warehouses and
  branches (lots keep cost & expiry), purchase orders (draft → sent → partial/full receipt), stock
  counts with posted differences, minimum-stock and expiry alerts, movement history per item.
  Issues are **FIFO by earliest expiry**; quantities can never go negative (DB CHECK + row locks).
- **Automatic stock**: completing a visit deducts the service's materials (bill of materials on the
  service), completing a surgery deducts its stock-linked supplies, issuing an invoice deducts sold
  products and cancelling returns them. Shortages are recorded and flagged, or blocked (setting).
- **Accounting** (double entry): default chart of accounts, a cash box per branch + bank accounts,
  multi-currency with dated exchange rates, receipt & payment vouchers (expenses), manual and opening
  entries, reversal instead of edit/delete. **Every invoice, payment, refund, cancellation, stock
  document, advance and payroll posts automatically.** Reports: P&L (consolidated and per branch),
  balance sheet, cash flow, trial balance, account ledgers, supplier payables. Balance is enforced by a
  deferred DB trigger and journals are append-only for the app role.
- **Corporate contracts**: companies, agreements (discount %, period, all/selected services,
  employees and/or family, coupons allowed or not), beneficiaries, discount applied automatically on
  invoices, usage and performance per company and per agreement.
- **Dashboard**: ledger revenue, expenses and net profit with margin.
- 93 automated tests

## Status — Phase 6 ✅ (marketing, WhatsApp, reports, notifications)
- **WhatsApp Business Cloud API** (official Meta integration): per-clinic connection (phone number ID,
  access token and app secret stored AES-256-GCM encrypted), approved-template sending with ordered
  parameters, signed webhook for delivery statuses (sent → delivered → read / failed) and client
  replies; a client replying STOP is opted out of marketing. **Sandbox mode** simulates delivery for
  demos and testing; **Off** cancels sends.
- **Unified message centre**: booking confirmations, appointment reminders, overdue-payment
  reminders, subscription expiry, remaining-session reminders, post-visit follow-ups, birthdays,
  promotions and win-backs — editable templates with placeholders and live preview, automation rules
  (timing per type), quiet hours, a full message log with retry / cancel, idempotent scheduling and
  "still relevant?" checks (a reminder for a cancelled visit is never sent).
- **Staff notifications** (bell + inbox): new appointment assigned, surgery scheduled, leave
  requests, low stock and expiring lots, overdue medical reviews, failed messages, WhatsApp replies.
- **Marketing**: saved segments with a live audience builder (status, source, tags, age, gender,
  branch, inactivity, services had, spend, birthdays, unfinished programs, expiring subscriptions,
  influencer, corporate), campaigns (schedule or send now) with delivery/read, conversions to bookings
  and sales within an attribution window, coupon uses and ROI; offers; **influencers** with referred
  clients, personal codes, commissions (earned on full payment, reversed on refunds, voided on
  cancellation, paid through the ledger); follow-up worklists (inactive clients, unfinished programs,
  expiring subscriptions, unconverted leads, birthdays) with bulk WhatsApp and call logging.
- **Reports centre** (25 reports): clients (growth, sources, inactive, lead conversion), staff
  performance, services demand/revenue/cost/margin, surgeries by type and surgeon, reviews by doctor
  and by reason/outcome, inventory movements / value / shortages / expiry, revenue-expenses-profit,
  receivables aging, collections by method, subscriptions, coupons, loyalty, influencers, campaigns,
  messaging, **branch comparison** and **period comparison** — filters, charts, **Excel (.xlsx) /
  CSV export** and print-to-PDF. Money columns are hidden from roles without financial access.
- Plans: Professional now includes Marketing.
- 109 automated tests

Phase 7 (SaaS plans & billing, security hardening, performance, launch) builds on this — see `docs/ARCHITECTURE.md` → "Adding a module".

## Run locally
Requirements: Node.js 22+, PostgreSQL 16+.
```bash
npm install
cp .env.example .env           # fill in DB URLs + SESSION_SECRET
npm run db:setup               # migrations + RLS policies
npm run db:seed                # demo data incl. Phase 2 (empty DB only)
# DB seeded before a later phase? run the missing ones in order:
#   npx tsx prisma/seed-phase2.ts && npx tsx prisma/seed-phase3.ts && npx tsx prisma/seed-phase4.ts
#   npx tsx prisma/seed-phase5.ts   # also posts journal entries for history created before Phase 5
#   npx tsx prisma/seed-phase6.ts
npm run build && npm start     # or: npm run dev
```
Open http://localhost:3000 — demo logins in [`docs/DEMO_ACCOUNTS.md`](docs/DEMO_ACCOUNTS.md).

Database roles (`crm_app` NOBYPASSRLS, `crm_platform` BYPASSRLS) must exist; see
`docs/DATABASE.md`.

## Scheduled messages
Reminders are created and sent by `runMessagingCycle()`. Run it every 1–5 minutes, either:
- from any scheduler: `curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/messaging`, or
- in-process on a single server: set `MESSAGING_WORKER=1` (see `src/instrumentation-node.ts`).

Staff can also press **Run automations now** on the Messages page. For real WhatsApp delivery, set the
clinic's mode to *WhatsApp Cloud API*, enter the phone number ID / permanent token / app secret, and
register the Callback URL + verify token shown there in your Meta app (subscribe to `messages`).

## Subscription lifecycle
Renewal invoices (`renewalLeadDays` before period end), reminders (`reminderDays`), dunning
(PAST_DUE with `graceDays` of access → EXPIRED), cancel-at-period-end and trial expiry are handled by
`runSubscriptionLifecycle()`. Run it once a day:
`curl -H "Authorization: Bearer $CRON_SECRET" https://your-host/api/cron/subscriptions`
(`CRON_SECRET` must be at least 16 characters). Platform admins can also press **Run lifecycle** on
Platform → Billing. Re-running is safe.

## Tests
```bash
npm test
```

## Docs
- [Architecture & security](docs/ARCHITECTURE.md)
- [Database](docs/DATABASE.md)
- [API](docs/API.md)
