import { rawRoute, route } from "@/server/api";
import { deleteFile, downloadFile } from "@/server/services/files";

type P = { id: string };

export const GET = rawRoute<P>(async ({ ctx, params, search }) => {
  const { meta, data } = await downloadFile(ctx, params.id);
  const inline = search.get("download") !== "1";
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": meta.mimeType,
      "Content-Length": String(data.length),
      "Content-Disposition": `${inline ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(meta.originalName)}`,
      // Never cache: on a shared front-desk PC a cached medical photo would
      // outlive the doctor's session and be served to the next user.
      "Cache-Control": "no-store, max-age=0",
      Vary: "Cookie",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    },
  });
});

export const DELETE = route<P>(({ ctx, params }) => deleteFile(ctx, params.id));
