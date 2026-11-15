import { route } from "@/server/api";
import { saveProfile } from "@/server/services/hr";

export const PUT = route<{ id: string }>(({ ctx, params, body }) => saveProfile(ctx, params.id, body));
