import { route } from "@/server/api";
import { addMedicalEntry, getMedical, saveMedicalRecord } from "@/server/services/medical";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getMedical(ctx, params.id));
/** Save the medical profile (allergies, medications, history...) */
export const PUT = route<P>(({ ctx, params, body }) => saveMedicalRecord(ctx, params.id, body));
/** Add a diagnosis / note / treatment plan / follow-up result */
export const POST = route<P>(({ ctx, params, body }) => addMedicalEntry(ctx, params.id, body));
