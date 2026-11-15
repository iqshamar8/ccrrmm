import { route } from "@/server/api";
import { createRoom, listRooms } from "@/server/services/catalog";

export const GET = route(({ ctx }) => listRooms(ctx));
export const POST = route(({ ctx, body }) => createRoom(ctx, body));
