"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useResource } from "@/components/hooks";
import { useSession } from "@/components/providers";
import { Checkbox, Field, Input, Select } from "@/components/ui";
import { api } from "@/lib/client";
import { CATEGORIES, SOURCES } from "@/lib/labels2";

export type Filter = {
  statuses?: string[]; sources?: string[]; tags?: string[]; categories?: string[]; gender?: string | null; branchIds?: string[];
  ageMin?: number | null; ageMax?: number | null; lastVisitOlderThanDays?: number | null; visitedWithinDays?: number | null; serviceIds?: string[];
  minSpend?: number | null; birthdayThisMonth?: boolean; incompleteProgram?: boolean; subscriptionExpiringDays?: number | null; influencerId?: string | null; corporateOnly?: boolean;
};

export function MarketingTabs({ active }: { active: string }) {
  const { tr } = useSession();
  const tabs: [string, string, string][] = [
    ["/marketing", tr("الحملات", "Campaigns"), "campaigns"], ["/marketing/segments", tr("شرائح العملاء", "Segments"), "segments"],
    ["/marketing/offers", tr("العروض", "Offers"), "offers"], ["/marketing/influencers", tr("المؤثرون", "Influencers"), "influencers"],
  ];
  return (
    <div className="mb-4 flex gap-1 overflow-x-auto border-b border-line">
      {tabs.map(([href, label, key]) => <Link key={key} href={href} className={`whitespace-nowrap border-b-2 px-4 py-2 text-sm ${active === key ? "border-brand font-medium text-brand" : "border-transparent text-muted hover:text-ink"}`}>{label}</Link>)}
    </div>
  );
}

const numOrNull = (v: string) => (v === "" ? null : Number(v));
function Multi({ options, value, onChange }: { options: [string, string][]; value: string[]; onChange: (v: string[]) => void }) {
  return <div className="flex flex-wrap gap-1">{options.map(([k, l]) => {
    const on = value.includes(k);
    return <button type="button" key={k} onClick={() => onChange(on ? value.filter((x) => x !== k) : [...value, k])} className={`rounded-full border px-2.5 py-0.5 text-xs ${on ? "border-brand bg-brand/10 text-brand" : "border-line text-muted hover:bg-surface-2"}`}>{l}</button>;
  })}</div>;
}

/** Audience filter editor with a live recipient count. */
export function AudienceBuilder({ value, onChange }: { value: Filter; onChange: (f: Filter) => void }) {
  const { tr, locale, can } = useSession();
  const L = (m: Record<string, { ar: string; en: string }>) => Object.entries(m).map(([k, v]) => [k, locale === "en" ? v.en : v.ar] as [string, string]);
  const branches = useResource<{ id: string; name: string }[]>(can("branches.view") ? "/api/branches" : null);
  const cat = useResource<{ services: { id: string; name: string }[] }>("/api/catalog?active=1");
  const tags = useResource<string[]>("/api/clients/tags");
  const infl = useResource<{ id: string; name: string }[]>("/api/marketing/influencers");
  const [count, setCount] = useState<{ count: number; sample: { id: string; fullName: string }[] } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBusy(true);
    const h = setTimeout(async () => { try { setCount(await api("/api/marketing/audience", { method: "POST", body: value })); } catch { setCount(null); } finally { setBusy(false); } }, 350);
    return () => clearTimeout(h);
  }, [value]);
  const set = (p: Partial<Filter>) => onChange({ ...value, ...p });
  const tagList = Array.isArray(tags.data) ? tags.data.map((t) => (typeof t === "string" ? t : (t as { tag: string }).tag)) : [];
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between rounded-lg bg-brand/5 px-3 py-2">
        <span className="text-sm">{tr("حجم الجمهور", "Audience size")}</span>
        <span className="tabular text-lg font-semibold text-brand">{busy && !count ? "…" : (count?.count ?? 0).toLocaleString()}</span>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={tr("حالة العميل", "Client status")}><Multi options={[["ACTIVE", tr("نشط", "Active")], ["INACTIVE", tr("غير نشط", "Inactive")], ["LEAD", tr("محتمل", "Lead")]]} value={value.statuses ?? ["ACTIVE"]} onChange={(v) => set({ statuses: v })} /></Field>
        <Field label={tr("الجنس", "Gender")}><Select value={value.gender ?? ""} onChange={(e) => set({ gender: e.target.value || null })}><option value="">{tr("الكل", "Any")}</option><option value="FEMALE">{tr("أنثى", "Female")}</option><option value="MALE">{tr("ذكر", "Male")}</option></Select></Field>
        <Field label={tr("المصدر", "Source")} className="sm:col-span-2"><Multi options={L(SOURCES)} value={value.sources ?? []} onChange={(v) => set({ sources: v })} /></Field>
        <Field label={tr("التصنيف", "Category")}><Multi options={L(CATEGORIES)} value={value.categories ?? []} onChange={(v) => set({ categories: v })} /></Field>
        {(branches.data?.length ?? 0) > 1 && <Field label={tr("الفرع", "Branch")}><Multi options={(branches.data ?? []).map((b) => [b.id, b.name])} value={value.branchIds ?? []} onChange={(v) => set({ branchIds: v })} /></Field>}
        {tagList.length > 0 && <Field label={tr("الوسوم", "Tags")} className="sm:col-span-2"><Multi options={tagList.slice(0, 30).map((t) => [t, t])} value={value.tags ?? []} onChange={(v) => set({ tags: v })} /></Field>}
        <Field label={tr("العمر من / إلى", "Age from / to")}><div className="flex gap-2"><Input type="number" min={0} max={120} dir="ltr" value={value.ageMin ?? ""} onChange={(e) => set({ ageMin: numOrNull(e.target.value) })} /><Input type="number" min={0} max={120} dir="ltr" value={value.ageMax ?? ""} onChange={(e) => set({ ageMax: numOrNull(e.target.value) })} /></div></Field>
        <Field label={tr("حد أدنى للإنفاق", "Minimum total spend")}><Input type="number" min={0} dir="ltr" value={value.minSpend ?? ""} onChange={(e) => set({ minSpend: numOrNull(e.target.value) })} /></Field>
        <Field label={tr("لم يزر منذ (يوم) — غير نشط", "No visit for (days) — inactive")}><Input type="number" min={1} dir="ltr" value={value.lastVisitOlderThanDays ?? ""} onChange={(e) => set({ lastVisitOlderThanDays: numOrNull(e.target.value) })} /></Field>
        <Field label={tr("زار خلال آخر (يوم)", "Visited within (days)")}><Input type="number" min={1} dir="ltr" value={value.visitedWithinDays ?? ""} onChange={(e) => set({ visitedWithinDays: numOrNull(e.target.value) })} /></Field>
        <Field label={tr("اشتراكه ينتهي خلال (يوم)", "Subscription ends within (days)")}><Input type="number" min={1} dir="ltr" value={value.subscriptionExpiringDays ?? ""} onChange={(e) => set({ subscriptionExpiringDays: numOrNull(e.target.value) })} /></Field>
        <Field label={tr("جاء عن طريق مؤثر", "Referred by influencer")}><Select value={value.influencerId ?? ""} onChange={(e) => set({ influencerId: e.target.value || null })}><option value="">{tr("الكل", "Any")}</option>{(infl.data ?? []).map((i) => <option key={i.id} value={i.id}>{i.name}</option>)}</Select></Field>
        <Field label={tr("نفذ إحدى هذه الخدمات", "Had one of these services")} className="sm:col-span-2">
          <Select multiple className="h-28" value={value.serviceIds ?? []} onChange={(e) => set({ serviceIds: [...e.target.selectedOptions].map((o) => o.value) })}>
            {(cat.data?.services ?? []).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </Select>
        </Field>
        <div className="flex flex-wrap gap-4 sm:col-span-2">
          <Checkbox label={tr("عيد ميلاده هذا الشهر", "Birthday this month")} checked={!!value.birthdayThisMonth} onChange={(e) => set({ birthdayThisMonth: e.target.checked })} />
          <Checkbox label={tr("لديه برنامج علاجي غير مكتمل", "Has an unfinished program")} checked={!!value.incompleteProgram} onChange={(e) => set({ incompleteProgram: e.target.checked })} />
          <Checkbox label={tr("موظفو الشركات المتعاقدة فقط", "Corporate beneficiaries only")} checked={!!value.corporateOnly} onChange={(e) => set({ corporateOnly: e.target.checked })} />
        </div>
      </div>
      {!!count?.sample.length && <p className="text-xs text-muted">{tr("أمثلة:", "e.g.")} {count.sample.slice(0, 6).map((c) => c.fullName).join("، ")}{count.count > 6 ? "…" : ""}</p>}
      <p className="text-xs text-muted">{tr("يُستبعد دائماً من طلب إيقاف الرسائل التسويقية.", "Clients who opted out of marketing are always excluded.")}</p>
    </div>
  );
}

export const filterSummary = (f: Filter, tr: (a: string, e: string) => string) => {
  const p: string[] = [];
  if (f.lastVisitOlderThanDays) p.push(tr(`بدون زيارة ${f.lastVisitOlderThanDays} يوم`, `no visit ${f.lastVisitOlderThanDays}d`));
  if (f.visitedWithinDays) p.push(tr(`زار خلال ${f.visitedWithinDays} يوم`, `visited ≤${f.visitedWithinDays}d`));
  if (f.sources?.length) p.push(f.sources.join(", "));
  if (f.serviceIds?.length) p.push(tr(`${f.serviceIds.length} خدمة`, `${f.serviceIds.length} services`));
  if (f.birthdayThisMonth) p.push(tr("عيد ميلاد هذا الشهر", "birthday this month"));
  if (f.incompleteProgram) p.push(tr("برنامج غير مكتمل", "unfinished program"));
  if (f.minSpend) p.push(tr(`إنفاق ≥ ${f.minSpend}`, `spend ≥ ${f.minSpend}`));
  if (f.statuses?.includes("LEAD")) p.push(tr("محتملون", "leads"));
  return p.join(" · ") || tr("كل العملاء النشطين", "All active clients");
};
