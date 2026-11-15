# MedCRM — Architecture

## Stack
| Layer | Choice |
|---|---|
| Frontend | Next.js 15 (App Router) + React 19 + TypeScript |
| UI | Tailwind CSS v4, own component kit (`src/components/ui.tsx`), RTL-first, dark mode |
| Backend | Next.js Route Handlers (`src/app/api/**`) → service layer (`src/server/services/**`) |
| Database | PostgreSQL 17 via Prisma 6 |
| Auth | bcrypt (cost 12) + HS256 JWT in an httpOnly, SameSite=Lax cookie |
| Authorization | RBAC (`src/lib/permissions.ts`) × plan feature flags |
| Tests | Vitest against a real PostgreSQL test database |

## Request flow
```
Browser ──► middleware.ts (valid JWT? else /login)
        ──► /api/... route.ts  ── route() wrapper (src/server/api.ts)
               1. CSRF: mutating requests must be JSON + same Origin
               2. getCtx(): JWT → loadContext() → user, tenant, subscription,
                  effective permissions   (re-read from DB on EVERY request)
               3. service function (Zod-validated input)
                     requireTenant(ctx, "users.create")  → 401/402/403
                     withTenant(tenantId, tx => ...)     → RLS-enforced tx
                     audit(tx, ctx, {...})                → same transaction
               4. errors → JSON {error:{code,message,fields}}
```

## Multi-tenant isolation (defense in depth)
Shared database, shared schema, `tenantId` on every tenant-owned row. This scales to
thousands of tenants without per-tenant schemas/migrations.

1. **PostgreSQL Row Level Security** (`prisma/migrations/0002_rls`).
   Every tenant table has `ENABLE` + `FORCE ROW LEVEL SECURITY` and a policy
   `"tenantId" = app_current_tenant()` for both reads (USING) and writes (WITH CHECK).
   `withTenant()` runs `set_config('app.tenant_id', $id, true)` — *transaction-local*,
   so a pooled connection can never carry one tenant's id into another request.
   No setting ⇒ zero rows (fail closed).
2. **Separate database roles**
   - `crm_app` — NOBYPASSRLS. All tenant traffic. Cannot update `Tenant.status/type/slug`
     (column-level grants), cannot touch subscriptions, cannot UPDATE/DELETE audit rows.
   - `crm_platform` — BYPASSRLS. Used only by `withPlatform()`: super-admin services and
     identity lookup at login (we don't know the tenant before the user is found).
   - `postgres` (owner) — migrations only; never used at runtime.
3. **Service layer** — every query still filters by `tenantId` explicitly, and foreign ids
   (roleId, branchIds) are verified to belong to the tenant. A foreign id is a 404,
   indistinguishable from a non-existent one.
4. **Tests** — `tests/isolation.test.ts` attacks both layers (read by PK, insert/update/
   delete into another tenant, move rows across tenants, create platform admins, change
   own plan, delete audit, pooled-connection leakage).

5. **Cross-tenant reference triggers** (Phase 2, `0003_phase2`). RLS hides foreign rows, but
   PostgreSQL FK checks run with owner rights — so a buggy write could still point an appointment at
   another tenant's client/room/staff. `BEFORE INSERT/UPDATE` triggers (`app_same_tenant()`) reject
   any reference whose parent belongs to a different tenant.

## Data integrity enforced by PostgreSQL (Phase 2)
| Rule | Mechanism |
|---|---|
| No double-booking of a staff member | `EXCLUDE USING gist (tenantId =, staffId =, tsrange(startsAt,endsAt) &&)` for non-cancelled rows |
| No double-booking of a room | same, on `roomId` |
| End after start | `CHECK ("endsAt" > "startsAt")` |
| One live client per phone per tenant | partial unique index `WHERE "deletedAt" IS NULL` |
| Fast fuzzy name / phone search at scale | `pg_trgm` GIN indexes |

The service layer checks the same rules first to return a friendly 409 with the clashing booking;
the database is the backstop for races (two receptionists clicking the same slot).

## Phase 3 — how the pieces connect
```
ProgramTemplate ──assign──► ClientProgram ─┬─ ClientProgramItem (service × sessionsTotal)
                                            │        ▲ appointment.programItemId
SubscriptionPlan ──sell──► ClientSubscription ◄─ appointment.subscriptionId
                                            │
Appointment ──COMPLETED──► ProgramSession / SubscriptionUsage   (same transaction)
Surgery ──owns──► Appointment (surgeon + OR)      MedicalReview ──owns──► Appointment (doctor)
Surgery ──COMPLETE(followUpDays)──► MedicalReview ──complete(nextReviewAt)──► MedicalReview …
```
- **Balance rules** are checked at booking (booked-but-not-done visits count as reserved, per
  occurrence of a recurring series) and again at completion. A program session's service is fixed.
- **Prepaid visits carry no per-visit price** (program/subscription price is the revenue; Phase 4
  invoices will bill programs, subscriptions and surgeries without double-counting).
- **Surgery and review slots are real appointments**, so the PostgreSQL exclusion constraints protect
  them too; the calendar shows them but refuses to change them (`MANAGED_BY_SURGERY/REVIEW`).
- Generic trigger `trg_tenant_refs(col, table, …)` (0005) guards every cross-table reference of the
  new tables against cross-tenant links; the appointment & file triggers were re-created with it.
- Dates like start/end of programs and subscriptions are `DATE` columns; day counts (freeze, pause)
  use whole calendar days (`calendarDaysBetween`) — elapsed-ms rounding over-counted by one.
- Clinical text in programs (session notes, results), surgeries (pre/post-op, report, complications)
  and reviews (diagnosis, procedures, notes) follows the same rule as the medical record: hidden
  without `medical.view_data`, never copied into the audit log, and views are audited.

## Phase 4 — billing, loyalty, commissions, payroll
```
Invoice DRAFT ──issue──► ISSUED (INV-n, coupon redemption, points REDEEM)
   └─ payments ──► PARTIALLY_PAID ──► PAID ──► loyalty EARN + CommissionEntry rows (PENDING)
   └─ refund(x) ──► reverse x/total of commissions & earned points ──► REFUNDED when nothing left
   └─ cancel (nothing paid) ──► lines voided (sources billable again), coupon & points released
CommissionEntry PENDING ──approve──► APPROVED ──payroll approve──► PAID (payrollRunId)
```
- **Money math** uses `Prisma.Decimal` everywhere (`services/money.ts`); invoice discounts
  (manual → coupon → loyalty) are spread pro-rata over lines for tax and commission bases.
- **No double billing**: an appointment / program / subscription / surgery may appear on one live
  invoice line — app check (`ALREADY_BILLED` 409 with the invoice id) + partial unique indexes
  `bill_once_*` on non-voided lines.
- **Numbering** comes from `TenantCounter` (INV / RCPT / RFND / P / SUB / S), assigned at issue so
  drafts never leave gaps.
- **Plan gating**: `ctx.features` is checked in billing — coupons, points, commissions and loyalty
  earning are skipped/refused when the plan lacks the module.
- `finance.view_data` belongs to the core Dashboard module, so money visibility doesn't depend on the
  Accounting add-on.
- Payments can't be deleted by the app role (financial history is append-only; refunds are new rows).
- Journal entries for all of this are posted automatically since Phase 5 (below).

## Phase 5 — inventory, ledger, corporate contracts
```
Receipt GRN ── lots(+qty, cost, expiry) ──► Dr Inventory / Cr Supplier (AP) or cash box
Issue / sale / visit materials / surgery supplies ── FIFO by expiry (SELECT … FOR UPDATE) ──► Dr Cost of materials / Cr Inventory
Waste ──► Dr Inventory waste · Count ──► Inventory vs count differences · Transfer across branches ──► Inventory(to) / Inventory(from)
Invoice issued ──► Dr AR / Cr revenue by line kind (+ tax payable)      Payment ──► Dr cash box/bank / Cr AR
Refund ──► Dr revenue & tax (pro rata) / Cr cash   Cancel ──► mirror entry + stock returned to original lots
Advance ──► Dr employee advances / Cr cash          Payroll approved ──► Dr salaries + commissions / Cr advances + salaries payable (dated at period end)
Payroll paid ──► Dr salaries payable / Cr bank       Voucher ──► cash box ↔ any leaf account, converted at the dated FX rate
```
- **Lots** (`StockLot`) hold quantity, unit cost and expiry; `StockMovement` is a signed, append-only
  ledger per document. CHECK `quantity >= 0` makes negative stock impossible even under concurrency.
- **Journals**: `postEntry` normalises lines and refuses unbalanced input; the deferred constraint
  trigger `journal_balanced` re-checks at commit. `crm_app` has no UPDATE/DELETE on
  `JournalEntry`, `JournalLine` or `StockMovement` — corrections are reversing entries.
- **Chart of accounts** is created lazily per tenant (`ensureChart`); automatic postings find their
  accounts by `systemKey`, so tenants can rename/renumber freely. Each cash box/bank owns a ledger
  account under 1101/1102; a branch's default cash box is created on first need.
- **Branches**: every journal line carries `branchId` → per-branch and consolidated P&L; each branch
  has its own default warehouse and cash box. Payroll and unallocated expenses appear consolidated only.
- **Corporate discount** is computed first in invoice building (before manual/coupon/points
  discounts), only for members of an active agreement covering the service; coupons are refused
  unless the agreement allows them.
- **Plan gating**: inventory hooks run only with the `inventory` module, corporate discounts only
  with `corporate`; the ledger always records sales, so enabling Accounting later shows full history.

## Phase 6 — messaging, marketing, reports
```
event (booking) / runAutomations() ──► Message QUEUED (dedupeKey: appt-remind:<id>, pay-remind:<inv>:<round> …)
dispatchQueued(): claim → SENDING (FOR UPDATE SKIP LOCKED) → still relevant? → provider
   SANDBOX: DELIVERED at once · WHATSAPP_CLOUD: Graph API /messages (approved template + params, or text)
   ok → SENT (providerMessageId) · 5xx/429/network → retry ×3 with backoff · 4xx → FAILED
webhook /api/webhooks/whatsapp/:tenantId (HMAC X-Hub-Signature-256 with the tenant's app secret)
   statuses move forward only (SENT < DELIVERED < READ) · inbound → client interaction, STOP → opt-out
```
- **Idempotency**: every automatic message has a unique `(tenantId, dedupeKey)`; automations can
  run any number of times. Messages are re-checked before sending (appointment still active,
  invoice still unpaid, subscription/program still active, client not opted out of marketing).
- **Quiet hours** (tenant time zone) hold automatic and campaign messages; confirmations and
  messages a staff member sends by hand go out at once.
- **Secrets**: WhatsApp token and app secret are encrypted with AES-256-GCM (`DATA_ENCRYPTION_KEY`),
  never returned by the API (masked ••••1234), and stripped from audit logs. The message log is
  append-only for the app role (no DELETE).
- **Templates**: free text is sent through the CUSTOM template (`{{message}}` → one WhatsApp
  parameter); other templates map placeholders, in order, to the approved template's `{{1}}…{{n}}`.
- **Campaign attribution**: recipients who book or are invoiced within `attributionDays` of the send
  count as conversions; sales = their non-cancelled invoices; ROI = (sales − budget) / budget.
- **Influencer commissions** mirror staff commissions: earned when an invoice is fully paid (referred
  client within the influencer's window, or the influencer's coupon), one per influencer & invoice
  (partial unique index), pro-rata negative rows on refunds, voided on cancellation; paying posts
  Dr Marketing / Cr cash (`JournalSource.INFLUENCER`).
- **Reports** are definitions (permissions + plan module + columns) over SQL; one result feeds the
  screen, xlsx/csv export (dependency-free writer, RTL sheet for Arabic) and print. Branch-restricted
  users are limited to their branches; money columns are removed without `finance.view_data`.
- **In-app notifications** are core (every plan); client messaging needs the Notifications module,
  marketing the Marketing module.

## Medical data
- Requires `medical.<action>` **and** `medical.view_data`. Receptionists/sales never see it, by default.
- Audit rows for medical changes store **only changed field names**, never content
  (the audit log is readable by admins without medical access). Every *view* of a medical record and
  every download of a medical file is itself audited (access log).
- Files: magic-byte type check (JPG/PNG/WEBP/PDF), 10 MB limit, plan storage quota, stored under
  `UPLOAD_DIR/<tenantId>/<uuid>` (no user-controlled path), served only through `/api/files/:id`
  with `Cache-Control: no-store` + sandbox CSP. Logout sends `Clear-Site-Data: "cache"` so a shared
  front-desk PC keeps nothing from the previous user. All `/api/*` responses are `no-store`.

## RBAC + plans
- Permission key = `module.action` (`clients.view`, `invoices.approve`) plus special keys
  (`medical.view_data`, `finance.view_data`, `branches.view_all`, `clients.merge`).
- 10 system roles are provisioned per tenant (`DEFAULT_ROLES`); tenants add custom roles.
- **Effective permission = role grants it AND the tenant's plan includes the module.**
  Core modules (dashboard, users, roles, branches, audit, settings) are always on.
- Guards: `tenant_admin` always keeps all permissions; last active admin can't be removed;
  users can't grant permissions they don't hold (escalation guard).
- Branch scope: `allBranches` or `branches.view_all` ⇒ all branches; otherwise only the
  user's `UserBranch` rows (`branchScope()` in `services/branches.ts`, reused by later modules).

## Sessions
- 12h JWT `{sub, v}`; `v` = `User.sessionVersion`. Password change, disable, role change,
  and tenant suspension bump the version → every existing session dies instantly.
- Login lockout: 5 failures ⇒ 15 min lock (persisted), plus per-IP burst throttle.
- Unknown e-mails take the same bcrypt time as wrong passwords (no user enumeration).

## Subscription enforcement
`loadContext()` computes `tenant.access`: `suspended` (tenant SUSPENDED/CANCELLED → 403),
`expired` (no sub, cancelled/paused/expired, trial or period ended → 402), else `ok`.
Platform plan subscriptions (`TenantSubscription`) are fully separate from the clinics'
own client subscriptions (Phase 3).

## Adding a module (Phase 2+ recipe)
1. Add models with `tenantId String @db.Uuid` + `@@index([tenantId, ...])`.
2. New migration: tables + `ENABLE/FORCE RLS` + `tenant_isolation` policy + grants to
   `crm_app`/`crm_platform` (copy the block in `0002_rls`).
3. Service functions: `requireTenant(ctx, "<module>.<action>")` → `withTenant` → `audit`.
4. Thin route handlers with `route()`.
5. Extend `tests/isolation.test.ts` with the new tables.
