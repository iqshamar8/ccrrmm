import { route } from "@/server/api";
import { clock, myAttendanceToday } from "@/server/services/hr";

export const GET = route(({ ctx }) => myAttendanceToday(ctx));
export const POST = route(({ ctx, body }) => clock(ctx, body));
