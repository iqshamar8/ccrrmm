import { route } from "@/server/api";
import { setWaitlistStatus } from "@/server/services/appointments";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => setWaitlistStatus(ctx, params.id, body));
