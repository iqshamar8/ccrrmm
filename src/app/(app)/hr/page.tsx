"use client";
import { useEffect, useMemo, useState } from "react";
import { useResource, useSubmit } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Badge, Button, Card, Checkbox, EmptyState, Field, Input, LoadingRows, Modal, PageHeader, Select, Table, Td, Tr } from "@/components/ui";
import Forbidden from "@/components/Forbidden";
import { fmtTime } from "@/components/appointments/shared";
import { useMoney } from "@/components/billing/useMoney";
import { api } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { ATT_STATUS, DAYS, EMP_STATUS, l4, LEAVE_STATUS, LEAVE_TYPE, PAYROLL_STATUS, t4 } from "@/lib/labels4";

type Emp = {
  id: string; fullName: string; email: string; phone: string | null; jobTitle: string | null; status: string; role: { nameAr: string; name: string } | null;
  employee: null | { employeeNo: string | null; department: string | null; specialty: string | null; hireDate: string | null; baseSalary: string; fixedAllowance: string; monthlyTarget: string; dailyHours: string; status: string; emergencyContact: string | null; notes: string | null };
  shifts: { dayOfWeek: number; startTime: string; endTime: string }[]; branchAccess: { branch: { name: string } }[];
};
type Tab = "employees" | "attendance" | "leaves" | "payroll" | "advances" | "performance";

export default function HrPage() {
  const { tr, can } = useSession();
  const [tab, setTab] = useState<Tab>(can("hr.view") ? "employees" : "leaves");
  const tabs: [Tab, string, boolean][] = [
    ["employees", tr("الموظفون", "Employees"), can("hr.view")], ["attendance", tr("الحضور والانصراف", "Attendance"), can("hr.view")],
    ["leaves", tr("الإجازات", "Leave"), true], ["payroll", tr("الرواتب", "Payroll"), can("hr.view")],
    ["advances", tr("السلف", "Advances"), can("hr.view")], ["performance", tr("تقييم الأداء", "Performance"), can("hr.view")],
  ];
  return (
    <>
      <PageHeader title={tr("الموارد البشرية", "Human resources")} subtitle={tr("ملفات الموظفين، الدوام، الإجازات، الرواتب والأداء", "Staff files, attendance, leave, payroll and performance")} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
        {tabs.filter((t) => t[2]).map(([k, l]) => <button key={k} onClick={() => setTab(k)} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${tab === k ? "border-brand font-medium text-brand" : "border-transparent text-muted"}`}>{l}</button>)}
      </div>
      {tab === "employees" && <Employees />}
      {tab === "attendance" && <Attendance />}
      {tab === "leaves" && <Leaves />}
      {tab === "payroll" && <Payroll />}
      {tab === "advances" && <Advances />}
      {tab === "performance" && <Performance />}
    </>
  );
}

// ------------------------------------------------------------ employees ----
function Employees() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const { data, loading, reload } = useResource<Emp[]>(can("hr.view") ? "/api/hr/employees" : null);
  const [edit, setEdit] = useState<Emp | null>(null);
  if (!can("hr.view")) return <Forbidden />;
  return (
    <Card>
      <Table head={[tr("الموظف", "Employee"), tr("القسم", "Department"), tr("الدور", "Role"), tr("الراتب", "Salary"), tr("الدوام", "Schedule"), tr("الحالة", "Status")]}>
        {loading && !data ? <LoadingRows cols={6} /> : data?.map((e) => (
          <Tr key={e.id} onClick={can("hr.update") ? () => setEdit(e) : undefined}>
            <Td><p className="font-medium">{e.fullName}</p><p className="text-xs text-muted">{e.employee?.employeeNo ? `${e.employee.employeeNo} · ` : ""}{e.jobTitle}</p></Td>
            <Td className="text-muted">{e.employee?.department ?? "—"}</Td>
            <Td className="text-muted">{e.role ? (locale === "ar" ? e.role.nameAr : e.role.name) : "—"}</Td>
            <Td className="tabular">{e.employee ? money(e.employee.baseSalary) : <span className="text-muted">{tr("غير محدد", "Not set")}</span>}</Td>
            <Td className="text-xs text-muted">{e.shifts.length ? `${e.shifts.length} ${tr("أيام", "days")} · ${e.shifts[0].startTime}–${e.shifts[0].endTime}` : "—"}</Td>
            <Td><Badge tone={t4(EMP_STATUS, e.employee?.status ?? "ACTIVE")}>{l4(EMP_STATUS, e.employee?.status ?? "ACTIVE", locale)}</Badge></Td>
          </Tr>
        ))}
      </Table>
      <EmployeeModal emp={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); }} />
    </Card>
  );
}

function EmployeeModal({ emp, onClose, onSaved }: { emp: Emp | null; onClose: () => void; onSaved: () => void }) {
  const { tr, locale } = useSession();
  const blank = { employeeNo: "", department: "", specialty: "", hireDate: "", baseSalary: "0", fixedAllowance: "0", monthlyTarget: "0", dailyHours: "8", status: "ACTIVE", emergencyContact: "", notes: "" };
  const [f, setF] = useState(blank);
  const [shifts, setShifts] = useState<Record<number, { on: boolean; startTime: string; endTime: string }>>({});
  const { pending, run } = useSubmit();
  useEffect(() => {
    if (!emp) return;
    const p = emp.employee;
    setF(p ? { employeeNo: p.employeeNo ?? "", department: p.department ?? "", specialty: p.specialty ?? "", hireDate: p.hireDate?.slice(0, 10) ?? "", baseSalary: String(Number(p.baseSalary)), fixedAllowance: String(Number(p.fixedAllowance)),
      monthlyTarget: String(Number(p.monthlyTarget)), dailyHours: String(Number(p.dailyHours)), status: p.status, emergencyContact: p.emergencyContact ?? "", notes: p.notes ?? "" } : blank);
    setShifts(Object.fromEntries(DAYS.map((_, d) => { const s = emp.shifts.find((x) => x.dayOfWeek === d); return [d, { on: !!s, startTime: s?.startTime ?? "09:00", endTime: s?.endTime ?? "17:00" }]; })));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [emp]);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <Modal open={!!emp} onClose={onClose} wide title={emp?.fullName ?? ""}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} onClick={async () => {
        const ok = await run(async () => {
          await api(`/api/hr/employees/${emp!.id}/profile`, { method: "PUT", body: f });
          await api(`/api/hr/employees/${emp!.id}/shifts`, { method: "PUT", body: Object.entries(shifts).filter(([, s]) => s.on).map(([d, s]) => ({ dayOfWeek: Number(d), startTime: s.startTime, endTime: s.endTime })) });
          return true;
        }, tr("تم حفظ ملف الموظف", "Employee saved"));
        if (ok) onSaved();
      }}>{tr("حفظ", "Save")}</Button></>}>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label={tr("الرقم الوظيفي", "Employee no.")}><Input dir="ltr" value={f.employeeNo} onChange={set("employeeNo")} /></Field>
        <Field label={tr("القسم", "Department")}><Input value={f.department} onChange={set("department")} /></Field>
        <Field label={tr("التخصص", "Specialty")}><Input value={f.specialty} onChange={set("specialty")} /></Field>
        <Field label={tr("تاريخ التعيين", "Hire date")}><Input type="date" dir="ltr" value={f.hireDate} onChange={set("hireDate")} /></Field>
        <Field label={tr("الراتب الأساسي", "Base salary")}><Input type="number" min={0} step="any" dir="ltr" value={f.baseSalary} onChange={set("baseSalary")} /></Field>
        <Field label={tr("بدل ثابت شهري", "Fixed allowance")}><Input type="number" min={0} step="any" dir="ltr" value={f.fixedAllowance} onChange={set("fixedAllowance")} /></Field>
        <Field label={tr("الهدف الشهري (إيرادات)", "Monthly target")}><Input type="number" min={0} step="any" dir="ltr" value={f.monthlyTarget} onChange={set("monthlyTarget")} /></Field>
        <Field label={tr("ساعات العمل اليومية", "Daily hours")}><Input type="number" min={1} max={24} step="0.5" dir="ltr" value={f.dailyHours} onChange={set("dailyHours")} /></Field>
        <Field label={tr("الحالة الوظيفية", "Status")}><Select value={f.status} onChange={set("status")}>{Object.entries(EMP_STATUS).map(([k, v]) => <option key={k} value={k}>{locale === "ar" ? v.ar : v.en}</option>)}</Select></Field>
        <Field label={tr("جهة اتصال للطوارئ", "Emergency contact")} className="sm:col-span-3"><Input value={f.emergencyContact} onChange={set("emergencyContact")} /></Field>
        <div className="sm:col-span-3 border-t border-line pt-4">
          <p className="mb-2 font-medium">{tr("أوقات العمل الأسبوعية", "Weekly schedule")}</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {DAYS.map(([ar, en], d) => shifts[d] && (
              <div key={d} className="flex items-center gap-2">
                <Checkbox label={<span className="inline-block w-16">{locale === "ar" ? ar : en}</span>} checked={shifts[d].on} onChange={(e) => setShifts({ ...shifts, [d]: { ...shifts[d], on: e.target.checked } })} />
                <Input className="h-8 w-28" type="time" dir="ltr" disabled={!shifts[d].on} value={shifts[d].startTime} onChange={(e) => setShifts({ ...shifts, [d]: { ...shifts[d], startTime: e.target.value } })} />
                <Input className="h-8 w-28" type="time" dir="ltr" disabled={!shifts[d].on} value={shifts[d].endTime} onChange={(e) => setShifts({ ...shifts, [d]: { ...shifts[d], endTime: e.target.value } })} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ----------------------------------------------------------- attendance ----
type Board = { date: string; rows: { id: string; fullName: string; jobTitle: string | null; shift: { startTime: string; endTime: string } | null; record: { status: string; checkIn: string | null; checkOut: string | null; lateMinutes: number; note: string | null } | null; leave: string | null }[] };
function Attendance() {
  const { tr, locale, can } = useSession();
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const { data, reload } = useResource<Board>(`/api/hr/attendance/board?date=${date}`);
  const act = useSubmit();
  const set = async (userId: string, status: string) => { if (await act.run(() => api("/api/hr/attendance", { body: { userId, date, status } }), tr("تم التسجيل", "Recorded"))) reload(); };
  const counts = (data?.rows ?? []).reduce<Record<string, number>>((m, r) => { const k = r.record?.status ?? (r.leave ? "LEAVE" : r.shift ? "MISSING" : "OFF"); m[k] = (m[k] ?? 0) + 1; return m; }, {});
  return (
    <Card>
      <div className="flex flex-wrap items-center gap-3 border-b border-line p-3">
        <Input className="w-auto" type="date" dir="ltr" value={date} onChange={(e) => setDate(e.target.value)} />
        {Object.entries(counts).map(([k, n]) => <span key={k} className="text-xs text-muted">{k === "MISSING" ? tr("لم يسجّل", "Not in") : k === "OFF" ? tr("عطلة", "Off") : l4(ATT_STATUS, k, locale)}: <b className="tabular">{n}</b></span>)}
      </div>
      <Table head={[tr("الموظف", "Employee"), tr("الدوام", "Shift"), tr("الحضور", "In"), tr("الانصراف", "Out"), tr("الحالة", "Status"), ""]}>
        {data?.rows.map((r) => (
          <Tr key={r.id}>
            <Td><p className="font-medium">{r.fullName}</p><p className="text-xs text-muted">{r.jobTitle}</p></Td>
            <Td className="text-xs text-muted tabular" dir="ltr">{r.shift ? `${r.shift.startTime}–${r.shift.endTime}` : tr("عطلة", "Off")}</Td>
            <Td className="tabular">{r.record?.checkIn ? fmtTime(r.record.checkIn, locale) : "—"}</Td>
            <Td className="tabular">{r.record?.checkOut ? fmtTime(r.record.checkOut, locale) : "—"}</Td>
            <Td>{r.record ? <Badge tone={t4(ATT_STATUS, r.record.status)}>{l4(ATT_STATUS, r.record.status, locale)}{r.record.lateMinutes ? ` ${r.record.lateMinutes}${tr("د", "m")}` : ""}</Badge> : r.leave ? <Badge tone="blue">{tr("إجازة", "Leave")} · {l4(LEAVE_TYPE, r.leave, locale)}</Badge> : r.shift ? <Badge tone="amber">{tr("لم يسجّل", "Not in")}</Badge> : "—"}</Td>
            <Td className="text-end whitespace-nowrap">{can("hr.update") && <>
              <Button size="sm" variant="ghost" onClick={() => set(r.id, "PRESENT")}>{tr("حاضر", "Present")}</Button>
              <Button size="sm" variant="ghost" className="text-danger" onClick={() => set(r.id, "ABSENT")}>{tr("غائب", "Absent")}</Button>
            </>}</Td>
          </Tr>
        ))}
      </Table>
      <p className="p-3 text-xs text-muted">{tr("يسجّل كل موظف حضوره وانصرافه من زر «الحضور» في الشريط العلوي. يُحتسب التأخير بعد 10 دقائق من بداية الدوام.", "Staff clock in/out from the top bar. Lateness counts after a 10-minute grace.")}</p>
    </Card>
  );
}

// ---------------------------------------------------------------- leaves ----
type Leave = { id: string; type: string; startDate: string; endDate: string; days: number; reason: string | null; status: string; decisionNote: string | null; userId: string; user: { fullName: string; jobTitle: string | null } };
function Leaves() {
  const { tr, locale, can, user } = useSession();
  const { data, reload } = useResource<Leave[]>("/api/hr/leaves");
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ type: "ANNUAL", startDate: "", endDate: "", reason: "" });
  const act = useSubmit();
  const decide = async (id: string, action: string) => { if (await act.run(() => api(`/api/hr/leaves/${id}`, { body: { action } }), tr("تم التحديث", "Updated"))) reload(); };
  return (
    <Card>
      <div className="flex justify-end border-b border-line p-3"><Button onClick={() => setOpen(true)}>+ {tr("طلب إجازة", "Request leave")}</Button></div>
      <Table head={[tr("الموظف", "Employee"), tr("النوع", "Type"), tr("الفترة", "Period"), tr("الأيام", "Days"), tr("السبب", "Reason"), tr("الحالة", "Status"), ""]}>
        {data?.map((l) => (
          <Tr key={l.id}>
            <Td className="font-medium">{l.user.fullName}</Td><Td>{l4(LEAVE_TYPE, l.type, locale)}</Td>
            <Td className="whitespace-nowrap text-muted">{fmtDate(l.startDate, locale)} – {fmtDate(l.endDate, locale)}</Td><Td className="tabular">{l.days}</Td>
            <Td className="text-xs text-muted">{l.reason}</Td><Td><Badge tone={t4(LEAVE_STATUS, l.status)}>{l4(LEAVE_STATUS, l.status, locale)}</Badge></Td>
            <Td className="text-end whitespace-nowrap">
              {l.status === "PENDING" && can("hr.approve") && l.userId !== user.id && <>
                <Button size="sm" loading={act.pending} onClick={() => decide(l.id, "APPROVE")}>{tr("موافقة", "Approve")}</Button>
                <Button size="sm" variant="ghost" className="text-danger" onClick={() => decide(l.id, "REJECT")}>{tr("رفض", "Reject")}</Button>
              </>}
              {["PENDING", "APPROVED"].includes(l.status) && l.userId === user.id && <Button size="sm" variant="ghost" onClick={() => decide(l.id, "CANCEL")}>{tr("سحب الطلب", "Withdraw")}</Button>}
            </Td>
          </Tr>
        ))}
      </Table>
      {data?.length === 0 && <EmptyState title={tr("لا توجد طلبات إجازة", "No leave requests")} />}
      <Modal open={open} onClose={() => setOpen(false)} title={tr("طلب إجازة", "Request leave")}
        footer={<><Button variant="secondary" onClick={() => setOpen(false)}>{tr("إلغاء", "Cancel")}</Button><Button loading={act.pending} disabled={!f.startDate || !f.endDate}
          onClick={async () => { if (await act.run(() => api("/api/hr/leaves", { body: f }), tr("تم إرسال الطلب", "Request sent"))) { setOpen(false); reload(); } }}>{tr("إرسال", "Submit")}</Button></>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={tr("النوع", "Type")}><Select value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })}>{Object.entries(LEAVE_TYPE).map(([k, v]) => <option key={k} value={k}>{tr(v.ar, v.en)}</option>)}</Select></Field>
          <div />
          <Field label={tr("من", "From")}><Input type="date" dir="ltr" value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} /></Field>
          <Field label={tr("إلى", "To")}><Input type="date" dir="ltr" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} /></Field>
          <Field label={tr("السبب", "Reason")} className="sm:col-span-2"><Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></Field>
        </div>
      </Modal>
    </Card>
  );
}

// --------------------------------------------------------------- payroll ----
type Run = { id: string; period: string; status: string; totalNet: string; approvedAt: string | null; paidAt: string | null; _count: { items: number } };
type RunFull = Run & { items: { id: string; userId: string; baseSalary: string; allowances: string; commissions: string; deductions: string; advances: string; absenceDays: string; absenceDeduction: string; net: string; note: string | null; user: { fullName: string; jobTitle: string | null } }[] };
function Payroll() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const runs = useResource<Run[]>("/api/hr/payroll");
  const [openId, setOpenId] = useState<string | null>(null);
  const run = useResource<RunFull>(openId ? `/api/hr/payroll/${openId}` : null);
  const [period, setPeriod] = useState(new Date().toISOString().slice(0, 7));
  const act = useSubmit();
  useEffect(() => { if (!openId && runs.data?.[0]) setOpenId(runs.data[0].id); }, [runs.data, openId]);
  const gen = async () => { const r = await act.run(() => api<{ id: string }>("/api/hr/payroll", { body: { period } }), tr("تم احتساب الرواتب", "Payroll calculated")); if (r) { runs.reload(); setOpenId(r.id); run.reload(); } };
  const status = async (action: string) => { if (await act.run(() => api(`/api/hr/payroll/${openId}/status`, { body: { action } }), tr("تم التحديث", "Updated"))) { runs.reload(); run.reload(); } };
  const r = run.data;
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit p-3">
        {can("hr.create") && <div className="mb-3 flex gap-2"><Input type="month" dir="ltr" value={period} onChange={(e) => setPeriod(e.target.value)} /><Button loading={act.pending} onClick={gen}>{tr("احتساب", "Run")}</Button></div>}
        <ul className="space-y-1">
          {runs.data?.map((x) => (
            <li key={x.id}><button onClick={() => setOpenId(x.id)} className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-start text-sm ${openId === x.id ? "bg-brand/10 text-brand" : "hover:bg-surface-2"}`}>
              <span dir="ltr">{x.period}</span><Badge tone={t4(PAYROLL_STATUS, x.status)}>{l4(PAYROLL_STATUS, x.status, locale)}</Badge></button></li>
          ))}
          {runs.data?.length === 0 && <li className="p-2 text-sm text-muted">{tr("لا توجد مسيرات رواتب", "No payroll runs")}</li>}
        </ul>
      </Card>
      {r ? (
        <Card>
          <div className="flex flex-wrap items-center gap-2 border-b border-line p-3">
            <p className="font-medium" dir="ltr">{r.period}</p><Badge tone={t4(PAYROLL_STATUS, r.status)}>{l4(PAYROLL_STATUS, r.status, locale)}</Badge>
            <span className="ms-auto text-sm">{tr("صافي الرواتب", "Net total")} <b className="tabular">{money(r.totalNet)}</b></span>
            {r.status === "DRAFT" && can("hr.create") && <Button size="sm" variant="secondary" loading={act.pending} onClick={() => { setPeriod(r.period); void api("/api/hr/payroll", { body: { period: r.period } }).then(() => run.reload()); }}>{tr("إعادة احتساب", "Recalculate")}</Button>}
            {r.status === "DRAFT" && can("hr.approve") && <Button size="sm" loading={act.pending} onClick={() => status("APPROVE")}>{tr("اعتماد", "Approve")}</Button>}
            {r.status === "APPROVED" && can("hr.approve") && <Button size="sm" loading={act.pending} onClick={() => status("PAID")}>{tr("تأكيد الصرف", "Mark paid")}</Button>}
          </div>
          <Table head={[tr("الموظف", "Employee"), tr("الأساسي", "Base"), tr("البدلات", "Allow."), tr("العمولات", "Comm."), tr("السلف", "Adv."), tr("الغياب", "Absence"), tr("خصومات", "Deduct."), tr("الصافي", "Net")]}>
            {r.items.map((i) => <PayrollRow key={i.id} i={i} editable={r.status === "DRAFT" && can("hr.update")} onSaved={() => { run.reload(); runs.reload(); }} />)}
          </Table>
          {r.items.length === 0 && <EmptyState title={tr("لا يوجد موظفون برواتب", "No salaried staff")} text={tr("حدد الرواتب من تبويب الموظفين ثم أعد الاحتساب.", "Set salaries in the Employees tab, then recalculate.")} />}
          <p className="p-3 text-xs text-muted">{tr("الصافي = الأساسي + البدلات + العمولات المعتمدة − السلف − الغياب (الأساسي ÷ 30 × الأيام) − الخصومات. الاعتماد يُثبّت العمولات كمدفوعة ويسوّي السلف.", "Net = base + allowances + approved commissions − advances − absence (base ÷ 30 × days) − deductions. Approval marks commissions paid and settles advances.")}</p>
        </Card>
      ) : <Card><EmptyState title={tr("اختر شهراً واحتسب الرواتب", "Pick a month and run payroll")} /></Card>}
    </div>
  );
}

function PayrollRow({ i, editable, onSaved }: { i: RunFull["items"][number]; editable: boolean; onSaved: () => void }) {
  const money = useMoney();
  const [f, setF] = useState({ allowances: String(Number(i.allowances)), deductions: String(Number(i.deductions)) });
  const act = useSubmit();
  const save = async () => { if (await act.run(() => api(`/api/hr/payroll-items/${i.id}`, { method: "PATCH", body: f }))) onSaved(); };
  return (
    <Tr>
      <Td><p className="font-medium">{i.user.fullName}</p><p className="text-xs text-muted">{i.user.jobTitle}</p></Td>
      <Td className="tabular">{money(i.baseSalary)}</Td>
      <Td>{editable ? <Input className="h-8 w-28" type="number" min={0} dir="ltr" value={f.allowances} onChange={(e) => setF({ ...f, allowances: e.target.value })} onBlur={save} /> : <span className="tabular">{money(i.allowances)}</span>}</Td>
      <Td className="tabular">{money(i.commissions)}</Td>
      <Td className="tabular text-danger">{Number(i.advances) ? `−${money(i.advances)}` : "—"}</Td>
      <Td className="tabular text-danger">{Number(i.absenceDays) ? `−${money(i.absenceDeduction)} (${Number(i.absenceDays)})` : "—"}</Td>
      <Td>{editable ? <Input className="h-8 w-28" type="number" min={0} dir="ltr" value={f.deductions} onChange={(e) => setF({ ...f, deductions: e.target.value })} onBlur={save} /> : <span className="tabular">{money(i.deductions)}</span>}</Td>
      <Td className="font-semibold tabular">{money(i.net)}</Td>
    </Tr>
  );
}

// -------------------------------------------------------------- advances ----
function Advances() {
  const { tr, locale, can } = useSession();
  const money = useMoney();
  const { data, reload } = useResource<{ id: string; amount: string; givenAt: string; note: string | null; status: string; user: { fullName: string } }[]>("/api/hr/advances");
  const emps = useResource<Emp[]>("/api/hr/employees");
  const [f, setF] = useState({ userId: "", amount: "", note: "" });
  const act = useSubmit();
  return (
    <Card>
      {can("hr.create") && (
        <form className="flex flex-wrap gap-2 border-b border-line p-3" onSubmit={async (e) => { e.preventDefault(); if (await act.run(() => api("/api/hr/advances", { body: f }), tr("تم تسجيل السلفة", "Advance recorded"))) { setF({ userId: "", amount: "", note: "" }); reload(); } }}>
          <Select className="w-auto" required value={f.userId} onChange={(e) => setF({ ...f, userId: e.target.value })}><option value="">{tr("الموظف", "Employee")}</option>{emps.data?.map((x) => <option key={x.id} value={x.id}>{x.fullName}</option>)}</Select>
          <Input className="w-36" required type="number" min={0} step="any" dir="ltr" placeholder={tr("المبلغ", "Amount")} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} />
          <Input className="min-w-0 flex-1" placeholder={tr("ملاحظة", "Note")} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
          <Button type="submit" loading={act.pending}>{tr("تسجيل سلفة", "Add advance")}</Button>
        </form>
      )}
      <Table head={[tr("الموظف", "Employee"), tr("المبلغ", "Amount"), tr("التاريخ", "Date"), tr("ملاحظة", "Note"), tr("الحالة", "Status")]}>
        {data?.map((a) => <Tr key={a.id}><Td>{a.user.fullName}</Td><Td className="tabular">{money(a.amount)}</Td><Td className="text-muted">{fmtDate(a.givenAt, locale)}</Td><Td className="text-xs text-muted">{a.note}</Td>
          <Td><Badge tone={a.status === "OPEN" ? "amber" : "green"}>{a.status === "OPEN" ? tr("تُخصم من الراتب القادم", "Open") : tr("مسواة", "Settled")}</Badge></Td></Tr>)}
      </Table>
      {data?.length === 0 && <EmptyState title={tr("لا توجد سلف", "No advances")} />}
    </Card>
  );
}

// ----------------------------------------------------------- performance ----
type Perf = { id: string; fullName: string; jobTitle: string | null; services: number; clients: number; sales: number; revenue: string; commissions: string; target: string; achievement: number | null;
  attendance: { present: number; late: number; absent: number; leave: number }; lastEvaluation: { rating: number; period: string; notes: string | null } | null };
function Performance() {
  const { tr, can } = useSession();
  const money = useMoney();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
  const range = useMemo(() => { const [y, m] = month.split("-").map(Number); return { from: new Date(Date.UTC(y, m - 1, 1)).toISOString(), to: new Date(Date.UTC(y, m, 1)).toISOString() }; }, [month]);
  const { data, reload } = useResource<Perf[]>(`/api/hr/performance?from=${range.from}&to=${range.to}`);
  const [rate, setRate] = useState<Perf | null>(null);
  return (
    <Card>
      <div className="border-b border-line p-3"><Input className="w-auto" type="month" dir="ltr" value={month} onChange={(e) => setMonth(e.target.value)} /></div>
      <Table head={[tr("الموظف", "Employee"), tr("خدمات منفذة", "Services"), tr("عملاء", "Clients"), tr("مبيعات", "Sales"), tr("الإيرادات المحققة", "Revenue"), tr("تحقيق الهدف", "Target"), tr("العمولات", "Comm."), tr("الحضور", "Attendance"), tr("التقييم", "Rating"), ""]}>
        {data?.map((p) => (
          <Tr key={p.id}>
            <Td><p className="font-medium">{p.fullName}</p><p className="text-xs text-muted">{p.jobTitle}</p></Td>
            <Td className="tabular">{p.services}</Td><Td className="tabular">{p.clients}</Td><Td className="tabular">{p.sales}</Td>
            <Td className="tabular">{money(p.revenue)}</Td>
            <Td>{p.achievement === null ? "—" : <Badge tone={p.achievement >= 100 ? "green" : p.achievement >= 70 ? "amber" : "red"}>{p.achievement}%</Badge>}</Td>
            <Td className="tabular">{money(p.commissions)}</Td>
            <Td className="text-xs tabular">{p.attendance.present + p.attendance.late}✓ {p.attendance.late ? `${p.attendance.late}⏰ ` : ""}{p.attendance.absent ? `${p.attendance.absent}✗` : ""}</Td>
            <Td>{p.lastEvaluation ? <span title={p.lastEvaluation.notes ?? ""}>{"★".repeat(p.lastEvaluation.rating)}<span className="text-muted">{"★".repeat(5 - p.lastEvaluation.rating)}</span></span> : "—"}</Td>
            <Td className="text-end">{can("hr.update") && <Button size="sm" variant="ghost" onClick={() => setRate(p)}>{tr("تقييم", "Rate")}</Button>}</Td>
          </Tr>
        ))}
      </Table>
      <RateModal p={rate} period={month} onClose={() => setRate(null)} onSaved={() => { setRate(null); reload(); }} />
    </Card>
  );
}

function RateModal({ p, period, onClose, onSaved }: { p: Perf | null; period: string; onClose: () => void; onSaved: () => void }) {
  const { tr } = useSession();
  const [rating, setRating] = useState(4);
  const [notes, setNotes] = useState("");
  const { pending, run } = useSubmit();
  return (
    <Modal open={!!p} onClose={onClose} title={`${tr("تقييم أداء", "Evaluate")} — ${p?.fullName ?? ""}`}
      footer={<><Button variant="secondary" onClick={onClose}>{tr("إلغاء", "Cancel")}</Button><Button loading={pending} onClick={async () => { if (await run(() => api("/api/hr/evaluations", { body: { userId: p!.id, period, rating, notes } }), tr("تم حفظ التقييم", "Saved"))) { setNotes(""); onSaved(); } }}>{tr("حفظ", "Save")}</Button></>}>
      <div className="space-y-3">
        <div className="flex gap-1 text-2xl" dir="ltr">{[1, 2, 3, 4, 5].map((n) => <button key={n} onClick={() => setRating(n)} className={n <= rating ? "text-amber-500" : "text-muted"} aria-label={`${n}`}>★</button>)}</div>
        <Field label={tr("ملاحظات", "Notes")}><Input value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Modal>
  );
}
