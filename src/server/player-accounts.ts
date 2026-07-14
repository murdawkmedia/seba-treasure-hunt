import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { ApiError } from "./errors";
import type { StaffAccountManager } from "./types";

const targetSubject = (target: Record<string, unknown>) =>
  typeof target.subject === "string" && target.subject.length > 0 ? target.subject : null;
const targetEmail = (target: Record<string, unknown>) =>
  typeof target.verifiedEmail === "string" && target.verifiedEmail.includes("@")
    ? target.verifiedEmail
    : null;

export class ManagedPlayerAccounts implements StaffAccountManager {
  private readonly clerk: ClerkClient | null;

  constructor(
    secretKey: string | null,
    private readonly options: {
      dashboardUrl: string | null;
      resendApiKey: string | null;
      recoveryEmailFrom: string | null;
    }
  ) {
    this.clerk = secretKey ? createClerkClient({ secretKey }) : null;
  }

  async execute(action: string, target: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      if (action === "recovery") return await this.sendRecovery(target);
      if (action !== "revoke-sessions") {
        throw new ApiError(404, "player_action_not_found", "Player account action not found.");
      }
      if (!this.clerk) throw this.unavailable();
      const subject = targetSubject(target);
      if (!subject) throw this.unavailable();
      const sessions = await this.clerk.sessions.getSessionList({ userId: subject, limit: 100 });
      await Promise.all(sessions.data.map((session) => this.clerk!.sessions.revokeSession(session.id)));
      return { status: "sessions_revoked", count: sessions.data.length };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "provider_action_failed", "The identity provider could not complete this action.");
    }
  }

  private async sendRecovery(target: Record<string, unknown>) {
    const email = targetEmail(target);
    const { dashboardUrl, resendApiKey, recoveryEmailFrom } = this.options;
    if (!email || !dashboardUrl || !resendApiKey || !recoveryEmailFrom) throw this.unavailable();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: recoveryEmailFrom,
        to: [email],
        subject: "Tim Lost Something? account recovery",
        text: `An administrator requested account-recovery instructions for you. Open ${dashboardUrl}, choose Forgot password, and use the provider's emailed verification code. Campaign administrators cannot view or choose your password.`
      })
    });
    if (!response.ok) {
      throw new ApiError(502, "recovery_delivery_failed", "Recovery instructions could not be delivered.");
    }
    return { status: "instructions_sent" };
  }

  private unavailable() {
    return new ApiError(503, "provider_action_unavailable", "This provider-managed account action is not configured.");
  }
}
