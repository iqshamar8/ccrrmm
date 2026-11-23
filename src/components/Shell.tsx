"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { setPref } from "@/lib/client";
import { fmtDate } from "@/lib/i18n";
import { useSession } from "./providers";
import NotificationBell from "./NotificationBell";
import ClockButton from "./ClockButton";
import LiveClock from "./LiveClock";
import MedcrmMark from "./MedcrmMark";

type NavItem = { href: string; ar: string; en: string; icon: string; show: boolean };

const ICONS: Record<string, string> = {
  home: "M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z",
  building: "M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M8 8h3M8 12h3M8 16h3M3 21h18",
  tag: "M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9z M8 8h.01",
  list: "M4 6h16M4 12h16M4 18h10",
  users: "M16 19v-1a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v1M9 10a3 3 0 1 0 0-6 3 3 0 0 0 0 6M22 19v-1a4 4 0 0 0-3-3.9M16 4.1a3 3 0 0 1 0 5.8",
  shield: "M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z",
  branch: "M12 21s-7-6-7-11a7 7 0 1 1 14 0c0 5-7 11-7 11zM12 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7 7 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  user: "M20 21v-1a5 5 0 0 0-5-5H9a5 5 0 0 0-5 5v1M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8",
  calendar: "M4 6a1 1 0 0 1 1-1h14a1 1 0 0 1 1 1v14H4zM4 10h16M8 3v4M16 3v4",
  person: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM4 21a8 8 0 0 1 16 0",
  spark: "M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z",
  door: "M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M4 21h16M14 12h.01",
  layers: "M12 3l9 5-9 5-9-5zM3 13l9 5 9-5M3 17l9 5 9-5",
  card: "M3 6a1 1 0 0 1 1-1h16a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1zM3 10h18M7 15h4",
  scalpel: "M4 20l9-9M13 11l6-6 1 1-6 6zM4 20h5",
  stetho: "M6 3v6a4 4 0 0 0 8 0V3M10 13v3a5 5 0 0 0 10 0v-2M20 12a2 2 0 1 0 0-4 2 2 0 0 0 0 4",
  megaphone: "M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1zM15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  chat: "M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12zM8 11h8M8 14h5",
  chart: "M4 20V10M10 20V4M16 20v-7M22 20H2",
  box: "M3 7l9-4 9 4v10l-9 4-9-4zM3 7l9 4 9-4M12 11v10",
  ledger: "M5 3h11l3 3v15H5zM9 8h6M9 12h6M9 16h4",
  handshake: "M8 11l3 3 5-5M3 12l4-4 4 2 3-2 4 1 3 3-7 7-4-4",
};
const Icon = ({ d, className = "size-5" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>
);

export default function Shell({ children }: { children: React.ReactNode }) {
  const s = useSession();
  const { tr, can, locale } = s;
  const path = usePathname();
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
    try { setCollapsed(localStorage.getItem("sidebar") === "1"); } catch {}
  }, []);
  useEffect(() => setMobileOpen(false), [path]);
  // Top bar gets a soft shadow once content scrolls under it.
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 4);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);

  const platform = s.user.isPlatformAdmin;
  const groups: { title?: { ar: string; en: string }; items: NavItem[] }[] = platform
    ? [
        { items: [{ href: "/", ar: "لوحة المنصة", en: "Platform overview", icon: "home", show: true }] },
        { title: { ar: "إدارة المنصة", en: "Platform" }, items: [
          { href: "/platform/tenants", ar: "المؤسسات", en: "Organizations", icon: "building", show: true },
          { href: "/platform/plans", ar: "الباقات", en: "Plans", icon: "tag", show: true },
          { href: "/platform/billing", ar: "فواتير المنصة", en: "Platform billing", icon: "card", show: true },
          { href: "/platform/audit", ar: "سجل النشاط", en: "Activity log", icon: "list", show: true },
        ] },
      ]
    : [
        { items: [{ href: "/", ar: "لوحة التحكم", en: "Dashboard", icon: "home", show: can("dashboard.view") }] },
        { title: { ar: "العمليات اليومية", en: "Operations" }, items: [
          { href: "/appointments", ar: "المواعيد", en: "Appointments", icon: "calendar", show: can("appointments.view") },
          { href: "/clients", ar: "العملاء والمرضى", en: "Clients", icon: "person", show: can("clients.view") },
          { href: "/leads", ar: "العملاء المحتملون", en: "Leads", icon: "spark", show: can("clients.view") },
          { href: "/services", ar: "الخدمات", en: "Services", icon: "tag", show: can("services.view") },
          { href: "/products", ar: "المنتجات", en: "Products", icon: "layers", show: can("services.view") && can("pos.view") },
        ] },
        { title: { ar: "العلاج والمتابعة", en: "Care & follow-up" }, items: [
          { href: "/programs", ar: "البرامج العلاجية", en: "Treatment programs", icon: "layers", show: can("programs.view") },
          { href: "/subscriptions", ar: "اشتراكات العملاء", en: "Subscriptions", icon: "card", show: can("subscriptions.view") },
          { href: "/surgeries", ar: "العمليات الجراحية", en: "Surgeries", icon: "scalpel", show: can("surgeries.view") },
          { href: "/reviews", ar: "المراجعات الطبية", en: "Medical reviews", icon: "stetho", show: can("reviews.view") },
        ] },
        { title: { ar: "المبيعات والمالية", en: "Sales & finance" }, items: [
          { href: "/pos", ar: "نقطة البيع", en: "Point of sale", icon: "card", show: can("pos.create") },
          { href: "/invoices", ar: "الفواتير والمستحقات", en: "Invoices", icon: "list", show: can("invoices.view") },
          { href: "/coupons", ar: "الكوبونات", en: "Coupons", icon: "tag", show: can("coupons.view") },
          { href: "/loyalty", ar: "نقاط الولاء", en: "Loyalty", icon: "spark", show: can("loyalty.view") },
          { href: "/corporate", ar: "الشركات المتعاقدة", en: "Corporate contracts", icon: "handshake", show: can("corporate.view") },
        ] },
        { title: { ar: "التسويق والتواصل", en: "Marketing & messaging" }, items: [
          { href: "/marketing", ar: "الحملات التسويقية", en: "Campaigns", icon: "megaphone", show: can("marketing.view") },
          { href: "/marketing/influencers", ar: "المؤثرون", en: "Influencers", icon: "spark", show: can("marketing.view") },
          { href: "/follow-ups", ar: "قوائم المتابعة", en: "Follow-up lists", icon: "phone", show: can("clients.view") },
          { href: "/notifications", ar: "الرسائل وواتساب", en: "Messages & WhatsApp", icon: "chat", show: can("notifications.view") },
          { href: "/reports", ar: "مركز التقارير", en: "Reports", icon: "chart", show: can("reports.view") },
        ] },
        { title: { ar: "المخازن والحسابات", en: "Inventory & accounts" }, items: [
          { href: "/inventory", ar: "المخازن", en: "Inventory", icon: "box", show: can("inventory.view") },
          { href: "/accounting", ar: "المحاسبة", en: "Accounting", icon: "ledger", show: can("accounting.view") },
        ] },
        { title: { ar: "الموظفون", en: "Staff" }, items: [
          { href: "/hr", ar: "الموارد البشرية", en: "HR", icon: "users", show: true },
          { href: "/commissions", ar: "العمولات", en: "Commissions", icon: "layers", show: can("commissions.view") },
        ] },
        { title: { ar: "الإدارة", en: "Administration" }, items: [
          { href: "/settings/organization", ar: "إعدادات المؤسسة", en: "Organization", icon: "gear", show: can("settings.view") },
          { href: "/settings/branches", ar: "الفروع", en: "Branches", icon: "branch", show: can("branches.view") },
          { href: "/settings/billing", ar: "الفوترة والعمولات", en: "Billing settings", icon: "card", show: can("settings.view") && can("invoices.view") },
          { href: "/settings/subscription", ar: "اشتراك المنصة", en: "Platform subscription", icon: "card", show: can("settings.view") || (s.tenant?.access === "expired" && s.user.roleKey === "tenant_admin") },
          { href: "/settings/rooms", ar: "الغرف", en: "Rooms", icon: "door", show: can("branches.view") },
          { href: "/settings/users", ar: "المستخدمون", en: "Users", icon: "users", show: can("users.view") },
          { href: "/settings/roles", ar: "الأدوار والصلاحيات", en: "Roles & permissions", icon: "shield", show: can("roles.view") },
          { href: "/settings/audit", ar: "سجل العمليات", en: "Audit log", icon: "list", show: can("audit.view") },
        ] },
      ];

  const matches = (href: string) => (href === "/" ? path === "/" : path === href || path.startsWith(href + "/"));
  // Only the most specific matching item is active (/marketing vs /marketing/influencers).
  const allHrefs = groups.flatMap((g) => g.items.filter((i) => i.show).map((i) => i.href));
  const isActive = (href: string) => matches(href) && !allHrefs.some((h) => h !== href && h.length > href.length && h.startsWith(href) && matches(h));
  const toggleCollapse = () => {
    setCollapsed((c) => {
      try { localStorage.setItem("sidebar", c ? "0" : "1"); } catch {}
      return !c;
    });
  };
  const toggleTheme = () => {
    const next = !dark;
    document.documentElement.classList.toggle("dark", next);
    setPref("theme", next ? "dark" : "light");
    setDark(next);
  };
  const toggleLocale = () => {
    setPref("locale", locale === "ar" ? "en" : "ar");
    window.location.reload();
  };
  // Sign-out is a real form post: the server clears the cookie and redirects,
  // which works on every phone browser (no reliance on fetch + JS redirect).
  const signOut = (className: string, label: React.ReactNode) => (
    <form method="post" action="/api/auth/logout">
      <button type="submit" className={className}>{label}</button>
    </form>
  );

  const sidebar = (
    <nav className="flex h-full flex-col">
      <div className="sidebar-head flex h-16 items-center gap-3 border-b border-line px-4">
        {s.tenant?.logoUrl
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={s.tenant.logoUrl} alt="" className="brand-mark size-9 rounded-lg object-cover" />
          : s.tenant
            ? <span className="brand-mark grid size-9 shrink-0 place-items-center rounded-lg bg-brand font-semibold text-white">{s.tenant.name.slice(0, 1)}</span>
            : <MedcrmMark className="medcrm-mark size-9 shrink-0" title="MedCRM" />}
        {!collapsed && (
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{s.tenant?.name ?? "MedCRM"}</p>
            <p className="truncate text-xs text-muted">{platform ? tr("مالك المنصة", "Platform owner") : (locale === "ar" ? s.tenant?.plan?.nameAr : s.tenant?.plan?.nameEn)}</p>
          </div>
        )}
      </div>
      <div className="flex-1 overflow-y-auto p-3">
        {groups.map((g, i) => {
          const items = g.items.filter((x) => x.show);
          if (!items.length) return null;
          return (
            <div key={i} className="mb-4">
              {g.title && !collapsed && <p className="mb-1 px-3 text-xs font-medium text-muted">{tr(g.title.ar, g.title.en)}</p>}
              {items.map((it) => (
                <Link key={it.href} href={it.href} title={collapsed ? tr(it.ar, it.en) : undefined} aria-current={isActive(it.href) ? "page" : undefined}
                  className={`nav-link mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${isActive(it.href) ? "bg-brand/10 font-medium text-brand" : "text-ink hover:bg-surface-2"}`}>
                  <Icon d={ICONS[it.icon]} />
                  {!collapsed && <span className="truncate">{tr(it.ar, it.en)}</span>}
                </Link>
              ))}
            </div>
          );
        })}
      </div>
      {/* Phones: a clear sign-out at the bottom of the menu */}
      <div className="border-t border-line p-3 lg:hidden">
        {signOut("flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-danger hover:bg-red-500/10",
          <><Icon d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3M10 17l5-5-5-5M15 12H4" className="size-5 rtl:rotate-180" />{tr("تسجيل الخروج", "Sign out")}</>)}
      </div>
      <button onClick={toggleCollapse} className="hidden lg:flex items-center gap-3 border-t border-line px-6 py-3 text-xs text-muted hover:text-ink">
        <Icon d={collapsed ? "M9 6l6 6-6 6" : "M15 6l-6 6 6 6"} className="size-4 rtl:rotate-180" />
        {!collapsed && tr("طي القائمة", "Collapse")}
      </button>
    </nav>
  );

  const sub = s.tenant?.subscription;
  const trialEnd = sub?.status === "TRIALING" ? sub.trialEndsAt : null;

  return (
    <div className="flex min-h-screen">
      <aside className={`hidden lg:block print:hidden sticky top-0 h-screen shrink-0 border-e border-line bg-surface transition-[width] ${collapsed ? "w-[72px]" : "w-64"}`}>
        {sidebar}
      </aside>
      {mobileOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="drawer-backdrop absolute inset-0 bg-black/40" onClick={() => setMobileOpen(false)} />
          <aside className="drawer-panel absolute inset-y-0 start-0 w-72 bg-surface shadow-xl">{sidebar}</aside>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header data-scrolled={scrolled} className="app-topbar sticky top-0 z-40 flex h-16 items-center gap-2 border-b border-line bg-surface/90 px-4 backdrop-blur print:hidden">
          <button className="rounded-lg p-2 hover:bg-surface-2 lg:hidden" onClick={() => setMobileOpen(true)} aria-label={tr("القائمة", "Menu")}>
            <Icon d="M4 6h16M4 12h16M4 18h16" />
          </button>
          <LiveClock />
          <div className="flex-1" />
          <ClockButton />
          <NotificationBell />
          <button onClick={toggleLocale} className="rounded-lg px-3 py-2 text-sm hover:bg-surface-2">{locale === "ar" ? "EN" : "ع"}</button>
          <button onClick={toggleTheme} className="rounded-lg p-2 hover:bg-surface-2" aria-label={dark ? tr("الوضع النهاري", "Day mode") : tr("الوضع الليلي", "Night mode")}>
            <Icon d={dark ? "M12 3v2M12 19v2M5 5l1.5 1.5M17.5 17.5L19 19M3 12h2M19 12h2M5 19l1.5-1.5M17.5 6.5L19 5M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8" : "M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z"} />
          </button>
          <details className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <span className="avatar-accent grid size-8 place-items-center rounded-full text-sm font-semibold">{s.user.fullName.slice(0, 1)}</span>
              <span className="hidden text-start sm:block">
                <span className="block text-sm leading-tight">{s.user.fullName}</span>
                <span className="block text-xs text-muted leading-tight">{s.user.roleName ?? tr("مالك المنصة", "Platform owner")}</span>
              </span>
            </summary>
            <div className="menu-pop absolute end-0 mt-2 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg">
              <p className="truncate px-3 py-2 text-xs text-muted" dir="ltr">{s.user.email}</p>
              <Link href="/account" className="block rounded-lg px-3 py-2 text-sm hover:bg-surface-2">{tr("حسابي وكلمة المرور", "My account")}</Link>
              {signOut("block w-full rounded-lg px-3 py-2 text-start text-sm text-danger hover:bg-surface-2", tr("تسجيل الخروج", "Sign out"))}
            </div>
          </details>
        </header>

        {s.tenant?.access === "expired" && (
          <div className="bg-red-600 px-4 py-2 text-center text-sm text-white">
            {tr("انتهى اشتراك المؤسسة. تواصل مع إدارة المنصة لتجديد الاشتراك.", "Your subscription has expired. Contact the platform team to renew.")}
          </div>
        )}
        {trialEnd && s.tenant?.access === "ok" && (
          <div className="bg-amber-500/15 px-4 py-2 text-center text-sm text-amber-800 dark:text-amber-200">
            {tr("فترة تجريبية تنتهي في", "Free trial ends on")} {fmtDate(trialEnd, locale)}
          </div>
        )}

        {/* key: replays the entrance animation on every page change */}
        <main key={path} className="app-enter mx-auto w-full max-w-7xl flex-1 p-4 sm:p-6">{children}</main>
      </div>
    </div>
  );
}
