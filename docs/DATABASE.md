# Database

Source of truth: [`prisma/schema.prisma`](../prisma/schema.prisma). Migrations: `prisma/migrations/`.

```
Plan 1───* TenantSubscription *───1 Tenant 1───* Branch
                                      │ 1            │ 1
                                      ├──* Role 1─*  │
                                      ├──* User *────┴─ UserBranch (user ↔ branch access)
                                      └──* AuditLog
```

| Table | Scope | Notes |
|---|---|---|
| `Plan` | platform | price monthly/yearly, trial days, maxUsers, maxBranches, storageMb, `features[]` (module keys) |
| `Tenant` | self | name, unique `slug`, `type` (8 kinds), `status` TRIAL/ACTIVE/SUSPENDED/CANCELLED, branding (logo, primaryColor), base currency, timezone |
| `TenantSubscription` | tenant | history of plan subscriptions; latest row is current. status, billingCycle, startsAt/endsAt/trialEndsAt |
| `Branch` | tenant | unique `(tenantId, code)`; one `isMain` branch (can't be deleted/deactivated) |
| `Role` | tenant | unique `(tenantId, key)`; `permissions[]`; `isSystem` roles can't be deleted |
| `User` | tenant (NULL = platform owner) | globally unique lower-cased email, bcrypt hash, `sessionVersion`, lockout fields, `allBranches` |
| `UserBranch` | tenant | composite PK `(userId, branchId)` |
| `AuditLog` | tenant (NULL = platform) | action, entity, entityId, before/after JSON (secrets scrubbed), ip, userAgent; indexed `(tenantId, createdAt desc)` |

## Phase 2 tables (`0003_phase2`)
```
Client 1──* ClientInteraction        Service *──1 ServiceCategory (self-tree, parentId)
   │   1──1 MedicalRecord            Service 1──* ServiceStaff (qualified users)
   │   1──* MedicalEntry             Service 1──* ServiceBranchPrice
   │   1──* FileObject               Branch  1──* Room
   │   1──* Appointment *── Service / User(staff) / Room / Branch
   └─  1──* WaitlistEntry
```
| Table | Notes |
|---|---|
| `TenantCounter` | per-tenant sequences (`client` → `C-000123`; invoices later) |
| `Client` | code, fullName, phone + `phoneNormalized`, email, gender, birthDate, address, source/sourceDetail, status LEAD/ACTIVE/INACTIVE/BLOCKED, category, `tags[]`, branch, owner (staff), photo, lastVisitAt, convertedAt, soft `deletedAt` |
| `ClientInteraction` | NOTE/CALL/WHATSAPP/EMAIL/VISIT/SYSTEM timeline; SYSTEM rows are codes rendered by the UI |
| `MedicalRecord` | 1:1 profile: blood type, allergies, medications, chronic conditions, past surgeries, history, family history |
| `MedicalEntry` | DIAGNOSIS / NOTE / TREATMENT_PLAN / FOLLOW_UP_RESULT, optional appointment link, author |
| `FileObject` | CLIENT_PHOTO / MEDICAL_BEFORE / MEDICAL_AFTER / MEDICAL_DOCUMENT, mime (sniffed), size, storage key |
| `ServiceCategory` | tree; delete blocked while it has children/services; cycles rejected |
| `Service` | kind, price, cost, duration, exec & marketing commission (NONE/PERCENT/FIXED + value), colour, active |
| `Room` | per branch; kind TREATMENT/LASER/CONSULTATION/OPERATING/DENTAL |
| `Appointment` | branch, client, service, staff, room, start/end, status workflow, price snapshot, booking channel, recurrence group, status timestamps |
| `WaitlistEntry` | client, preferred service/staff/date/time, WAITING/BOOKED/REMOVED |

Extensions: `btree_gist` (exclusion constraints), `pg_trgm` (search).
`0004_fn_grants` grants EXECUTE on the trigger helper to the runtime roles.

## Phase 3 tables (`0005_phase3`)
| Table | Notes |
|---|---|
| `ProgramTemplate` / `ProgramTemplateItem` | reusable programs: price, validityDays, intervalDays; items = service × sessions (>0) |
| `ClientProgram` | code `P-000001`, client, branch, template, doctor, name/price snapshot, status ACTIVE/PAUSED/COMPLETED/CANCELLED/EXPIRED, start/end `DATE`, results, renewedFrom |
| `ClientProgramItem` | service × sessionsTotal snapshot |
| `ProgramSession` | performed session; unique `(itemId, sessionNo)`; optional unique `appointmentId` |
| `SubscriptionPlan` / `SubscriptionPlanService` | TIME / VISITS / SESSIONS, durationDays, visitsLimit, maxFreezeDays, covered services |
| `ClientSubscription` | code `SUB-000001`, snapshot of kind/limits/coverage (`coveredServiceIds uuid[]`), start/end `DATE`, status ACTIVE/FROZEN/CANCELLED/EXPIRED, frozenAt, frozenDaysUsed |
| `SubscriptionUsage` | one per visit; optional unique `appointmentId` |
| `Surgery` | code `S-000001`, client, surgeon, room, owning `appointmentId` (unique), schedule, status, price, anesthesia, pre/post-op notes, operative report, complications, recoveryStatus |
| `SurgeryTeamMember` / `SurgerySupply` | team with role; consumables (qty × unit cost) |
| `MedicalReview` | client, doctor, optional surgery/program, previousReview (chain), owning appointment, reason type, findings, outcome |
| `Appointment` (+) | `programItemId`, `subscriptionId` |
| `FileObject` (+) | `surgeryId`, `reviewId` |

## Phase 4 tables (`0006_phase4`)
| Table | Notes |
|---|---|
| `TenantSettings` | tax name/rate, payment terms, invoice footer, loyalty rates, review & sales commission rules |
| `Product` | retail items: SKU, barcode, unit, price, cost, own tax rate |
| `Invoice` | code (at issue), client (nullable = walk-in), branch, type, status, totals (subtotal, discount, coupon, loyalty, tax, total, paid, refunded), coupon, points redeemed, seller; CHECK paid ≤ total |
| `InvoiceLine` | kind, qty, price, discount, tax, lineTotal; links to service / product / appointment / program / subscription / surgery; performedBy; `voided` |
| `Payment` | PAYMENT / REFUND, receipt no., amount > 0, method, reference — not deletable by the app |
| `InvoiceInstallment` | seq, due date, amount (status derived from payments in order) |
| `Coupon` / `CouponRedemption` | rules & targeting / one redemption per invoice |
| `LoyaltyTier` / `LoyaltyTransaction` | tiers / signed points ledger (EARN, REDEEM, ADJUST, REVERSE) |
| `EmployeeProfile`, `WorkShift`, `AttendanceRecord`, `LeaveRequest`, `SalaryAdvance` | HR |
| `PayrollRun` / `PayrollItem` | one run per month; per-employee breakdown and net |
| `CommissionEntry` | user, source, base, rule, signed amount, status, payroll run |
| `EmployeeEvaluation` | monthly 1–5 rating with notes |

Partial unique indexes `bill_once_appointment/program/subscription/surgery` (live lines only) and
`comm_once` prevent double billing and duplicate commissions.

## Phase 5 tables (`0007_phase5`)
| Table | Notes |
|---|---|
| `ItemGroup`, `Warehouse` | item tree / stores per branch (one `isDefault` per branch — partial unique index) |
| `Supplier` | contact, tax no.; balance comes from AP journal lines |
| `Product` (+cols) | `trackStock`, `isSellable`, `isConsumable`, `expiryTracking`, `minStock`, `groupId` |
| `StockLot` | item × warehouse × lot: quantity (CHECK ≥ 0), unit cost, expiry, received at |
| `StockDocument` / `StockMovement` | GRN / ISS / TRF / WST / ADJ / SAL / CON / RET; signed movements (append-only) |
| `PurchaseOrder` / `PurchaseOrderLine` | DRAFT → ORDERED → PARTIAL → RECEIVED / CANCELLED; received qty per line |
| `StockCount` / `StockCountLine` | book qty snapshot, counted qty, posted as an ADJUSTMENT |
| `ServiceMaterial` | bill of materials per service |
| `Account` | chart of accounts tree, type, `isGroup`, `systemKey` |
| `CashAccount` | CASH (per branch) / BANK, linked ledger account |
| `ExchangeRate` | currency × date → rate to base (CHECK > 0) |
| `JournalEntry` / `JournalLine` | source + sourceId, branch, reversal link / debit or credit (CHECK one side), branch, client, supplier, FC amount — append-only, balanced at commit |
| `Voucher` | RV / PV, cash box, counter account, base amount, FC amount & rate, POSTED / VOID |
| `CorporateAccount`, `CorporateAgreement`, `CorporateMember` | companies / agreements (CHECK 0–100 %) / beneficiaries (one company per client) |
| `Invoice` (+cols) | `corporateDiscount`, `corporateAgreementId` |
| `Payment`, `SalaryAdvance`, `PayrollRun` (+cols) | cash box / bank used |
| `TenantSettings` (+cols) | `autoConsumeMaterials`, `blockOnStockShortage` |

Every new table has RLS and the cross-tenant reference guard trigger.

## Phase 6 tables (`0008_phase6`)
| Table | Notes |
|---|---|
| `MessagingSettings` | one per tenant: provider (DISABLED / SANDBOX / WHATSAPP_CLOUD), phone number ID, encrypted token & app secret, verify token, country code, quiet hours (CHECK 0–23), automation rules (JSON) |
| `MessageTemplate` | category, body with placeholders, approved WhatsApp template name & language, default flag |
| `Message` | outbox + delivery log: status, phone, client, template, campaign, body, params, unique `(tenantId, dedupeKey)`, related record, schedule, attempts, provider id, sent/delivered/read/failed times — no DELETE for the app role |
| `Notification` | staff in-app notifications; unique `(tenantId, userId, dedupeKey)` |
| `Segment` | saved audience filter (JSON) |
| `Campaign` | code, objective, audience filter, template/body, coupon, offer, budget (CHECK ≥ 0), schedule, attribution window, recipients |
| `Offer` | title, period (CHECK end ≥ start), services, prices, coupon |
| `Influencer` / `InfluencerCommission` | commission rule (CHECK %) & attribution window / signed commission rows (REFERRAL / COUPON / ADJUSTMENT), status, journal entry; partial unique index one positive row per influencer & invoice |
| `Client` (+cols) | `influencerId`, `campaignId`, `marketingOptOut` |
| `Coupon` (+col) | `influencerId` |

All new tables have RLS and the cross-tenant reference guard trigger.

## RLS policies (`0002_rls`)
- `Branch, Role, UserBranch, TenantSubscription, AuditLog`: `"tenantId" = app_current_tenant()`
- `User`: same, and WITH CHECK forbids `isPlatformAdmin = true`
- `Tenant`: `"id" = app_current_tenant()`
- `app_current_tenant()` = `NULLIF(current_setting('app.tenant_id', true), '')::uuid`

## Grants for `crm_app`
| Table | Rights |
|---|---|
| Branch, Role, User, UserBranch | SELECT, INSERT, UPDATE, DELETE |
| AuditLog | SELECT, INSERT (append-only) |
| Tenant | SELECT; UPDATE only on name, logoUrl, primaryColor, timezone, defaultLocale, contact*, address |
| TenantSubscription, Plan | SELECT |
| _prisma_migrations | none |

## Operations
```bash
npm run db:setup     # apply migrations to the main DB (non-destructive)
npm run db:seed      # demo data (expects an empty DB)
npm test             # migrate test DB + run isolation/RBAC tests
```
Destructive resets (`npm run db:reset`, `npm run test:reset`) drop all data — dev only.

**Backups (production):** run `pg_dump -Fc` nightly + WAL archiving / managed PITR
(e.g. RDS, Cloud SQL, Neon). Not configured on this dev machine.
