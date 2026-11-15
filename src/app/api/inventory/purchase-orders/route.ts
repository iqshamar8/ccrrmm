import { route } from "@/server/api";
import { listPOs, savePO } from "@/server/services/inventory";

export const GET = route(({ ctx }) => listPOs(ctx));
export const POST = route(({ ctx, body }) => savePO(ctx, null, body));
