import { route } from "@/server/api";
import { getMessagingSettings, listMessages, listTemplates, messageAction, messagingStats, previewTemplate, runNow, saveMessagingSettings, saveTemplate, sendToClients } from "@/server/services/messaging";

export const GET = route(({ ctx, search }) => messagingStats(ctx, Number(search.get("days") ?? 30)));
