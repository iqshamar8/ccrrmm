import { route } from "@/server/api";
import { getMessagingSettings, listMessages, listTemplates, messageAction, messagingStats, previewTemplate, runNow, saveMessagingSettings, saveTemplate, sendToClients } from "@/server/services/messaging";

export const GET = route(({ ctx, search }) => listMessages(ctx, { status: search.get("status") ?? undefined, category: search.get("category") ?? undefined, campaignId: search.get("campaignId") ?? undefined, clientId: search.get("clientId") ?? undefined, from: search.get("from") ?? undefined, to: search.get("to") ?? undefined, q: search.get("q") ?? undefined, page: Number(search.get("page") ?? 1) }));
