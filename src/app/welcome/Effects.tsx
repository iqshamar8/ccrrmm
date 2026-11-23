"use client";
import { useEffect } from "react";
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
