/**
 * In-process messaging worker for single-server deployments.
 * Enable with MESSAGING_WORKER=1 (interval MESSAGING_INTERVAL_SEC, default 120).
 * Multi-instance deployments should call /api/cron/messaging from one scheduler
 * instead (sending is safe to run concurrently: rows are claimed with
 * FOR UPDATE SKIP LOCKED and automations are idempotent).
 */
import { runMessagingCycle } from "./server/services/messaging";

if (process.env.MESSAGING_WORKER === "1") {
  const every = Math.max(30, Number(process.env.MESSAGING_INTERVAL_SEC ?? 120)) * 1000;
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try { await runMessagingCycle(); } catch (e) { console.error("[messaging worker]", e); } finally { running = false; }
  };
  setTimeout(tick, 15000);
  setInterval(tick, every);
  console.log(`[messaging worker] running every ${every / 1000}s`);
}
