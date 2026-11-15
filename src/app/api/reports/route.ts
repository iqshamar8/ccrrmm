import { route } from "@/server/api";
import { listReports } from "@/server/services/reports";

export const GET = route(async ({ ctx }) => listReports(ctx));
