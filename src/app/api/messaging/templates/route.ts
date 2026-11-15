import { route } from "@/server/api";
import { getMessagingSettings, listMessages, listTemplates, messageAction, messagingStats, previewTemplate, runNow, saveMessagingSettings, saveTemplate, sendToClients } from "@/server/services/messaging";

export const GET = route(({ ctx }) => listTemplates(ctx));
export const POST = route(({ ctx, body }) => saveTemplate(ctx, null, body));
