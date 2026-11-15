import { route } from "@/server/api";
import { saveAgreement } from "@/server/services/corporate";

export const PATCH = route<{ id: string; agreementId: string }>(({ ctx, params, body }) => saveAgreement(ctx, params.id, params.agreementId, body));
