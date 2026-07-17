import type { TransactionalMailAcceptance } from "./transactional-mail";

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
  participationBasis?: "adult" | "minor_guardian_permission" | undefined;
  fullName: string;
  birthYear: number | null;
  guardianAttested: boolean;
}

export interface WaiverReceiptState {
  jobId: string;
  status: "pending" | "sent" | "failed" | "uncertain";
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
  accountParticipationBasis?: "adult" | "minor_guardian_permission";
  accountGuardianPermissionAttested?: boolean;
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
  | "provider_response_invalid"
  | "provider_delivery_uncertain";

export type WaiverReceiptCompletion =
  | ({ status: "sent" } & TransactionalMailAcceptance)
  | { status: "failed"; errorCode: WaiverReceiptErrorCode };

export interface WaiverReceiptEnvelope {
  acceptance: WaiverAcceptanceRecord;
  verifiedEmail: string;
}

export type OpsWaiverReceiptResendResult =
  | { status: "queued"; acceptance: WaiverAcceptanceRecord }
  | { status: "in_progress" }
  | { status: "uncertain" }
  | { status: "not_found" };

export type WaiverReceiptDeliveryResult = { status: "sent" | "failed" };

export type OperatorAlertKind =
  | "operator_private_report"
  | "operator_field_note_moderation";

export interface OperatorAlertJob {
  id: string;
  kind: OperatorAlertKind;
  targetRecordId: string;
}

export interface OperatorAlertRecipientClaim {
  id: string;
  jobId: string;
  kind: OperatorAlertKind;
  targetRecordId: string;
  email: string;
  attempts: number;
  leaseToken: string;
  correlationId: string;
}

export type OperatorAlertErrorCode =
  | "provider_unavailable"
  | "provider_rejected"
  | "provider_response_invalid"
  | "provider_delivery_uncertain"
  | "recipient_invalid"
  | "configuration_error";

export type OperatorAlertRecipientCompletion =
  | ({ status: "sent" } & TransactionalMailAcceptance)
  | {
      status: "retry";
      errorCode: OperatorAlertErrorCode;
      nextAttemptAt: string;
    }
  | {
      status: "failed" | "uncertain";
      errorCode: OperatorAlertErrorCode;
    };

export interface OperatorAlertCreationResult<T = Record<string, unknown>> {
  value: T;
  operatorAlertJobId: string | null;
  replayed: boolean;
}

export interface LegalReceiptSender {
  deliver(acceptanceId: string): Promise<WaiverReceiptDeliveryResult>;
}

export type OperatorAlertDeliveryResult = {
  status: "sent" | "partial" | "failed";
  sent: number;
  failed: number;
};

export interface OperatorAlertSender {
  deliver(jobId: string): Promise<OperatorAlertDeliveryResult>;
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

export interface PendingNoteMedia {
  id: string;
  status: "processing" | "ready" | "quarantined" | "rejected" | "deleted";
  contentType: string;
  size: number;
}

export interface DataStore {
  getStatus(): Promise<CaseStatus>;
  listUpdates(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getCurrentRules(): Promise<Record<string, unknown> | null>;
  listZones(): Promise<Record<string, unknown>[]>;
  listWaypoints(): Promise<Record<string, unknown>[]>;
  listBoard(waypointId: number | null, options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getPublicMedia(id: string): Promise<{
    key: string;
    contentType: string;
    cacheControl: "immutable" | "no-store";
  } | null>;
  getReportByIdempotencyKey(idempotencyKey: string): Promise<Record<string, unknown> | null>;
  createReport(
    input: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<{
    value: Record<string, unknown>;
    replayed: boolean;
    operatorAlertJobId: string | null;
  }>;
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
  requeueWaiverReceiptForAcceptanceReplay(subject: string, acceptanceId: string): Promise<boolean>;
  queueWaiverReceiptResend(subject: string, acceptanceId: string): Promise<WaiverAcceptanceRecord | null>;
  claimWaiverReceiptJob(acceptanceId: string): Promise<WaiverReceiptJob | null>;
  getWaiverReceiptEnvelope(acceptanceId: string): Promise<WaiverReceiptEnvelope | null>;
  completeWaiverReceiptJob(
    job: WaiverReceiptJob,
    result: WaiverReceiptCompletion
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
    actorSubject: string,
    allowUncertainRetry?: boolean
  ): Promise<OpsWaiverReceiptResendResult>;
  applyIdentityEvent(event: IdentityLifecycleEvent): Promise<{ replayed: boolean }>;
  upsertProfile(subject: string, input: Record<string, unknown>): Promise<Record<string, unknown>>;
  getMemberWaypoint(id: number): Promise<Record<string, unknown> | null>;
  upsertProgress(subject: string, waypointId: number, state: string): Promise<Record<string, unknown>>;
  getHunterDashboard(subject: string): Promise<Record<string, unknown>>;
  createFieldNote(
    input: Record<string, unknown>,
    idempotencyKey: string
  ): Promise<OperatorAlertCreationResult>;
  getFieldNoteByIdempotencyKey(
    subject: string,
    idempotencyKey: string
  ): Promise<Record<string, unknown> | null>;
  claimOperatorAlertRecipients(jobId: string): Promise<OperatorAlertRecipientClaim[]>;
  completeOperatorAlertRecipient(
    claim: OperatorAlertRecipientClaim,
    result: OperatorAlertRecipientCompletion
  ): Promise<void>;
  reconcileOperatorAlertJob(jobId: string): Promise<void>;
  createReply(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  createFlag(input: Record<string, unknown>): Promise<Record<string, unknown>>;
  isActiveStaff(subject: string, normalizedEmail: string | null): Promise<boolean>;
  getOpsDashboard(): Promise<Record<string, unknown>>;
  updateStatus(input: Record<string, unknown>, actorSubject: string): Promise<CaseStatus>;
  createUpdate(input: Record<string, unknown>, actorSubject: string): Promise<Record<string, unknown>>;
  listReports(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  /** Returns private report detail only after its privacy-safe staff-view audit append succeeds. */
  getReportDetail(id: string, actorSubject: string): Promise<Record<string, unknown> | null>;
  /** Returns a scoped derivative key only after its privacy-safe staff-view audit append succeeds. */
  getReportMedia(
    reportId: string,
    mediaId: string,
    actorSubject: string
  ): Promise<{ key: string; contentType: string } | null>;
  updateReport(id: string, input: Record<string, unknown>, actorSubject: string): Promise<Record<string, unknown> | null>;
  publishReport(
    reportId: string,
    input: { title: string; body: string; mediaIds: string[] },
    actorSubject: string
  ): Promise<Record<string, unknown> | null>;
  unpublishReport(reportId: string, actorSubject: string): Promise<Record<string, unknown> | null>;
  listPendingNotes(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getFieldNoteMedia(
    noteId: string,
    mediaId: string,
    actorSubject: string
  ): Promise<{ key: string; contentType: string } | null>;
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

export interface ProductionSnapshotStore {
  summary(): Promise<Record<string, unknown> | null>;
  listReports(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getReport(id: string): Promise<Record<string, unknown> | null>;
  getReportMedia(
    reportId: string,
    mediaId: string
  ): Promise<{ key: string; contentType: string } | null>;
  listPlayers(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  listStaff(): Promise<Record<string, unknown>[]>;
  listAudit(options?: { limit?: number; cursor?: string | null }): Promise<Page>;
  getWaiver(subject: string): Promise<Record<string, unknown> | null>;
}

export interface PrivateMediaReader {
  read(key: string): Promise<{
    body: ReadableStream;
    contentType: string;
    etag: string | null;
  } | null>;
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
  operatorAlerts?: OperatorAlertSender;
  productionSnapshot?: ProductionSnapshotStore;
  productionSnapshotMedia?: PrivateMediaReader;
  environment: EnvironmentGuard;
}

export interface PagesEnv {
  ASSETS: Fetcher;
  DB?: D1Database;
  UPLOADS?: R2Bucket;
  PRODUCTION_SNAPSHOT_DB?: D1Database;
  PRODUCTION_SNAPSHOT_MEDIA?: R2Bucket;
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
  TRANSACTIONAL_EMAIL_PROVIDER?: "microsoft_graph" | "resend";
  GRAPH_CLIENT_ID?: string;
  GRAPH_TENANT_ID?: string;
  GRAPH_REFRESH_TOKEN_BOOTSTRAP?: string;
  GRAPH_TOKEN_ENCRYPTION_KEY?: string;
  GRAPH_TOKEN_KEY_VERSION?: string;
  TRANSACTIONAL_EMAIL_FROM_ADDRESS?: string;
  TRANSACTIONAL_EMAIL_FROM_NAME?: string;
  TRANSACTIONAL_EMAIL_REPLY_TO?: string;
  RESEND_API_KEY?: string;
  RECOVERY_EMAIL_FROM?: string;
  LEGAL_RECEIPT_EMAIL_FROM?: string;
  LEGAL_RECEIPT_EMAIL_REPLY_TO?: string;
  CAMPAIGN_BASE_URL?: string;
  DEPLOYMENT_ENV?: DeploymentEnvironment;
}
