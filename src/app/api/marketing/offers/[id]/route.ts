import { route } from "@/server/api";
import { saveOffer } from "@/server/services/marketing";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => saveOffer(ctx, params.id, body));
