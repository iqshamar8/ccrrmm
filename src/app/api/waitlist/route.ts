import { route } from "@/server/api";
import { addWaitlist, listWaitlist } from "@/server/services/appointments";

export const GET = route(({ ctx }) => listWaitlist(ctx));
export const POST = route(({ ctx, body }) => addWaitlist(ctx, body));
