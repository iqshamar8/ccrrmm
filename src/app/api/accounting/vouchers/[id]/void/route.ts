import { route } from "@/server/api";
import { voidVoucher } from "@/server/services/accounting";

export const POST = route<{ id: string }>(({ ctx, params, body }) => voidVoucher(ctx, params.id, body));
