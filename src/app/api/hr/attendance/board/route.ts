import { route } from "@/server/api";
import { attendanceBoard } from "@/server/services/hr";

export const GET = route(({ ctx, search }) => attendanceBoard(ctx, { date: search.get("date") ?? undefined }));
