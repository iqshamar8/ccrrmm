import { route } from "@/server/api";
import { listAttendance, setAttendance } from "@/server/services/hr";

export const GET = route(({ ctx, search }) => listAttendance(ctx, { from: search.get("from") ?? "", to: search.get("to") ?? "", userId: search.get("userId") ?? undefined }));
export const POST = route(({ ctx, body }) => setAttendance(ctx, body));
