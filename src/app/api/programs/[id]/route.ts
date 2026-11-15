import { route } from "@/server/api";
import { getProgram, updateProgram } from "@/server/services/programs";

type P = { id: string };
export const GET = route<P>(({ ctx, params }) => getProgram(ctx, params.id));
export const PATCH = route<P>(({ ctx, params, body }) => updateProgram(ctx, params.id, body));
