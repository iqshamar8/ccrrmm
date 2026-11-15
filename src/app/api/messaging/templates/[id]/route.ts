import { route } from "@/server/api";
import { getMessagingSettings, listMessages, listTemplates, messageAction, messagingStats, previewTemplate, runNow, saveMessagingSettings, saveTemplate, sendToClients } from "@/server/services/messaging";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveTemplate(ctx, params.id, body));
