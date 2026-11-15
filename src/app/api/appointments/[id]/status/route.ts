import { route } from "@/server/api";
import { setAppointmentStatus } from "@/server/services/appointments";

export const POST = route<{ id: string }>(({ ctx, params, body }) => setAppointmentStatus(ctx, params.id, body));
