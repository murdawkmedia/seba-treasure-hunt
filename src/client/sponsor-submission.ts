export interface SponsorAttempt {
  id: number;
  revision: number;
  idempotencyKey: string;
}

export type SponsorAttemptOutcome =
  | { kind: "success"; referenceCode: string }
  | { kind: "error"; copy: string };

export interface SponsorSubmissionUi {
  setSubmissionState(busy: boolean, unavailable: boolean): void;
  showResult(copy: string, kind: "error" | "success"): void;
  resetForm(): void;
  resetTurnstile(): void;
  showHumanError(copy: string): void;
  clearHumanError(): void;
  showHumanUnavailable(copy: string): void;
}

export interface SponsorSubmissionSnapshot {
  revision: number;
  inFlight: boolean;
  activeAttemptId: number | undefined;
  pendingIdempotencyKey: string | undefined;
  humanUnavailable: boolean;
}

interface SponsorSubmissionOptions {
  ui: SponsorSubmissionUi;
  makeIdempotencyKey: () => string;
  uncertainCopy: string;
}

const staleSuccessCopy = (referenceCode: string) =>
  `Inquiry ${referenceCode} was received for the earlier form version. Your newer edits were not included; review them before submitting again.`;
const staleErrorCopy =
  "The earlier submission was not confirmed as received. Your newer edits remain in the form; review them before submitting again.";
const successCopy = (referenceCode: string) =>
  `Inquiry ${referenceCode} was received privately. Submission does not create a sponsorship agreement.`;

export class SponsorSubmissionController {
  private revision = 0;
  private nextAttemptId = 0;
  private inFlight = false;
  private activeAttemptId: number | undefined;
  private pendingIdempotencyKey: string | undefined;
  private humanTokenValue = "";
  private humanUnavailable = true;

  constructor(private readonly options: SponsorSubmissionOptions) {
    this.syncSubmissionState();
  }

  markEdited(): void {
    this.revision += 1;
    this.pendingIdempotencyKey = undefined;
  }

  beginAttempt(): SponsorAttempt | null {
    if (this.inFlight || this.humanUnavailable || !this.humanTokenValue) return null;
    this.pendingIdempotencyKey ??= this.options.makeIdempotencyKey();
    this.nextAttemptId += 1;
    const attempt = {
      id: this.nextAttemptId,
      revision: this.revision,
      idempotencyKey: this.pendingIdempotencyKey,
    };
    this.activeAttemptId = attempt.id;
    this.inFlight = true;
    this.syncSubmissionState();
    return attempt;
  }

  async runAttempt(
    attempt: SponsorAttempt,
    request: () => Promise<SponsorAttemptOutcome>,
  ): Promise<boolean> {
    if (!this.isCurrent(attempt)) return false;
    let outcome: SponsorAttemptOutcome;
    try {
      outcome = await request();
    } catch {
      outcome = { kind: "error", copy: this.options.uncertainCopy };
    }
    if (!this.isCurrent(attempt)) return false;

    const edited = this.revision !== attempt.revision;
    try {
      this.humanTokenValue = "";
      this.options.ui.resetTurnstile();
      if (outcome.kind === "success") {
        if (edited) {
          this.options.ui.showResult(staleSuccessCopy(outcome.referenceCode), "success");
        } else {
          this.pendingIdempotencyKey = undefined;
          this.options.ui.resetForm();
          this.options.ui.showResult(successCopy(outcome.referenceCode), "success");
        }
      } else if (edited) {
        this.options.ui.showResult(staleErrorCopy, "error");
      } else {
        this.options.ui.showResult(outcome.copy, "error");
      }
    } finally {
      if (this.isCurrent(attempt)) {
        this.activeAttemptId = undefined;
        this.inFlight = false;
        this.syncSubmissionState();
      }
    }
    return true;
  }

  humanVerified(token: string): void {
    this.humanTokenValue = token.trim();
    this.humanUnavailable = this.humanTokenValue.length === 0;
    if (this.humanTokenValue) this.options.ui.clearHumanError();
    this.syncSubmissionState();
  }

  humanExpired(copy: string): void {
    this.humanTokenValue = "";
    this.options.ui.showHumanError(copy);
  }

  humanUnavailableNow(copy: string): void {
    this.humanTokenValue = "";
    this.humanUnavailable = true;
    this.options.ui.showHumanUnavailable(copy);
    this.syncSubmissionState();
  }

  humanToken(): string {
    return this.humanTokenValue;
  }

  snapshot(): SponsorSubmissionSnapshot {
    return {
      revision: this.revision,
      inFlight: this.inFlight,
      activeAttemptId: this.activeAttemptId,
      pendingIdempotencyKey: this.pendingIdempotencyKey,
      humanUnavailable: this.humanUnavailable,
    };
  }

  private isCurrent(attempt: SponsorAttempt): boolean {
    return this.inFlight && this.activeAttemptId === attempt.id;
  }

  private syncSubmissionState(): void {
    this.options.ui.setSubmissionState(this.inFlight, this.humanUnavailable);
  }
}

export const createSponsorSubmissionController = (options: SponsorSubmissionOptions) =>
  new SponsorSubmissionController(options);
