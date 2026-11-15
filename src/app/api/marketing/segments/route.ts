import { route } from "@/server/api";
import { listSegments, saveSegment } from "@/server/services/marketing";

export const GET = route(({ ctx }) => listSegments(ctx));
export const POST = route(({ ctx, body }) => saveSegment(ctx, null, body));
