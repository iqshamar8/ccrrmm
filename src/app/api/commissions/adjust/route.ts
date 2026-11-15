import { route } from "@/server/api";
import { addAdjustment } from "@/server/services/commissions";

export const POST = route(({ ctx, body }) => addAdjustment(ctx, body));
