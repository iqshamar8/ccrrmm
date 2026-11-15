import { route } from "@/server/api";
import { mergeClients } from "@/server/services/clients";

export const POST = route<{ id: string }>(({ ctx, params, body }) => mergeClients(ctx, params.id, body));
