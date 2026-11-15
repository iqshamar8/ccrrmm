import { route } from "@/server/api";
import { deleteDraft, getInvoice, updateDraft } from "@/server/services/billing";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getInvoice(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateDraft(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteDraft(ctx, params.id));
