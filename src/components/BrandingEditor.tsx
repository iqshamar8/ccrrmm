"use client";
import { useRef, useState } from "react";
import { useSession } from "./providers";
import { DEFAULT_ACCENT, DEFAULT_PRIMARY, HEX, MAX_LOGO_CHARS, inkOn } from "@/lib/branding";

export type Branding = { logoUrl: string; primaryColor: string; accentColor: string };

/** Ready-made colour pairs (main + accent) that read well together. */
const PAIRS: { ar: string; en: string; p: string; a: string }[] = [
  { ar: "أخضر طبي", en: "Clinic green", p: "#0f766e", a: "#dcf36b" },
  { ar: "أزرق هادئ", en: "Calm blue", p: "#1d4ed8", a: "#7dd3fc" },
  { ar: "وردي تجميلي", en: "Beauty rose", p: "#be185d", a: "#fbcfe8" },
  { ar: "بنفسجي ملكي", en: "Royal plum", p: "#6d28d9", a: "#fcd34d" },
  { ar: "ذهبي فاخر", en: "Luxury gold", p: "#1f2937", a: "#d4a24c" },
  { ar: "فيروزي", en: "Teal sky", p: "#0e7490", a: "#a5f3fc" },
  { ar: "كحلي ومرجاني", en: "Navy coral", p: "#1e3a8a", a: "#fb7185" },
  { ar: "زيتوني", en: "Olive", p: "#3f6212", a: "#fde68a" },
];

/** Resize an image file in the browser to a small square-ish logo (max 256px). */
async function fileToLogo(file: File): Promise<string> {
  if (file.type === "image/svg+xml") {
    const text = await file.text();
    if (/<script|on\w+=/i.test(text)) throw new Error("svg-unsafe");
    const url = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(text)))}`;
    if (url.length > MAX_LOGO_CHARS) throw new Error("too-big");
    return url;
  }
  const src = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((ok, bad) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => bad(new Error("not-image"));
      i.src = src;
    });
    const max = 256;
    const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * k));
    const h = Math.max(1, Math.round(img.naturalHeight * k));
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    c.getContext("2d")!.drawImage(img, 0, 0, w, h);
    let out = c.toDataURL("image/webp", 0.9);
    if (!out.startsWith("data:image/webp")) out = c.toDataURL("image/png");
    if (out.length > MAX_LOGO_CHARS) throw new Error("too-big");
    return out;
  } finally {
    URL.revokeObjectURL(src);
  }
}

export function BrandingEditor({ value, onChange, name, disabled }: {
  value: Branding; onChange: (v: Branding) => void; name: string; disabled?: boolean;
}) {
  const { tr } = useSession();
  const fileRef = useRef<HTMLInputElement>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const set = (patch: Partial<Branding>) => onChange({ ...value, ...patch });
  const p = HEX.test(value.primaryColor) ? value.primaryColor : DEFAULT_PRIMARY;
  const a = HEX.test(value.accentColor) ? value.accentColor : DEFAULT_ACCENT;

  async function take(file: File | undefined) {
    if (!file) return;
    setErr(null);
    if (!/^image\/(png|jpeg|webp|svg\+xml|gif)$/.test(file.type)) { setErr(tr("اختر صورة PNG أو JPG أو WebP أو SVG", "Choose a PNG, JPG, WebP or SVG image")); return; }
    if (file.size > 5 * 1024 * 1024) { setErr(tr("الصورة أكبر من 5 ميغابايت", "The image is larger than 5 MB")); return; }
    setBusy(true);
    try {
      set({ logoUrl: await fileToLogo(file) });
    } catch (e) {
      const m = e instanceof Error ? e.message : "";
      setErr(m === "too-big" ? tr("الشعار كبير جداً بعد التصغير، جرّب صورة أبسط", "The logo is still too large, try a simpler image")
        : m === "svg-unsafe" ? tr("ملف SVG يحتوي على شيفرة غير مسموحة", "This SVG contains code that isn't allowed")
        : tr("تعذّر قراءة الصورة", "Couldn't read that image"));
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="brand-editor grid gap-6 lg:grid-cols-[1fr_300px]">
      <div className="space-y-6">
        {/* Logo */}
        <div>
          <p className="mb-2 text-sm font-medium">{tr("الشعار", "Logo")}</p>
          <div
            className={`brand-drop flex items-center gap-4 rounded-xl border-2 border-dashed p-4 transition-colors ${drag ? "border-brand bg-brand/5" : "border-line"}`}
            onDragOver={(e) => { e.preventDefault(); if (!disabled) setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); if (!disabled) take(e.dataTransfer.files?.[0]); }}
          >
            <div className="grid size-20 shrink-0 place-items-center overflow-hidden rounded-2xl bg-surface-2">
              {value.logoUrl
                // eslint-disable-next-line @next/next/no-img-element
                ? <img src={value.logoUrl} alt={tr("الشعار الحالي", "Current logo")} className="size-full object-contain" />
                : <span className="text-2xl font-bold" style={{ color: p }}>{name.slice(0, 1) || "M"}</span>}
            </div>
            <div className="min-w-0 flex-1 text-sm">
              <p className="text-muted">{tr("اسحب الصورة هنا أو اخترها من جهازك. تُصغَّر تلقائياً.", "Drop an image here or pick one. It is resized automatically.")}</p>
              <div className="mt-3 flex flex-wrap gap-2">
                <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="sr-only" id="brand-logo-file"
                  disabled={disabled || busy} onChange={(e) => take(e.target.files?.[0])} />
                <label htmlFor="brand-logo-file" className={`btn btn-primary inline-flex h-9 cursor-pointer items-center rounded-lg bg-brand px-4 text-sm font-medium text-white ${disabled || busy ? "pointer-events-none opacity-50" : ""}`}>
                  {busy ? tr("جارٍ التجهيز…", "Preparing…") : value.logoUrl ? tr("تغيير الشعار", "Change logo") : tr("رفع شعار", "Upload logo")}
                </label>
                {value.logoUrl && !disabled && (
                  <button type="button" className="btn h-9 rounded-lg px-3 text-sm text-danger hover:bg-red-500/10" onClick={() => set({ logoUrl: "" })}>
                    {tr("إزالة", "Remove")}
                  </button>
                )}
              </div>
              {err && <p role="alert" className="mt-2 text-xs text-danger">{err}</p>}
            </div>
          </div>
        </div>

        {/* Colours */}
        <div className="grid gap-4 sm:grid-cols-2">
          {([["primaryColor", tr("اللون الأساسي", "Main colour"), tr("الأزرار والقائمة والروابط", "Buttons, menu and links")],
             ["accentColor", tr("اللون الثانوي", "Accent colour"), tr("اللمسات والشارات والترحيب", "Highlights, chips and the welcome banner")]] as const).map(([key, label, hint]) => (
            <label key={key} className="block">
              <span className="mb-1.5 block text-sm font-medium">{label}</span>
              <span className="flex items-center gap-2">
                <input type="color" disabled={disabled} value={key === "primaryColor" ? p : a} onChange={(e) => set({ [key]: e.target.value })}
                  className="h-10 w-14 cursor-pointer rounded-lg border border-line bg-surface" aria-label={label} />
                <input dir="ltr" disabled={disabled} value={value[key]} onChange={(e) => set({ [key]: e.target.value.trim() })} maxLength={7}
                  className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-sm uppercase focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40" />
              </span>
              <span className="mt-1 block text-xs text-muted">{hint}</span>
              {!HEX.test(value[key]) && <span className="mt-1 block text-xs text-danger">{tr("اكتب لوناً مثل #0f766e", "Use a colour like #0f766e")}</span>}
            </label>
          ))}
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">{tr("ألوان جاهزة", "Ready-made pairs")}</p>
          <div className="flex flex-wrap gap-2">
            {PAIRS.map((x) => {
              const on = x.p.toLowerCase() === p.toLowerCase() && x.a.toLowerCase() === a.toLowerCase();
              return (
                <button key={x.p + x.a} type="button" disabled={disabled} onClick={() => set({ primaryColor: x.p, accentColor: x.a })}
                  aria-pressed={on} title={tr(x.ar, x.en)}
                  className={`brand-pair flex items-center gap-2 rounded-full border px-2 py-1.5 pe-3 text-xs transition ${on ? "border-brand ring-2 ring-brand/30" : "border-line hover:border-muted"}`}>
                  <span className="flex"><span className="size-5 rounded-full" style={{ background: x.p }} /><span className="-ms-1.5 size-5 rounded-full ring-2 ring-surface" style={{ background: x.a }} /></span>
                  {tr(x.ar, x.en)}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Live preview */}
      <div>
        <p className="mb-2 text-sm font-medium">{tr("معاينة", "Preview")}</p>
        <div className="brand-preview overflow-hidden rounded-2xl border border-line bg-bg" aria-hidden="true">
          <div className="flex items-center gap-2 border-b border-line bg-surface px-3 py-2.5"
            style={{ background: `linear-gradient(180deg, ${p}1a, ${a}10 70%, transparent)` }}>
            {value.logoUrl
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={value.logoUrl} alt="" className="size-8 rounded-lg bg-white object-contain" />
              : <span className="grid size-8 place-items-center rounded-lg text-sm font-semibold" style={{ background: p, color: inkOn(p) }}>{name.slice(0, 1) || "M"}</span>}
            <span className="truncate text-xs font-semibold">{name || "MedCRM"}</span>
          </div>
          <div className="space-y-3 p-3">
            <div className="relative overflow-hidden rounded-xl p-3 text-xs" style={{ background: p, color: inkOn(p) }}>
              <span className="absolute -end-6 -top-8 size-24 rounded-full opacity-60 blur-2xl" style={{ background: a }} />
              <p className="relative font-semibold">{tr("صباح الخير، د. سارة", "Good morning, Dr. Sara")}</p>
              <span className="relative mt-2 inline-block rounded-md px-2 py-1 font-semibold" style={{ background: a, color: inkOn(a) }}>{tr("موعد جديد", "New appointment")}</span>
            </div>
            <div className="relative overflow-hidden rounded-xl border border-line bg-surface p-3">
              <span className="absolute inset-x-0 top-0 h-[3px]" style={{ background: `linear-gradient(90deg, ${p}, ${a})` }} />
              <p className="text-[11px] text-muted">{tr("مواعيد اليوم", "Today's appointments")}</p>
              <p className="text-xl font-semibold">14</p>
            </div>
            <div className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-xs font-medium" style={{ background: `${p}1a`, color: p }}>
              <span className="h-4 w-[3px] rounded-full" style={{ background: p }} />{tr("لوحة التحكم", "Dashboard")}
            </div>
            <span className="block rounded-lg py-2 text-center text-xs font-medium" style={{ background: p, color: inkOn(p) }}>{tr("حفظ", "Save")}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
