import { route } from "@/server/api";
import { createAppointment, listAppointments } from "@/server/services/appointments";

export const GET = route(({ ctx, search }) =>
  listAppointments(ctx, {
    from: search.get("from") ?? "", to: search.get("to") ?? "",
    branchId: search.get("branchId") ?? undefined, staffId: search.get("staffId") ?? undefined,
    roomId: search.get("roomId") ?? undefined, clientId: search.get("clientId") ?? undefined, status: search.get("status") ?? undefined,
  }),
);
export const POST = route(({ ctx, body }) => createAppointment(ctx, body));
