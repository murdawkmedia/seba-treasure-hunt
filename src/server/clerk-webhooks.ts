import { verifyWebhook } from "@clerk/backend/webhooks";
import type { IdentityLifecycleEvent, WebhookVerifier } from "./types";

const primaryEmail = (data: Record<string, unknown>): string | null => {
  const primaryId = typeof data.primary_email_address_id === "string" ? data.primary_email_address_id : null;
  const addresses = Array.isArray(data.email_addresses) ? data.email_addresses : [];
  const primary = addresses.find(
    (candidate): candidate is Record<string, unknown> =>
      Boolean(candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).id === primaryId)
  );
  const verification = primary?.verification;
  const verified = Boolean(
    verification &&
    typeof verification === "object" &&
    (verification as Record<string, unknown>).status === "verified"
  );
  const email = primary?.email_address;
  return verified && typeof email === "string" && email.includes("@")
    ? email.trim().toLowerCase()
    : null;
};

export class ClerkWebhookVerifier implements WebhookVerifier {
  constructor(private readonly signingSecret: string | null) {}

  async verify(request: Request): Promise<IdentityLifecycleEvent | null> {
    if (!this.signingSecret) return null;
    try {
      const event = await verifyWebhook(request, { signingSecret: this.signingSecret });
      if (!(["user.created", "user.updated", "user.deleted"] as string[]).includes(event.type)) return null;
      const data = event.data as unknown as Record<string, unknown>;
      const subject = typeof data.id === "string" ? data.id : null;
      const eventId = request.headers.get("svix-id")?.trim() || null;
      if (!eventId || !subject) return null;
      return {
        id: eventId,
        type: event.type as IdentityLifecycleEvent["type"],
        data: {
          subject,
          verifiedEmail: event.type === "user.deleted" ? null : primaryEmail(data)
        }
      };
    } catch {
      return null;
    }
  }
}
