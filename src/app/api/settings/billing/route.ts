import { route } from "@/server/api";
import { getSettings, updateSettings } from "@/server/services/settings";

export const GET = route(({ ctx }) => getSettings(ctx));
export const PATCH = route(({ ctx, body }) => updateSettings(ctx, body));
