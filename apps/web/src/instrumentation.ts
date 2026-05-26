/**
 * Next.js instrumentation hook — runs at server startup.
 *
 * Imports the right Sentry init file for the runtime (Node vs Edge). The
 * client-side init (sentry.client.config.ts) is wired automatically by
 * @sentry/nextjs's build-time integration.
 *
 * NEXT_PUBLIC_SENTRY_DSN can be empty in development — both config files
 * no-op cleanly when the DSN is missing.
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("../sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("../sentry.edge.config");
  }
}

export { captureRequestError as onRequestError } from "@sentry/nextjs";
