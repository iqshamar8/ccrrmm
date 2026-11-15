import { route } from "@/server/api";
import { deleteTemplate, updateTemplate } from "@/server/services/programs";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateTemplate(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteTemplate(ctx, params.id));
