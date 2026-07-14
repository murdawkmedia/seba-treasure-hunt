export type CaseState = "open" | "paused" | "found";
export type ZoneState = "open" | "restricted" | "hazardous" | "temporarily_closed";
export type DeploymentEnvironment = "validation" | "production";

export interface CaseStatus {
  state: CaseState;
  hours: {
    opens: string;
    closes: string;
    timezone: string;
  };
  updatedAt: string;
  nextClue: { title: string; releasesAt: string } | null;
  version: number;
}

export interface Principal {
  kind: "hunter" | "staff";
  subject: string;
  email: string | null;
}

export interface PlayerAccessState {
  accountState: "missing" | "active" | "deleted";
  profileComplete: boolean;
  privacyMediaRequired: boolean;
  privacyMediaVersion: string | null;
  waiverStatus: "pending" | "required" | "accepted";
  waiverVersion: string | null;
  participationUnlocked: boolean;
}

export interface WaiverDocumentIdentity {
  version: string;
  hash: string;
}

export interface WaiverMinorInput {
  fullName: string;
  birthYear: number;
}

export interface WaiverParticipantSnapshot {
  role: "adult" | "minor";
  fullName: string;
  birthYear: number | null;
  guardianAttested: boolean;
}

export interface WaiverReceiptState {
  jobId: string;
  status: "pending" | "sent" | "failed";
  attempts: number;
  sentAt: string | null;
}

export interface WaiverReviewRecord {
  id: string;
  subject: string;
  documentVersion: string;
  documentHash: string;
  reviewedAt: string;
}

export interface WaiverAcceptanceInput {
  reviewEventId: string;
  idempotencyKey: string;
  adultName: string;
  minors: WaiverMinorInput[];
  guardianAttested: boolean;
  documentVersion: string;
  documentHash: string;
}

export interface WaiverAcceptanceRecord {
  id: string;
  subject: string;
  documentVersion: string;
  documentHash: string;
  acceptedAt: string;
  referenceCode: string;
  participants: WaiverParticipantSnapshot[];
  receipt: WaiverReceiptState;
}

export interface WaiverReceiptJob {
  id: string;
  acceptanceId: string;
  attempts: number;
  leaseToken: string;
}

export type WaiverReceiptErrorCode =
  | "document_mismatch"
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_response_invalid";

export interface WaiverReceiptEnvelope {
  acceptance: WaiverAcceptanceRecord;
  verifiedEmail: string;
}

export type OpsWaiverReceiptResendResult =
  | { status: "queued"; acceptance: WaiverAcceptanceRecord }
  | { status: "in_progress" }
  | { status: "not_found" };

export type WaiverReceiptDeliveryResult = { status: "sent" | "failed" };

export interface LegalReceiptSender {
  deliver(acceptanceId: string): Promise<WaiverReceiptDeliveryResult>;
}

export interface IdentityLifecycleEvent {
  id: string;
  type: "user.created" | "user.updated" | "user.deleted";
  data: { subject: string; verifiedEmail: string | null };
}

export interface Page<T = Record<string, unknown>> {
  items: T[];
  nextCursor: string | null;
}

export type SponsorSupportType = "community" | "lead" | "prize_in_kind" | "other";
export type SponsorContributionRange =
  | "not_sure"
  | "under_1000"
  | "1000_2499"
  | "2500_4999"
  | "5000_plus"
  | "prefer_to_discuss";
export type SponsorInquiryState = "new" | "contacted" | "qualified" | "accepted" | "closed";

export interface SponsorInquiryCounts {
  new: number;
  contacted: number;
  qualified: number;
  accepted: number;
  closed: number;
}

export interface SponsorInquiryInput {
  contactName: string;
  organization: string;
  email: string;
  phone: string | null;
  supportType: SponsorSupportType;
  contributionRange: SponsorContributionRange | null;
  desiredOutcome: string;
  acknowledgementVersion: string;
}

export interface SponsorInquiryRecord extends SponsorInquiryInput {
  id: string;
  referenceCode: string;
  state: SponsorInquiryState;
  createdAt: string;
  updatedAt: string;
}

export interface StoredMedia {
  id: string;
  key: string;
  contentType?: string;
  size?: number;
  status: "processing" | "ready" | "quarantined";
}

export interface DataStore {
  getStatus(): Promise<CaseStatus>;
  listUpdates(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getCurrentRules(): Promise<Record<string, unknown> | null>;
  listZones(): Promise<Record<string, unknown>[]>;
  listWaypoints(): Promise<Record<string, unknown>[]>;
  listBoard(waypointId: number | null, options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getPublicMedia(id: string): Promise<{ key: string; contentType: string } | null>;
  getReportByIdempotencyKey(idempotencyKey: string): Promise<Record<string, unknown> | null>;
  createReport(input: Record<string, unknown>, idempotencyKey: string): Promise<{ value: Record<string, unknown>; replayed: boolean }>;
  getSponsorInquiryByIdempotencyKey(key: string): Promise<SponsorInquiryRecord | null>;
  createSponsorInquiry(
    input: SponsorInquiryInput,
    key: string
  ): Promise<{ value: SponsorInquiryRecord; replayed: boolean }>;
  listSponsorInquiries(options?: {
    limit?: number;
    cursor?: string | null;
    state?: SponsorInquiryState | null;
    supportType?: SponsorSupportType | null;
    query?: string | null;
  }): Promise<Page<SponsorInquiryRecord>>;
  countSponsorInquiriesByState(): Promise<SponsorInquiryCounts>;
  updateSponsorInquiry(
    id: string,
    input: { state: SponsorInquiryState; note: string | null },
    actorSubject: string
  ): Promise<SponsorInquiryRecord | null>;
  getProfile(subject: string): Promise<Record<string, unknown> | null>;
  getPlayerAccount(subject: string): Promise<Record<string, unknown> | null>;
  upsertPlayerAccount(subject: string, verifiedEmail: string): Promise<Record<string, unknown>>;
  getPlayerAccess(subject: string): Promise<PlayerAccessState>;
  recordWaiverReview(subject: string, document: WaiverDocumentIdentity): Promise<WaiverReviewRecord>;
  getWaiverReview(subject: string, reviewEventId: string): Promise<WaiverReviewRecord | null>;
  acceptParticipationWaiver(
    subject: string,
    input: WaiverAcceptanceInput
  ): Promise<{ value: WaiverAcceptanceRecord; replayed: boolean }>;
  getParticipationWaiver(subject: string): Promise<WaiverAcceptanceRecord | null>;
  queueWaiverReceiptResend(subject: string, acceptanceId: string): Promise<WaiverAcceptanceRecord | null>;
  claimWaiverReceiptJob(acceptanceId: string): Promise<WaiverReceiptJob | null>;
  getWaiverReceiptEnvelope(acceptanceId: string): Promise<WaiverReceiptEnvelope | null>;
  completeWaiverReceiptJob(
    job: WaiverReceiptJob,
    result:
      | { status: "sent"; providerMessageId: string }
      | { status: "failed"; errorCode: WaiverReceiptErrorCode }
  ): Promise<void>;
  getOpsWaiverDetail(subject: string): Promise<WaiverAcceptanceRecord | null>;
  /** Returns private detail only after its privacy-safe staff-view audit append succeeds. */
  getAndAuditOpsWaiverDetail(
    subject: string,
    actorSubject: string
  ): Promise<WaiverAcceptanceRecord | null>;
  queueOpsWaiverReceiptResend(
    subject: string,
    acceptanceId: string,
    actorSubject: string
  ): Promise<OpsWaiverReceiptResendResult>;
  applyIdentityEvent(event: IdentityLifecycleEvent): Promise<{ replayed: boolean }>;
  upsertProfile(subject: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  getMemberWaypoint(id: number): Promise<Record<string, unknown> | null>;
  upsertProgress(subject: string, waypointId: number, state: string): Promise<Record<string, unknown>>;
  getHunterDashboard(subject: string): Promise<Record<string, unknown>>;
  createFieldNote(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  createReply(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  createFlag(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  isActiveStaff(subject: string, normalizedEmail: string | null): Promise<boolean>;
  getOpsDashboard(): Promise<Record<string, unknown>>;
  updateStatus(input: Record<string, unknown>, actorSubject: string): Promise<CaseStatus>;
  createUpdate(input: Record<string, unknown>, actorSubject: string): Promise<Record<string, unknown>>;
  listReports(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  updateReport(id: string, input: Record<string, unknown>, actorSubject: string): Promise<Record<string, unknown> | null>;
  listPendingNotes(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  moderateNote(id: string, decision: string, reason: string | null, actorSubject: string): Promise<Record<string, unknown> | null>;
  listStaff(): Promise<Record<string, unknown>[]>;
  listSubscribers(options?: { limit?: number; cursor?: string | null }): Promise<{
    counts: { totalProfiles: number; huntEmail: number; marketing: number };
    items: Record<string, unknown>[];
    nextCursor: string | null;
  }>;
  listPlayers(options?: { limit?: number; cursor?: string | null }): Promise<{
    counts: { verifiedAccounts: number; completedProfiles: number; huntEmail: number; marketing: number };
    items: Record<string, unknown>[];
    nextCursor: string | null;
  }>;
  listAudit(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getStaffPrincipal(id: string): Promise<Record<string, unknown> | null>;
  recordStaffAction(action: string, target: string, actorSubject: string): Promise<Record<string, unknown>>;
  recordPlayerAction(action: string, target: string, actorSubject: string): Promise<Record<string, unknown>>;
}

export interface IdentityVerifier {
  authenticateHunter(request: Request): Promise<Principal | null>;
  authenticateStaff(request: Request): Promise<Principal | null>;
}

export interface HumanVerifier {
  verify(token: string | null, action: string, request: Request): Promise<boolean>;
}

export interface WebhookVerifier {
  verify(request: Request): Promise<IdentityLifecycleEvent | null>;
}

export interface UploadStorage {
  save(files: File[], context: { kind: "field_note" | "report"; subject: string | null }): Promise<StoredMedia[]>;
  read(key: string): Promise<{
    body: ReadableStream;
    contentType: string;
    etag: string | null;
  } | null>;
}

export interface MediaJob {
  mediaId: string;
  key: string;
  ownerKind: "field_note" | "report";
}

export interface PublicRuntimeConfig {
  deploymentEnvironment: DeploymentEnvironment | null;
  turnstileSiteKey: string | null;
  hunterPublishableKey: string | null;
  hunterAccountPortalUrl: string | null;
  staffPublishableKey: string | null;
  staffAccountPortalUrl: string | null;
}

export interface StaffAccountManager {
  execute(action: string, target: Record<string, unknown>): Promise<Record<string, unknown>>;
}

export interface RateLimitInput {
  scope: string;
  identifiers: string[];
  limit: number;
  windowSeconds: number;
}

export interface RateLimiter {
  consume(input: RateLimitInput): Promise<{ allowed: boolean; retryAfter: number }>;
}

export interface EnvironmentGuard {
  assertWritable(): Promise<void>;
}

export interface ApiDependencies {
  store: DataStore;
  identity: IdentityVerifier;
  turnstile: HumanVerifier;
  uploads: UploadStorage;
  config?: PublicRuntimeConfig;
  staffAccounts?: StaffAccountManager;
  playerAccounts?: StaffAccountManager;
  rateLimits?: RateLimiter;
  webhooks?: WebhookVerifier;
  waiverReceipts?: LegalReceiptSender;
  environment: EnvironmentGuard;
}

export interface PagesEnv {
  ASSETS: Fetcher;
  DB?: D1Database;
  UPLOADS?: R2Bucket;
  MEDIA_QUEUE?: Queue<MediaJob>;
  RATE_LIMIT_SALT?: string;
  TURNSTILE_SECRET_KEY?: string;
  TURNSTILE_SITE_KEY?: string;
  TURNSTILE_ALLOWED_HOSTS?: string;
  HUNTER_AUTH_ISSUER?: string;
  HUNTER_AUTH_JWKS_URL?: string;
  HUNTER_CLERK_PUBLISHABLE_KEY?: string;
  HUNTER_CLERK_SECRET_KEY?: string;
  HUNTER_ACCOUNT_PORTAL_URL?: string;
  CLERK_WEBHOOK_SIGNING_SECRET?: string;
  STAFF_CLERK_PUBLISHABLE_KEY?: string;
  STAFF_CLERK_SECRET_KEY?: string;
  STAFF_ACCOUNT_PORTAL_URL?: string;
  STAFF_INVITATION_REDIRECT_URL?: string;
  STAFF_AUTH_ISSUER?: string;
  STAFF_AUTH_JWKS_URL?: string;
  AUTHORIZED_PARTY?: string;
  RESEND_API_KEY?: string;
  RECOVERY_EMAIL_FROM?: string;
  LEGAL_RECEIPT_EMAIL_FROM?: string;
  LEGAL_RECEIPT_EMAIL_REPLY_TO?: string;
  DEPLOYMENT_ENV?: DeploymentEnvironment;
}
