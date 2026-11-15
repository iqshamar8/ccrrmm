import { route } from "@/server/api";
import { listTags } from "@/server/services/clients";

export const GET = route(({ ctx }) => listTags(ctx));
