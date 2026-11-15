import { route } from "@/server/api";
import { receivePO } from "@/server/services/inventory";

export const POST = route<{ id: string }>(({ ctx, params, body }) => receivePO(ctx, params.id, body));
