import { route } from "@/server/api";
import { deleteMedicalEntry, updateMedicalEntry } from "@/server/services/medical";

type P = { id: string };
export const PATCH = route<P>(({ ctx, params, body }) => updateMedicalEntry(ctx, params.id, body));
export const DELETE = route<P>(({ ctx, params }) => deleteMedicalEntry(ctx, params.id));
