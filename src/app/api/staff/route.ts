import { route } from "@/server/api";
import { listStaff } from "@/server/services/catalog";

export const GET = route(({ ctx }) => listStaff(ctx));
