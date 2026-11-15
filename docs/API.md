# REST API

All endpoints return `{ "data": ... }` on success or
`{ "error": { "code", "message", "fields"? } }` on failure.
Auth is the `medcrm_session` httpOnly cookie. Mutating requests must send
`Content-Type: application/json` from the same origin.

| Status | Meaning |
|---|---|
| 401 UNAUTHORIZED | not signed in / session revoked |
| 402 SUBSCRIPTION_EXPIRED, PLAN_LIMIT | subscription ended / plan limit reached |
| 403 FORBIDDEN, TENANT_SUSPENDED | missing permission / org suspended |
| 404 NOT_FOUND | missing **or belongs to another tenant** |
| 409 CONFLICT, DUPLICATE | unique key clash, business rule |
| 422 VALIDATION | `fields` maps field path → message |
| 429 LOCKED, RATE_LIMIT | login lockout / throttle |

## Auth
| Method | Path | Body | Notes |
|---|---|---|---|
| POST | `/api/auth/login` | `{email, password}` | sets cookie |
| POST | `/api/auth/logout` | `{}` | clears cookie |
| GET | `/api/auth/me` | | user, tenant, permissions, features |
| POST | `/api/auth/password` | `{currentPassword, newPassword}` | revokes other sessions |

## Platform owner (`isPlatformAdmin` only)
| Method | Path | Notes |
|---|---|---|
| GET | `/api/platform/stats` | tenants by status, users, MRR, expiring, recent activity |
| GET | `/api/platform/stats?audit=1&tenantId=&take=` | cross-tenant activity log |
| GET | `/api/platform/tenants?q=&status=` | list with plan, user & branch counts |
| POST | `/api/platform/tenants` | provision: `{name, slug, type, planId, billingCycle, startTrial, baseCurrency, timezone, contactEmail, contactPhone, address, mainBranchName, admin:{fullName,email,password}}` |
| GET | `/api/platform/tenants/:id` | detail, subscription history, branches |
| PATCH | `/api/platform/tenants/:id` | `{name,type,status,baseCurrency,timezone,contact*,address}` — SUSPENDED/CANCELLED revokes all sessions |
| POST | `/api/platform/tenants/:id/subscription` | `{planId, billingCycle, status, endsAt?}` change plan / renew |
| GET / POST | `/api/platform/plans` | list (with active subscriber count) / create |
| PATCH | `/api/platform/plans/:id` | update |
| POST | `/api/platform/lifecycle/run` | run the subscription lifecycle now (renewal invoices, reminders, PAST_DUE/EXPIRED/CANCELLED transitions, trial expiry) → `LifecycleReport {at, scanned, invoicesIssued, reminders, expiredTrials, pastDue, expired, cancelled, errors[]}`; audited as `platform.lifecycle.run` |

## Tenant (permission in brackets)
| Method | Path | Permission |
|---|---|---|
| GET | `/api/organization` | settings.view |
| GET | `/api/organization?overview=1` | dashboard.view |
| PATCH | `/api/organization` | settings.update — `{name, logoUrl, primaryColor, timezone, defaultLocale, contactEmail, contactPhone, address}` |
| GET | `/api/users?q=&roleId=&status=` | users.view |
| POST | `/api/users` | users.create — `{fullName, email, password, roleId, phone?, jobTitle?, allBranches, branchIds[], status, locale}` |
| GET / PATCH / DELETE | `/api/users/:id` | users.view / users.update / users.delete |
| GET / POST | `/api/roles` | roles.view / roles.create — `{key, name, nameAr, description?, permissions[]}` |
| PATCH / DELETE | `/api/roles/:id` | roles.update / roles.delete |
| GET / POST | `/api/branches` | branches.view / branches.create — `{name, code, phone?, address?, isActive}` |
| PATCH / DELETE | `/api/branches/:id` | branches.update / branches.delete |
| GET | `/api/audit?entity=&action=&userId=&cursor=&take=` | audit.view — cursor-paginated |

## Phase 2
All list endpoints are branch-scoped for users without all-branch access.

| Method | Path | Permission / notes |
|---|---|---|
| GET | `/api/dashboard?from=&to=&granularity=day\|week\|month\|year&branchId=` | dashboard.view; money only with finance.view_data |
| GET | `/api/clients?q=&status=&source=&tag=&category=&branchId=&ownerId=&sort=recent\|name\|lastVisit&page=&pageSize=` | clients.view |
| POST | `/api/clients` | clients.create — `{fullName, phone, email?, gender?, birthDate?, address?, source?, sourceDetail?, status, category?, tags[], notes?, branchId?, ownerId?}`; 409 `DUPLICATE_CLIENT` with `details.clientId` |
| GET / PATCH / DELETE | `/api/clients/:id` | clients.view / update / delete (soft; cancels upcoming appointments) |
| GET | `/api/clients/lookup?q=` | clients.view — top 10 for booking forms |
| GET | `/api/clients/tags` | clients.view — tag counts |
| POST | `/api/clients/import` | clients.create — `{rows: [...] (≤2000)}` → `{created, skipped[{row, reason}]}` |
| GET | `/api/clients/export?…filters` | clients.export — CSV (formula-injection safe) |
| POST | `/api/clients/:id/merge` | clients.merge — `{sourceId}` |
| GET / POST | `/api/clients/:id/interactions` | clients.view / clients.update — `{type, content}` |
| GET | `/api/clients/:id/appointments` | appointments.view |
| GET | `/api/clients/:id/medical` | medical.view + medical.view_data (audited) |
| PUT | `/api/clients/:id/medical` | medical.update — profile fields |
| POST | `/api/clients/:id/medical` | medical.create — `{type, title, content, appointmentId?}` |
| PATCH / DELETE | `/api/medical-entries/:id` | medical.update / medical.delete |
| GET / POST | `/api/clients/:id/files` | list / multipart upload `file`, `category`, `note?` |
| GET / DELETE | `/api/files/:id` | download (`?download=1` to save) / delete |
| GET | `/api/catalog?active=1` | services.view (or appointments.view) — categories + services; cost/commission hidden without finance |
| POST · PATCH · DELETE | `/api/service-categories`, `/api/service-categories/:id` | services.create / update / delete |
| POST · PATCH · DELETE | `/api/services`, `/api/services/:id` | `{name, nameEn?, categoryId?, kind, price, cost, durationMin, execCommission{type,value}, marketingCommission{type,value}, color?, isActive, staffIds[], branchPrices[{branchId,price}]}` |
| GET · POST · PATCH · DELETE | `/api/rooms`, `/api/rooms/:id` | view: branches.view / appointments.view; write: branches.update |
| GET | `/api/staff` | appointments.view — active bookable users with branch access |
| GET | `/api/appointments?from=&to=&branchId=&staffId=&roomId=&clientId=&status=` | appointments.view (≤93 days) |
| POST | `/api/appointments` | appointments.create — `{clientId, branchId?, serviceId?, staffId?, roomId?, startsAt, endsAt? \| durationMin?, status, bookingSource?, notes?, repeat?{frequency DAILY\|WEEKLY\|MONTHLY, count 2–52}}`; 409 `SLOT_CONFLICT` |
| PATCH / DELETE | `/api/appointments/:id` | appointments.update (reschedule/edit) / appointments.delete |
| POST | `/api/appointments/:id/status` | appointments.update — `{status, reason?}`; reason required for CANCELLED; check-in/complete only from 2h before start |
| GET · POST · PATCH | `/api/waitlist`, `/api/waitlist/:id` | appointments.view / create / update |

`POST /api/appointments` also accepts `programItemId` **or** `subscriptionId` (Phase 3).

## Phase 3
| Method | Path | Permission / notes |
|---|---|---|
| GET · POST | `/api/program-templates` | programs.view / create — `{name, nameEn?, description?, price, validityDays?, intervalDays?, isActive, items[{serviceId, sessions}]}` |
| PATCH · DELETE | `/api/program-templates/:id` | programs.update / delete (blocked once sold) |
| GET | `/api/programs?status=&stalled=1&clientId=&q=` | programs.view — with progress, lastSessionAt, stalled |
| POST | `/api/programs` | programs.create — `{clientId, templateId? \| items[], name?, price?, startDate?, endDate?, intervalDays?, doctorId?, notes?}` |
| GET · PATCH | `/api/programs/:id` | detail with items (used/booked/remaining), sessions, reviews / `{name, doctorId, endDate, intervalDays, notes, results}` |
| POST | `/api/programs/:id/status` | `{action: PAUSE\|RESUME\|CANCEL\|COMPLETE, reason?}` |
| POST | `/api/programs/:id/renew` | programs.create — `{startDate?, price?}` |
| POST | `/api/programs/:id/sessions` | manual session `{itemId, performedAt, notes?, result?}` |
| PATCH | `/api/program-sessions/:id` | `{notes, result}` (medical data) |
| GET · POST | `/api/subscription-plans` · PATCH · DELETE `/:id` | subscriptions.* — `{name, kind TIME\|VISITS\|SESSIONS, price, durationDays, visitsLimit?, maxFreezeDays, allServices, serviceIds[], isActive}` |
| GET | `/api/subscriptions?status=&expiring=7&clientId=&q=` | subscriptions.view |
| POST | `/api/subscriptions` | subscriptions.create — `{clientId, planId, startDate?, price?}` |
| GET | `/api/subscriptions/:id` | detail + usages |
| POST | `/api/subscriptions/:id/status` | `{action: FREEZE\|UNFREEZE\|CANCEL, reason?}` |
| POST | `/api/subscriptions/:id/renew` · `/usage` | renew `{startDate?, price?}` / manual visit `{serviceId?, usedAt?, note?}` |
| GET | `/api/clients/:id/coverage` | active program items + subscriptions usable for booking |
| GET · POST | `/api/surgeries?status=&from=&to=&surgeonId=&clientId=&q=` | surgeries.view / create — `{clientId, serviceId?, surgeryType?, surgeonId, roomId?, scheduledAt, durationMin?, price?, anesthesiaType?, preOpNotes?, status, team[{userId, role}]}` |
| GET · PATCH | `/api/surgeries/:id` | detail (+ reviews, files) / reschedule & edit |
| PATCH | `/api/surgeries/:id/clinical` | surgeries.update + medical.view_data — notes, report, complications, recoveryStatus |
| POST | `/api/surgeries/:id/status` | `{action: CONFIRM\|START\|COMPLETE\|POSTPONE\|CANCEL, reason?, followUpDays?[]}` |
| POST · DELETE | `/api/surgeries/:id/supplies`, `/api/surgery-supplies/:id` | `{name, quantity, unitCost, notes?}` |
| GET · POST | `/api/reviews?scope=today\|upcoming\|overdue&status=&doctorId=&clientId=&surgeryId=` | reviews.view / create — `{clientId, doctorId, reasonType, reason, scheduledAt, durationMin, surgeryId?, clientProgramId?}` |
| GET · PATCH | `/api/reviews/:id` | detail + patient history / reschedule |
| POST | `/api/reviews/:id/complete` | `{diagnosis?, procedures?, notes?, outcome?, nextReviewAt?, nextReason?}` |
| POST | `/api/reviews/:id/status` | `{action: MISSED\|CANCEL, reason?}` |
| POST | `/api/clients/:id/files` | (+) `surgeryId` / `reviewId` form fields |

## Phase 4
| Method | Path | Permission / notes |
|---|---|---|
| GET · PATCH | `/api/settings/billing` | settings.view / settings.update — tax, terms, footer, loyalty rates, commission rules |
| GET · POST · PATCH | `/api/products`, `/api/products/:id` | services.view / create / update |
| GET | `/api/invoices?status=&type=&clientId=&from=&to=&q=&unpaid=1&page=` | invoices.view — 50 per page + sums |
| POST | `/api/invoices[?issue=1]` | invoices.create — `{clientId?, branchId?, lines[{kind, serviceId?, productId?, appointmentId?, clientProgramId?, subscriptionId?, surgeryId?, description?, quantity, unitPrice?, discount, taxRate?, performedById?}], discountAmount, couponCode?, redeemPoints, salesStaffId?, notes?, dueDate?, installments?[{dueDate, amount}]}` |
| GET · PATCH · DELETE | `/api/invoices/:id` | view / edit draft (invoices.update) / delete draft (invoices.delete) |
| POST | `/api/invoices/:id/issue` | invoices.create — `{installments?}` |
| POST | `/api/invoices/:id/payments` | invoices.create — `{amount, method CASH\|CARD\|TRANSFER\|OTHER, reference?, note?, paidAt?}` |
| POST | `/api/invoices/:id/refund` | invoices.approve — `{amount, method, reason}` |
| POST | `/api/invoices/:id/cancel` | invoices.approve — `{reason}` (only when nothing is paid) |
| POST | `/api/invoices/bill` | invoices.create — `{source: appointment\|program\|subscription\|surgery, id}` → draft; 409 `ALREADY_BILLED` |
| GET | `/api/receivables` | invoices.view — unpaid invoices, aging buckets, per-client totals |
| POST | `/api/pos/checkout` | pos.create + invoices.create — invoice body + `payments[]`; walk-ins must pay in full |
| GET · POST · PATCH · DELETE | `/api/coupons`, `/api/coupons/:id` | coupons.* |
| POST | `/api/coupons/check` | `{code, clientId?, lines[{kind, serviceId?, amount}]}` → discount |
| GET | `/api/loyalty` | loyalty.view — balances & totals |
| GET · POST · PATCH · DELETE | `/api/loyalty/tiers`, `/api/loyalty/tiers/:id` | loyalty.* |
| GET · POST | `/api/clients/:id/loyalty` | balance + history / adjust `{points, note}` |
| GET | `/api/commissions?userId=&status=&source=&from=&to=` | commissions.view (own only without commissions.approve) |
| POST | `/api/commissions/status` · `/adjust` | commissions.approve `{ids, action APPROVE\|VOID}` / commissions.create `{userId, amount, note}` |
| GET | `/api/hr/employees` | hr.view |
| PUT | `/api/hr/employees/:id/profile` · `/shifts` | hr.update |
| GET · POST | `/api/hr/clock` | any staff — today's record / `{action: IN\|OUT}` |
| GET · POST | `/api/hr/attendance` · GET `/api/hr/attendance/board?date=` | own or hr.view / hr.update (set) / hr.view |
| GET · POST · POST | `/api/hr/leaves`, `/api/hr/leaves/:id` | own or hr.view / request / `{action APPROVE\|REJECT\|CANCEL}` (approve needs hr.approve, not own) |
| GET · POST | `/api/hr/advances` | hr.view / hr.create |
| GET · POST | `/api/hr/payroll` | hr.view / hr.create `{period: YYYY-MM}` (builds/rebuilds draft) |
| GET · POST · PATCH | `/api/hr/payroll/:id`, `/:id/status`, `/api/hr/payroll-items/:id` | hr.view / hr.approve `{action APPROVE\|PAID}` / hr.update |
| GET · POST | `/api/hr/performance?from=&to=` · `/api/hr/evaluations` | hr.view / hr.update |

## Phase 5
| Method | Path | Permission / notes |
|---|---|---|
| GET · POST · PATCH | `/api/inventory/warehouses, /:id` | inventory.view / create / update |
| GET · POST · PATCH | `/api/inventory/groups, /:id · /api/inventory/suppliers, /:id` | inventory.* |
| GET | `/api/inventory/stock?warehouseId=&groupId=&q=&low=1` | inventory.view — per item: qty, value, avg cost, next expiry, per warehouse |
| GET | `/api/inventory/alerts · /api/inventory/items/:id` | low stock + lots expiring in 30 days / item card: lots + movement history |
| POST | `/api/inventory/receipts` | inventory.create — {warehouseId, supplierId? or cashAccountId?, date?, reference?, lines[{itemId, quantity, unitCost, lotNo?, expiryDate?}]} |
| POST | `/api/inventory/issues` | inventory.create — {type ISSUE or WASTE, warehouseId, notes, lines[{itemId, quantity}]}; 409 INSUFFICIENT_STOCK |
| POST | `/api/inventory/transfers` | inventory.create — {fromWarehouseId, toWarehouseId, lines} |
| GET | `/api/inventory/documents?type=&warehouseId=&from=&to= · /:id` | documents / one document with movements and its journal entry |
| GET · POST · PATCH | `/api/inventory/purchase-orders, /:id` | inventory.view / create / update (draft only) |
| POST | `/api/inventory/purchase-orders/:id/status · /receive` | {action ORDER or CANCEL} / {lines[{lineId, quantity, lotNo?, expiryDate?}]} |
| GET · POST · PATCH | `/api/inventory/counts · /:id · POST /:id/post` | start {warehouseId} / lines [{lineId, countedQty}] / post (inventory.approve) |
| GET · PUT | `/api/services/:id/materials` | services.view / services.update — [{itemId, quantity}] |
| GET · POST · PATCH | `/api/accounting/accounts, /:id` | accounting.* — GET /:id?from=&to= is the account ledger with running balance |
| GET · POST · PATCH | `/api/accounting/cash-accounts, /:id` | accounting.* (GET also with invoices.view) |
| GET · POST | `/api/accounting/rates` | {currency, rate, date} — 1 unit = rate × base currency |
| GET · POST | `/api/accounting/journals?source=&from=&to=&accountId=&q=&page=` | list / manual entry {date, description, opening?, branchId?, lines[{accountId, debit, credit}]} |
| POST | `/api/accounting/journals/:id/reverse` | accounting.approve — {reason} |
| GET · POST | `/api/accounting/vouchers?type=&from=&to=&expenses=1` | {type RECEIPT or PAYMENT, cashAccountId, counterAccountId, amount, currency?, supplierId?, payee?, description} |
| POST | `/api/accounting/vouchers/:id/void` | accounting.approve — {reason} |
| GET | `/api/accounting/reports/income?from=&to=&branchId=&byBranch=1` | P&L (+ per branch) |
| GET | `/api/accounting/reports/balance-sheet?asOf= · /cash-flow · /trial-balance · /payables` | accounting.view (payables also with inventory.view) |
| GET · POST · PATCH | `/api/corporate, /api/corporate/:id` | corporate.* — list with usage / company with agreements, members, invoices |
| POST · PATCH | `/api/corporate/:id/agreements, /:agreementId` | corporate.update — overlapping active agreements → 409 |
| POST · DELETE | `/api/corporate/:id/members · /api/corporate/members/:memberId` | corporate.update — {clientId, memberType EMPLOYEE or FAMILY, employeeNo?, validUntil?} |

## Phase 6
| Method | Path | Permission / notes |
|---|---|---|
| GET · POST | `/api/me/notifications?unread=1 · /api/me/notifications/read` | any staff — own notifications / mark {ids} or {all: true} read |
| GET · PUT | `/api/messaging/settings` | notifications.view / notifications.update — secrets write-only (masked on read) |
| GET · POST · PATCH | `/api/messaging/templates, /:id · POST /api/messaging/templates/preview` | notifications.view / create / update |
| GET | `/api/messaging/messages?status=&category=&campaignId=&clientId=&from=&to=&q=&page=` | notifications.view — 50 per page + counts by status |
| POST | `/api/messaging/messages/:id` | notifications.update — {action: CANCEL (queued) or RETRY (failed/cancelled)} |
| POST | `/api/messaging/send` | notifications.create — {clientIds[], category, templateId? or message, scheduledFor?} |
| POST · GET | `/api/messaging/run · /api/messaging/stats?days=` | run automations + send now (notifications.update) / counts |
| GET · POST | `/api/webhooks/whatsapp/:tenantId` | Meta only — GET verify (hub.verify_token), POST statuses/inbound (X-Hub-Signature-256) |
| GET · POST | `/api/cron/messaging` | scheduler — Authorization: Bearer CRON_SECRET; automations + sending for all tenants |
| GET · POST | `/api/cron/subscriptions` | scheduler (daily) — Authorization: Bearer CRON_SECRET; SaaS subscription lifecycle for all tenants → `{ok, report}`; idempotent |
| POST | `/api/marketing/audience` | marketing.view — audience filter → {count, sample} |
| GET · POST · PATCH · DELETE | `/api/marketing/segments, /:id` | marketing.* |
| GET · POST · PATCH | `/api/marketing/campaigns, /:id` | marketing.view / create / update — GET /:id adds stats + recipients |
| POST | `/api/marketing/campaigns/:id/launch · /cancel` | marketing.update (+ Notifications module) — {scheduledAt?} |
| GET · POST · PATCH | `/api/marketing/offers, /:id` | marketing.* |
| GET · POST · PATCH | `/api/marketing/influencers, /:id` | marketing.* — list with stats / detail with clients & commissions |
| PUT · POST · POST | `/api/marketing/influencers/:id/coupons · /commissions · /adjust` | marketing.update — {couponIds} / {action APPROVE, VOID or PAY, ids[], cashAccountId?} (PAY also needs finance.view_data) / {amount, note} |
| GET | `/api/marketing/follow-ups?kind=inactive|programs|subscriptions|leads|birthdays&days=` | clients.view |
| GET | `/api/reports · /api/reports/:key?from=&to=&branchId=&days=&lang=` | reports.view (+ each report's own permissions & plan module) |
| GET | `/api/reports/:key/export?format=xlsx|csv&…` | reports.export |
