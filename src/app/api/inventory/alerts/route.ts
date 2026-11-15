import { route } from "@/server/api";
import { stockAlerts } from "@/server/services/inventory";

export const GET = route(({ ctx }) => stockAlerts(ctx));
