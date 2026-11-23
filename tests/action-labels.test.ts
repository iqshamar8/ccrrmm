/** Every audit action the server writes has a readable label (no raw "platform_invoice.issue" in the log). */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { actionLabel } from "@/lib/labels";

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? files(p) : p.endsWith(".ts") ? [p] : [];
  });
}

/** Literal action names: `action: "x.y"` and `action: cond ? "x.y" : "x.z"`. */
function usedActions(): string[] {
  const out = new Set<string>();
  for (const f of files(join(__dirname, "../src/server"))) {
    const src = readFileSync(f, "utf8");
    for (const m of src.matchAll(/action:\s*"([a-z_.]+)"/g)) out.add(m[1]);
    for (const m of src.matchAll(/action:\s*[^,"]+\?\s*"([a-z_.]+)"\s*:\s*"([a-z_.]+)"/g)) { out.add(m[1]); out.add(m[2]); }
  }
  return [...out];
}

describe("audit action labels", () => {
  it("has an Arabic label for every action the server writes", () => {
    const unlabelled = usedActions().filter((a) => actionLabel(a, "ar") === actionLabel(a, "en") && !/[؀-ۿ]/.test(actionLabel(a, "ar")));
    expect(unlabelled).toEqual([]);
  });

  it("labels the platform invoice action", () => {
    expect(actionLabel("platform_invoice.issue", "ar")).toBe("إصدار فاتورة اشتراك");
  });

  it("never shows a raw code for an unknown action", () => {
    expect(actionLabel("brand_new.thing", "en")).toBe("Brand new thing");
  });
});
