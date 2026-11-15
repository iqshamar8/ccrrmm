import { route } from "@/server/api";
import { setSurgeryStatus } from "@/server/services/surgeries";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setSurgeryStatus(ctx, params.id, body));
