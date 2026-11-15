import { route } from "@/server/api";
import { saveAgreement } from "@/server/services/corporate";

export const POST = route<{ id: string }>(({ ctx, params, body }) => saveAgreement(ctx, params.id, null, body));
