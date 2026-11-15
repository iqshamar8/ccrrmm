"use client";
import { useCallback, useEffect, useState } from "react";
import { api, ApiError } from "@/lib/client";
import { useToast } from "./providers";

/** Load a GET endpoint; `reload()` after mutations. */
export function useResource<T>(url: string | null) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(!!url);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    if (!url) return;
    setLoading(true);
    setError(null);
    try {
      setData(await api<T>(url));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [url]);
  useEffect(() => void load(), [load]);
  return { data, loading, error, reload: load, setData };
}

/** Submit helper: tracks pending state + field errors, toasts result. */
export function useSubmit() {
  const toast = useToast();
  const [pending, setPending] = useState(false);
  const [fields, setFields] = useState<Record<string, string>>({});
  const run = useCallback(
    async <T,>(fn: () => Promise<T>, okMsg?: string): Promise<T | undefined> => {
      setPending(true);
      setFields({});
      try {
        const r = await fn();
        if (okMsg) toast("success", okMsg);
        return r;
      } catch (e) {
        if (e instanceof ApiError && e.fields) setFields(e.fields);
        toast("error", e instanceof Error ? e.message : String(e));
        return undefined;
      } finally {
        setPending(false);
      }
    },
    [toast],
  );
  return { pending, fields, run, setFields };
}
