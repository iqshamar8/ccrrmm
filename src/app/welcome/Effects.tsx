"use client";
import { useEffect, useState } from "react";
import { setPref } from "@/lib/client";
import type { Locale } from "@/lib/i18n";

/** Light effects for the landing page: the cursor spotlight, the glare on the
 *  app screens, the glass bar darkening on scroll, and playing the WhatsApp
 *  conversation when it comes into view. Everything works without it. */
export function Effects() {
  useEffect(() => {
    const root = document.querySelector<HTMLElement>(".lp");
    if (!root) return;
    root.dataset.js = "";
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (reduce || e.pointerType !== "mouse") return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        root.style.setProperty("--mx", `${e.clientX}px`);
        root.style.setProperty("--my", `${e.clientY + window.scrollY}px`);
        const shot = (e.target as HTMLElement).closest<HTMLElement>(".lp-shot");
        if (shot) {
          const r = shot.getBoundingClientRect();
          shot.style.setProperty("--cx", `${e.clientX - r.left}px`);
          shot.style.setProperty("--cy", `${e.clientY - r.top}px`);
        }
      });
    };

    const bar = root.querySelector<HTMLElement>(".lp-nav__bar");
    const onScroll = () => { if (bar) bar.dataset.scrolled = String(window.scrollY > 40); };

    const io = new IntersectionObserver((entries) => {
      for (const en of entries) if (en.isIntersecting) { (en.target as HTMLElement).dataset.play = "true"; io.unobserve(en.target); }
    }, { threshold: 0.35 });
    root.querySelectorAll(".wa").forEach((el) => io.observe(el));

    window.addEventListener("pointermove", onMove, { passive: true });
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("scroll", onScroll);
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, []);
  return null;
}

export function LangToggle({ locale }: { locale: Locale }) {
  return (
    <button type="button" className="lp-lang" lang={locale === "ar" ? "en" : "ar"}
      onClick={() => { setPref("locale", locale === "ar" ? "en" : "ar"); window.location.reload(); }}>
      {locale === "ar" ? "English" : "العربية"}
    </button>
  );
}

export type LpTheme = "dark" | "light";

/** Day / night switch for the public pages. Stored in the shared "theme" cookie,
 *  so the signed-in app opens in the same mode. */
export function ThemeToggle({ initial, locale }: { initial: LpTheme; locale: Locale }) {
  const [theme, setTheme] = useState<LpTheme>(initial);
  const next: LpTheme = theme === "dark" ? "light" : "dark";
  const flip = () => {
    document.querySelectorAll<HTMLElement>(".lp").forEach((el) => { el.dataset.theme = next; });
    document.documentElement.classList.toggle("dark", next === "dark");
    setPref("theme", next);
    setTheme(next);
  };
  const isAr = locale === "ar";
  const label = next === "light" ? (isAr ? "الوضع النهاري" : "Day mode") : (isAr ? "الوضع الليلي" : "Night mode");
  return (
    <button type="button" className="lp-theme" onClick={flip} aria-label={label} title={label}>
      {theme === "dark"
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
        : <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M21 13A9 9 0 1 1 11 3a7 7 0 0 0 10 10z" /></svg>}
    </button>
  );
}
