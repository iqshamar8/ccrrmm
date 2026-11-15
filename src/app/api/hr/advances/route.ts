import { route } from "@/server/api";
import { createAdvance, listAdvances } from "@/server/services/hr";

export const GET = route(({ ctx }) => listAdvances(ctx));
export const POST = route(({ ctx, body }) => createAdvance(ctx, body));
