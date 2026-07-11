import { createClerkClient, type ClerkClient } from "@clerk/backend";
import { ApiError } from "./errors";
import type { StaffAccountManager } from "./types";

const targetEmail = (target: Record<string, unknown>) =>
  typeof target.email === "string" && target.email.includes("@") ? target.email : null;
const targetSubject = (target: Record<string, unknown>) =>
  typeof target.subject === "string" && target.subject.length > 0 ? target.subject : null;

export class ManagedStaffAccounts implements StaffAccountManager {
  private readonly clerk: ClerkClient | null;

  constructor(
    secretKey: string | null,
    private readonly options: {
      accountPortalUrl: string | null;
      invitationRedirectUrl: string | null;
      resendApiKey: string | null;
      recoveryEmailFrom: string | null;
    }
  ) {
    this.clerk = secretKey ? createClerkClient({ secretKey }) : null;
  }

  async execute(action: string, target: Record<string, unknown>): Promise<Record<string, unknown>> {
    try {
      if (action === "recovery") return await this.sendRecovery(target);
      if (action === "resend-invitation") return await this.resendInvitation(target);
      if (!this.clerk) throw this.unavailable();
      const subject = targetSubject(target);
      if (!subject) {
        throw new ApiError(409, "staff_account_not_activated", "This staff invitation has not been activated yet.");
      }

      if (action === "revoke-sessions") {
        const sessions = await this.clerk.sessions.getSessionList({ userId: subject, limit: 100 });
        await Promise.all(sessions.data.map((session) => this.clerk!.sessions.revokeSession(session.id)));
        return { status: "sessions_revoked", count: sessions.data.length };
      }
      if (action === "suspend") {
        await this.clerk.users.banUser(subject);
        return { status: "suspended" };
      }
      if (action === "reactivate") {
        await this.clerk.users.unbanUser(subject);
        return { status: "active" };
      }
      if (action === "reset-mfa") {
        await this.clerk.users.disableUserMFA(subject);
        return { status: "mfa_reset" };
      }
      throw new ApiError(404, "staff_action_not_found", "Staff action not found.");
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "provider_action_failed", "The identity provider could not complete this action.");
    }
  }

  private async sendRecovery(target: Record<string, unknown>) {
    const email = targetEmail(target);
    const { accountPortalUrl, resendApiKey, recoveryEmailFrom } = this.options;
    if (!email || !accountPortalUrl || !resendApiKey || !recoveryEmailFrom) throw this.unavailable();
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        authorization: `Bearer ${resendApiKey}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        from: recoveryEmailFrom,
        to: [email],
        subject: "Tim Lost Something? staff account recovery",
        text: `An administrator requested account-recovery instructions for you. Open ${accountPortalUrl} and choose Forgot password. If you did not expect this, contact another campaign administrator.`
      })
    });
    if (!response.ok) {
      throw new ApiError(502, "recovery_delivery_failed", "Recovery instructions could not be delivered.");
    }
    return { status: "instructions_sent" };
  }

  private async resendInvitation(target: Record<string, unknown>) {
    const email = targetEmail(target);
    if (!this.clerk || !email) throw this.unavailable();
    await this.clerk.invitations.createInvitation({
      emailAddress: email,
      ignoreExisting: true,
      notify: true,
      ...(this.options.invitationRedirectUrl
        ? { redirectUrl: this.options.invitationRedirectUrl }
        : {})
    });
    return { status: "invitation_sent" };
  }

  private unavailable() {
    return new ApiError(
      503,
      "provider_action_unavailable",
      "This provider-managed account action is not configured."
    );
  }
}
