import { route } from "@/server/api";
import { updateClinical } from "@/server/services/surgeries";

export const PATCH = route<{ id: string }>(({ ctx, params, body }) => updateClinical(ctx, params.id, body));
