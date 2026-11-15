import { route } from "@/server/api";
import { quickSearchClients } from "@/server/services/clients";

export const GET = route(({ ctx, search }) => quickSearchClients(ctx, search.get("q") ?? ""));
