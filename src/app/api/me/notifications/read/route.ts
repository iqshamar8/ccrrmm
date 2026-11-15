import { route } from "@/server/api";
import { markNotificationsRead } from "@/server/services/notifications";

export const POST = route(({ ctx, body }) => markNotificationsRead(ctx, body));
