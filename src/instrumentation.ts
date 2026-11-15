/**
 * Optional in-process messaging worker (see instrumentation-node.ts).
 * The runtime check must wrap the import so the edge bundle never includes Node-only code.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./instrumentation-node");
  }
}
