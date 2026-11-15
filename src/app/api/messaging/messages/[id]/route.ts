import { route } from "@/server/api";
import { getMessagingSettings, listMessages, listTemplates, messageAction, messagingStats, previewTemplate, runNow, saveMessagingSettings, saveTemplate, sendToClients } from "@/server/services/messaging";

/** {action: CANCEL | RETRY} */
export const POST = route<{ id: string }>(({ ctx, params, body }) => messageAction(ctx, params.id, body));
