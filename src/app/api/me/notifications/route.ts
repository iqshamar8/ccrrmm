import { route } from "@/server/api";
import { listMyNotifications } from "@/server/services/notifications";

export const GET = route(({ ctx, search }) => listMyNotifications(ctx, { unread: search.get("unread") === "1", limit: Number(search.get("limit") ?? 30) }));
