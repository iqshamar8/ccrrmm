import { route } from "@/server/api";
import { addRate, listRates } from "@/server/services/accounting";

export const GET = route(({ ctx }) => listRates(ctx));
export const POST = route(({ ctx, body }) => addRate(ctx, body));
