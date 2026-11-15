import { route } from "@/server/api";
import { addEvaluation } from "@/server/services/hr";

export const POST = route(({ ctx, body }) => addEvaluation(ctx, body));
