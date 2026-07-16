import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { waypointId } from "../shared/waypoints";
import { ApiError, StatusUnavailableError } from "./errors";
import { participationWaiverDocument, privacyMediaDocument, publicLegalState } from "./legal-documents";
import type {
  ApiDependencies,
  CaseState,
  PagesEnv,
  Principal,
  SponsorContributionRange,
  SponsorInquiryRecord,
  SponsorInquiryState,
  SponsorSupportType,
  StoredMedia,
  ZoneState
} from "./types";

type AppBindings = {
  Bindings: PagesEnv;
  Variables: { requestId: string };
};

const canonicalHost = "www.timlostsomething.com";
const pagesFallbackHost = "seba-treasure-hunt.pages.dev";
const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com https://clerk.timlostsomething.com https://clerk.www.timlostsomething.com https://*.clerk.accounts.dev https://*.clerk.com",
  "connect-src 'self' https://challenges.cloudflare.com https://clerk.timlostsomething.com https://clerk.www.timlostsomething.com https://*.clerk.accounts.dev https://*.clerk.com https://clerk-telemetry.com https://*.clerk-telemetry.com",
  "img-src 'self' data: blob: https://img.clerk.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "frame-src 'self' https://challenges.cloudflare.com",
  "media-src 'self'",
  "worker-src 'self' blob:",
  "upgrade-insecure-requests"
].join("; ");
const sameOriginFrameContentSecurityPolicy = contentSecurityPolicy.replace(
  "frame-ancestors 'none'",
  "frame-ancestors 'self'"
);
const cleanRoutes = new Map([
  ["/", "/index.html"],
  ["/route", "/route.html"],
  ["/interview", "/interview.html"],
  ["/start", "/start.html"],
  ["/dashboard", "/dashboard.html"],
  ["/updates", "/updates.html"],
  ["/report", "/report.html"],
  ["/sponsors", "/sponsors.html"],
  ["/rules", "/rules.html"],
  ["/privacy", "/privacy.html"],
  ["/waiver", "/waiver.html"],
  ["/community-guidelines", "/community-guidelines.html"],
  ["/clue-board", "/clue-board.html"],
  ["/ops", "/ops.html"]
]);
const staticHtmlPaths = new Set(cleanRoutes.values());
const legalFrameablePaths = new Set(["/privacy", "/privacy.html", "/waiver", "/waiver.html"]);
const privateReportMediaPath = /^\/api\/v1\/ops\/reports\/[^/]+\/media\/[^/]+$/;
const appPaths = new Set([...cleanRoutes.keys()].filter((path) => !["/", "/route", "/interview"].includes(path)));
const validReportStates = new Set([
  "received",
  "reviewing",
  "contacted",
  "escalated",
  "verified",
  "rejected",
  "resolved"
]);
const validImageTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const validSponsorSupportTypes = new Set<SponsorSupportType>([
  "community",
  "lead",
  "prize_in_kind",
  "other"
]);
const validSponsorStates = new Set<SponsorInquiryState>([
  "new",
  "contacted",
  "qualified",
  "accepted",
  "closed"
]);
const validSponsorContributionRanges = new Set<SponsorContributionRange>([
  "not_sure",
  "under_1000",
  "1000_2499",
  "2500_4999",
  "5000_plus",
  "prefer_to_discuss"
]);
const rateLimitRules = {
  report: { limit: 5, windowSeconds: 600 },
  sponsor_inquiry: { limit: 3, windowSeconds: 600 },
  profile: { limit: 10, windowSeconds: 600 },
  progress: { limit: 60, windowSeconds: 600 },
  field_note: { limit: 5, windowSeconds: 600 },
  reply: { limit: 20, windowSeconds: 600 },
  flag: { limit: 10, windowSeconds: 600 },
  waiver_review: { limit: 10, windowSeconds: 600 },
  waiver_accept: { limit: 10, windowSeconds: 600 },
  waiver_receipt: { limit: 3, windowSeconds: 600 }
} as const;
const validationNotice = `<aside class="validation-environment-notice" role="status" aria-label="Validation environment notice"><strong>Validation environment</strong><span>Test accounts and submissions will be deleted before launch.</span></aside>`;

const decorateValidationHtml = async (response: Response) => {
  const html = await response.text();
  const decorated = html.replace(/<body([^>]*)>/i, `<body$1>${validationNotice}`);
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.set("x-robots-tag", "noindex, nofollow");
  return new Response(decorated, { status: response.status, statusText: response.statusText, headers });
};

const success = (
  c: Context<AppBindings>,
  data: unknown,
  status: ContentfulStatusCode = 200,
  page?: { nextCursor: string | null }
) => {
  c.header("cache-control", "no-store");
  c.header("x-request-id", c.get("requestId"));
  return c.json(page ? { data, page } : { data }, status);
};

const fail = (c: Context<AppBindings>, error: ApiError) => {
  c.header("cache-control", "no-store");
  c.header("x-request-id", c.get("requestId"));
  if (error.code === "rate_limit_exceeded" && typeof error.details?.retryAfter === "number") {
    c.header("retry-after", String(error.details.retryAfter));
  }
  return c.json(
    {
      error: {
        code: error.code,
        message: error.message,
        requestId: c.get("requestId"),
        ...(error.details ? { details: error.details } : {})
      }
    },
    error.status as ContentfulStatusCode
  );
};

const queryLimit = (raw: string | undefined) => {
  const parsed = Number(raw ?? 25);
  return Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 50) : 25;
};

const sponsorQueryLimit = (raw: string | undefined) => {
  if (raw === undefined) return 25;
  const parsed = Number(raw);
  if (!/^\d+$/.test(raw) || !Number.isInteger(parsed) || parsed < 1 || parsed > 50) {
    throw new ApiError(422, "validation_failed", "Limit must be an integer from 1 to 50.", {
      field: "limit"
    });
  }
  return parsed;
};

const optionalSponsorState = (raw: string | undefined): SponsorInquiryState | null => {
  if (raw === undefined || raw === "") return null;
  if (!validSponsorStates.has(raw as SponsorInquiryState)) {
    throw new ApiError(422, "validation_failed", "Choose a valid sponsor state.", {
      field: "state"
    });
  }
  return raw as SponsorInquiryState;
};

const optionalSponsorSupportType = (raw: string | undefined): SponsorSupportType | null => {
  if (raw === undefined || raw === "") return null;
  if (!validSponsorSupportTypes.has(raw as SponsorSupportType)) {
    throw new ApiError(422, "validation_failed", "Choose a valid sponsor support type.", {
      field: "supportType"
    });
  }
  return raw as SponsorSupportType;
};

const sponsorQuery = (raw: string | undefined) => {
  if (raw === undefined || raw.trim() === "") return null;
  const query = raw.trim();
  if (query.length > 100) {
    throw new ApiError(422, "validation_failed", "Search must be 100 characters or fewer.", {
      field: "q"
    });
  }
  return query;
};

const sponsorCursorQuery = (raw: string | undefined) => {
  if (raw === undefined || raw === "") return null;
  try {
    if (raw.length > 500 || !/^[A-Za-z0-9_-]+$/.test(raw)) throw new Error();
    const base64 = raw.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="));
    const separator = decoded.indexOf("\n");
    const createdAt = decoded.slice(0, separator);
    const id = decoded.slice(separator + 1);
    if (separator < 1 || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !id) throw new Error();
  } catch {
    throw new ApiError(422, "validation_failed", "Sponsor inquiry cursor is invalid.", {
      field: "cursor"
    });
  }
  return raw;
};

const parseWaypoint = (raw: unknown, required = true): number | null => {
  if ((raw === undefined || raw === null || raw === "") && !required) return null;
  const parsed = waypointId(raw);
  if (parsed === null) {
    throw new ApiError(422, "invalid_waypoint", "Waypoint must be a number from 1 to 13.");
  }
  return parsed;
};

const requiredString = (
  body: Record<string, unknown>,
  key: string,
  options: { min?: number; max: number; label?: string }
) => {
  const candidate = body[key];
  const text = typeof candidate === "string" ? candidate.trim() : "";
  const min = options.min ?? 1;
  if (text.length < min || text.length > options.max) {
    throw new ApiError(
      422,
      "validation_failed",
      `${options.label ?? key} must be between ${min} and ${options.max} characters.`,
      { field: key }
    );
  }
  return text;
};

const optionalString = (body: Record<string, unknown>, key: string, max: number) => {
  const candidate = body[key];
  if (candidate === undefined || candidate === null || candidate === "") return null;
  if (typeof candidate !== "string" || candidate.trim().length > max) {
    throw new ApiError(422, "validation_failed", `${key} is invalid.`, { field: key });
  }
  return candidate.trim();
};

const publicationInput = (body: Record<string, unknown>) => {
  const allowed = new Set(["title", "body", "mediaIds"]);
  const forbidden = Object.keys(body).find((key) => !allowed.has(key));
  if (forbidden) {
    throw new ApiError(
      422,
      "publication_field_forbidden",
      "Report publication fields are derived from the private report.",
      { field: forbidden }
    );
  }
  const rawMediaIds = body.mediaIds ?? [];
  if (
    !Array.isArray(rawMediaIds) ||
    rawMediaIds.length > 3 ||
    rawMediaIds.some(
      (item) =>
        typeof item !== "string" ||
        item.trim().length < 1 ||
        item.trim().length > 200
    )
  ) {
    throw new ApiError(
      422,
      "validation_failed",
      "Select up to three report images for publication.",
      { field: "mediaIds" }
    );
  }
  const mediaIds = rawMediaIds.map((item) => item.trim());
  if (new Set(mediaIds).size !== mediaIds.length) {
    throw new ApiError(
      422,
      "validation_failed",
      "Each selected report image must be unique.",
      { field: "mediaIds" }
    );
  }
  return {
    title: requiredString(body, "title", { max: 200, label: "Title" }),
    body: requiredString(body, "body", { max: 10_000, label: "Story" }),
    mediaIds
  };
};

const email = (body: Record<string, unknown>, key: string) => {
  const candidate = requiredString(body, key, { max: 254, label: "Email" }).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(candidate)) {
    throw new ApiError(422, "validation_failed", "Enter a valid email address.", { field: key });
  }
  return candidate;
};

const numericCoordinate = (
  body: Record<string, unknown>,
  key: "latitude" | "longitude",
  min: number,
  max: number
) => {
  if (body[key] === undefined || body[key] === null || body[key] === "") return null;
  const candidate = Number(body[key]);
  if (!Number.isFinite(candidate) || candidate < min || candidate > max) {
    throw new ApiError(422, "validation_failed", `${key} is invalid.`, { field: key });
  }
  return candidate;
};

const readLimitedBody = async (request: Request, maximumBytes: number) => {
  const declared = request.headers.get("content-length");
  if (declared && /^\d+$/.test(declared) && Number(declared) > maximumBytes) {
    throw new ApiError(413, "request_too_large", "The request body is too large.");
  }
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel();
      throw new ApiError(413, "request_too_large", "The request body is too large.");
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
};

const mediaTypeEssence = (request: Request) =>
  (request.headers.get("content-type") ?? "")
    .split(";", 1)[0]
    ?.trim()
    .toLowerCase() ?? "";

const requestBody = async (request: Request, mediaType = mediaTypeEssence(request)) => {
  const contentType = request.headers.get("content-type") ?? "";
  if (mediaType === "multipart/form-data") {
    let form: FormData;
    try {
      const bytes = await readLimitedBody(request, 32 * 1024 * 1024);
      form = await new Request("https://body.invalid", {
        method: "POST",
        headers: { "content-type": contentType },
        body: bytes
      }).formData();
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(400, "invalid_body", "The multipart form could not be read.");
    }
    const body: Record<string, unknown> = {};
    for (const [key, entry] of form.entries()) {
      if (!(entry instanceof File)) body[key] = entry;
    }
    return {
      body,
      files: form.getAll("images").filter((entry): entry is File => entry instanceof File)
    };
  }
  if (mediaType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Use JSON or multipart form data.");
  }
  try {
    const bytes = await readLimitedBody(request, 64 * 1024);
    const parsed = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("not an object");
    return { body: parsed as Record<string, unknown>, files: [] as File[] };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(400, "invalid_body", "The JSON body could not be read.");
  }
};

const hasImageSignature = async (file: File) => {
  const bytes = new Uint8Array(await file.slice(0, 16).arrayBuffer());
  if (file.type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (file.type === "image/png") {
    return bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47;
  }
  if (file.type === "image/webp") {
    return (
      bytes[0] === 0x52 &&
      bytes[1] === 0x49 &&
      bytes[2] === 0x46 &&
      bytes[3] === 0x46 &&
      bytes[8] === 0x57 &&
      bytes[9] === 0x45 &&
      bytes[10] === 0x42 &&
      bytes[11] === 0x50
    );
  }
  return false;
};

const validateImages = async (files: File[]) => {
  if (files.length > 3) throw new ApiError(413, "too_many_images", "Upload at most three images.");
  for (const file of files) {
    if (!validImageTypes.has(file.type) || file.size === 0 || file.size > 10 * 1024 * 1024) {
      throw new ApiError(415, "invalid_image", "Images must be JPEG, PNG, or WebP and no larger than 10 MiB.");
    }
    if (!(await hasImageSignature(file))) {
      throw new ApiError(415, "invalid_image", "An uploaded file does not match its image type.");
    }
  }
};

const publicMedia = (input: unknown) =>
  Array.isArray(input)
    ? input.map((item) => {
        const media = item as StoredMedia;
        return { id: media.id, status: media.status };
      })
    : [];

const safeSubmission = (record: Record<string, unknown>, replayed?: boolean) => ({
  id: record.id,
  status: record.status,
  createdAt: record.createdAt,
  media: publicMedia(record.media),
  ...(replayed === undefined ? {} : { replayed })
});

const safeSponsorSubmission = (record: SponsorInquiryRecord, replayed: boolean) => ({
  referenceCode: record.referenceCode,
  state: "received" as const,
  createdAt: record.createdAt,
  replayed
});

const idempotencyKey = (request: Request) => {
  const key = request.headers.get("idempotency-key")?.trim() ?? "";
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw new ApiError(400, "idempotency_key_required", "Provide a valid Idempotency-Key header.");
  }
  return key;
};

const currentEdmontonYear = () =>
  Number(
    new Intl.DateTimeFormat("en-CA", {
      year: "numeric",
      timeZone: "America/Edmonton"
    }).format(new Date())
  );

type ParticipationBasis = "adult" | "minor_guardian_permission";

const participationBasisFrom = (value: unknown): ParticipationBasis => {
  if (value === "adult" || value === "minor_guardian_permission") return value;
  throw new ApiError(
    422,
    "participation_basis_required",
    "Choose whether you are 18 or older or participating with guardian permission."
  );
};

const requireActiveWaiverIdentity = (body: Record<string, unknown>) => {
  const version = typeof body.version === "string" ? body.version.trim() : "";
  const hash = typeof body.hash === "string" ? body.hash.trim().toLowerCase() : "";
  if (version !== participationWaiverDocument.version || hash !== participationWaiverDocument.hash) {
    throw new ApiError(
      409,
      "waiver_document_outdated",
      "The participation waiver changed. Review the current version before continuing."
    );
  }
  return { version, hash };
};

const waiverMinors = (body: Record<string, unknown>) => {
  if (!Array.isArray(body.minors) || body.minors.length > 10) {
    throw new ApiError(422, "waiver_participants_invalid", "List no more than ten supervised minors.");
  }
  const currentYear = currentEdmontonYear();
  const oldestMinorYear = currentYear - 18;
  const minors = body.minors.map((candidate, index) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ApiError(422, "waiver_participants_invalid", "Each supervised minor must include a name and birth year.", {
        field: `minors.${index}`
      });
    }
    const value = candidate as Record<string, unknown>;
    const fullName = typeof value.fullName === "string" ? value.fullName.trim() : "";
    const birthYear = value.birthYear;
    if (
      fullName.length < 1 ||
      fullName.length > 100 ||
      !Number.isInteger(birthYear) ||
      (birthYear as number) < oldestMinorYear ||
      (birthYear as number) > currentYear
    ) {
      throw new ApiError(422, "waiver_participants_invalid", "Each supervised minor must include a valid name and minor birth year.", {
        field: `minors.${index}`
      });
    }
    return { fullName, birthYear: birthYear as number };
  });
  if (minors.length > 0 && body.guardianAttested !== true) {
    throw new ApiError(
      422,
      "guardian_attestation_required",
      "Confirm that you are the parent or legal guardian of each listed minor."
    );
  }
  return minors;
};

const scheduleWaiverReceipt = (
  c: Context<AppBindings>,
  sender: ApiDependencies["waiverReceipts"],
  acceptanceId: string
) => {
  if (!sender) return;
  const delivery = Promise.resolve()
    .then(() => sender.deliver(acceptanceId))
    .catch(() => ({ status: "failed" as const }));
  try {
    c.executionCtx.waitUntil(delivery);
  } catch {
    void delivery;
  }
};

const scheduleOperatorAlert = (
  c: Context<AppBindings>,
  sender: ApiDependencies["operatorAlerts"],
  jobId: string | null,
) => {
  if (!sender || !jobId) return;
  const delivery = Promise.resolve()
    .then(() => sender.deliver(jobId))
    .catch(() => ({ status: "failed" as const, sent: 0, failed: 0 }));
  try {
    c.executionCtx.waitUntil(delivery);
  } catch {
    void delivery;
  }
};

const sameOrigin = (request: Request) => {
  const raw = request.headers.get("origin")?.trim() ?? "";
  let origin: URL;
  try {
    if (!raw || raw === "null") throw new Error("missing origin");
    origin = new URL(raw);
  } catch {
    throw new ApiError(403, "origin_rejected", "The request origin is not allowed.");
  }

  const serializedOrigin = origin.origin;
  const isCanonical = raw === `https://${canonicalHost}`;
  const isLocalDevelopment =
    raw === serializedOrigin &&
    ["localhost", "127.0.0.1"].includes(origin.hostname) &&
    ["http:", "https:"].includes(origin.protocol);
  const previewSuffix = `.${pagesFallbackHost}`;
  const isScopedPagesPreview =
    raw === serializedOrigin &&
    origin.protocol === "https:" &&
    origin.port === "" &&
    origin.hostname.length > previewSuffix.length &&
    origin.hostname.endsWith(previewSuffix);

  if (!isCanonical && !isLocalDevelopment && !isScopedPagesPreview) {
    throw new ApiError(403, "origin_rejected", "The request origin is not allowed.");
  }
};

const requireJsonMediaType = (request: Request) => {
  const mediaType = mediaTypeEssence(request);
  if (mediaType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", "Sponsor inquiries accept application/json only.");
  }
  return mediaType;
};

const requireHunter = async (deps: ApiDependencies, request: Request) => {
  const principal = await deps.identity.authenticateHunter(request);
  if (!principal) throw new ApiError(401, "hunter_auth_required", "Sign in as a hunter to continue.");
  return principal;
};

const optionalHunter = async (deps: ApiDependencies, request: Request) => {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const principal = await deps.identity.authenticateHunter(request);
  if (!principal) throw new ApiError(401, "invalid_hunter_session", "The hunter session is invalid.");
  return principal;
};

const requireStaff = async (deps: ApiDependencies, request: Request) => {
  const principal = await deps.identity.authenticateStaff(request);
  if (!principal) throw new ApiError(401, "staff_auth_required", "Sign in through the staff account portal.");
  if (!(await deps.store.isActiveStaff(principal.subject, principal.email))) {
    throw new ApiError(403, "staff_access_revoked", "This staff identity is not active.");
  }
  return principal;
};

const verifyHuman = async (
  deps: ApiDependencies,
  request: Request,
  body: Record<string, unknown>,
  action: string
) => {
  const bodyToken = typeof body.cfTurnstileResponse === "string" ? body.cfTurnstileResponse : null;
  const token = request.headers.get("cf-turnstile-response") ?? bodyToken;
  if (!(await deps.turnstile.verify(token, action, request))) {
    throw new ApiError(400, "human_verification_failed", "Complete the human verification and try again.");
  }
};

const applyRateLimit = async (
  deps: ApiDependencies,
  request: Request,
  scope: keyof typeof rateLimitRules,
  principal: Principal | null
) => {
  if (!deps.rateLimits) {
    throw new ApiError(
      503,
      "rate_limit_unavailable",
      "Abuse protection is temporarily unavailable. Try again later."
    );
  }
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() || "client-unavailable";
  const identifiers = [`ip:${clientIp}`];
  if (principal) identifiers.push(`subject:${principal.subject}`);
  const result = await deps.rateLimits.consume({
    scope,
    identifiers,
    ...rateLimitRules[scope]
  });
  if (!result.allowed) {
    throw new ApiError(429, "rate_limit_exceeded", "Too many requests. Try again later.", {
      retryAfter: result.retryAfter
    });
  }
};

const ensureOpenForWrites = async (deps: ApiDependencies) => {
  let status;
  try {
    status = await deps.store.getStatus();
  } catch {
    throw new StatusUnavailableError();
  }
  if (status.state !== "open") {
    throw new ApiError(423, "hunt_read_only", "Hunter activity is read-only while the hunt is not open.");
  }
};

const requireHunterProfile = async (deps: ApiDependencies, principal: Principal) => {
  const profile = await deps.store.getProfile(principal.subject);
  if (!profile) {
    throw new ApiError(409, "profile_required", "Complete your hunter profile to unlock member tools.");
  }
  return profile;
};

const requireParticipationAccess = async (deps: ApiDependencies, principal: Principal) => {
  const access = await deps.store.getPlayerAccess(principal.subject);
  if (!access.profileComplete) {
    throw new ApiError(409, "profile_required", "Complete your hunter profile to unlock member tools.");
  }
  if (access.accountState !== "active") {
    throw new ApiError(403, "player_account_inactive", "Your player account is not active.");
  }
  if (access.privacyMediaRequired) {
    throw new ApiError(
      428,
      "privacy_media_acceptance_required",
      "Accept the current Privacy Policy & Media Notice to continue."
    );
  }
  if (access.waiverStatus !== "accepted") {
    throw new ApiError(
      423,
      "participation_waiver_required",
      "Accept the current participation waiver to unlock exact directions and participation tools."
    );
  }
  if (!access.participationUnlocked) {
    throw new ApiError(423, "participation_locked", "Participation tools are currently locked.");
  }
  return access;
};

const ensureFeature = async (
  deps: ApiDependencies,
  feature: "boardVisible" | "notesEnabled" | "repliesEnabled"
) => {
  try {
    const dashboard = await deps.store.getOpsDashboard();
    const switches = dashboard.killSwitches as Record<string, unknown> | undefined;
    if (switches?.[feature] === false) {
      throw new ApiError(423, "feature_disabled", "This community feature is temporarily unavailable.");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(503, "feature_state_unavailable", "This community feature is temporarily unavailable.");
  }
};

const unsafeReply = (body: string) => {
  const patterns = [
    /<[^>]+>/,
    /\[[^\]]+]\([^\s)]+\)/,
    /https?:\/\/|www\./i,
    /\b[^\s@]+@[^\s@]+\.[^\s@]+\b/i,
    /\+?\d[\d ()-]{7,}\d/,
    /[-+]?\d{1,3}\.\d{4,}\s*[, ]\s*[-+]?\d{1,3}\.\d{4,}/,
    /\b(?:case (?:open|found)|hunt paused|official clue)\b/i
  ];
  return patterns.some((pattern) => pattern.test(body));
};

export const createApi = (deps: ApiDependencies) => {
  const app = new Hono<AppBindings>();

  app.use("*", async (c, next) => {
    c.set("requestId", crypto.randomUUID());
    const url = new URL(c.req.url);
    const isApex = url.hostname === "timlostsomething.com";
    const insecureCanonical = url.hostname === canonicalHost && url.protocol !== "https:";
    const isFallbackApp = url.hostname === pagesFallbackHost && appPaths.has(url.pathname.replace(/\/$/, ""));
    if (isApex || insecureCanonical || isFallbackApp) {
      url.protocol = "https:";
      url.hostname = canonicalHost;
      url.port = "";
      const status = c.req.method === "GET" || c.req.method === "HEAD" ? 301 : 308;
      return Response.redirect(url.toString(), status);
    }
    await next();
    const sameOriginFrameable = legalFrameablePaths.has(url.pathname.replace(/\/$/, ""));
    c.header(
      "Content-Security-Policy",
      privateReportMediaPath.test(url.pathname)
        ? "default-src 'none'; sandbox"
        : sameOriginFrameable
          ? sameOriginFrameContentSecurityPolicy
          : contentSecurityPolicy
    );
    c.header("Referrer-Policy", "strict-origin-when-cross-origin");
    c.header("X-Content-Type-Options", "nosniff");
    c.header("X-Frame-Options", sameOriginFrameable ? "SAMEORIGIN" : "DENY");
    c.header("Permissions-Policy", "camera=(), microphone=(), geolocation=(self)");
    c.header("Cross-Origin-Opener-Policy", "same-origin-allow-popups");
    if (url.protocol === "https:") {
      c.header("Strict-Transport-Security", "max-age=31536000");
    }
    if (deps.config?.deploymentEnvironment === "validation") {
      c.header("X-Robots-Tag", "noindex, nofollow");
    }
  });

  app.use("/api/v1/*", async (c, next) => {
    if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
      await deps.environment.assertWritable();
    }
    await next();
  });

  app.get("/api/v1/config", (c) =>
    success(
      c,
      {
        ...(deps.config ?? {
          deploymentEnvironment: null,
          turnstileSiteKey: null,
          hunterPublishableKey: null,
          hunterAccountPortalUrl: null,
          staffPublishableKey: null,
          staffAccountPortalUrl: null
        }),
        ...publicLegalState()
      }
    )
  );

  app.get("/api/v1/legal/waiver", (c) => success(c, participationWaiverDocument));

  app.post("/api/v1/webhooks/clerk", async (c) => {
    if (!deps.webhooks) {
      throw new ApiError(503, "webhook_unavailable", "The identity webhook is not configured.");
    }
    const event = await deps.webhooks.verify(c.req.raw);
    if (!event) {
      throw new ApiError(400, "invalid_webhook_signature", "The identity webhook could not be verified.");
    }
    const result = await deps.store.applyIdentityEvent(event);
    return success(c, { status: result.replayed ? "replayed" : "processed" }, result.replayed ? 200 : 202);
  });

  app.get("/api/v1/status", async (c) => {
    try {
      return success(c, await deps.store.getStatus());
    } catch {
      throw new StatusUnavailableError();
    }
  });

  app.get("/api/v1/updates", async (c) => {
    const result = await deps.store.listUpdates({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });

  app.get("/api/v1/rules/current", async (c) => success(c, await deps.store.getCurrentRules()));
  app.get("/api/v1/zones", async (c) => success(c, await deps.store.listZones()));
  app.get("/api/v1/waypoints", async (c) => success(c, await deps.store.listWaypoints()));

  app.get("/api/v1/board", async (c) => {
    await ensureFeature(deps, "boardVisible");
    const requested = c.req.query("waypoint") ?? "all";
    const waypointId = requested === "all" ? null : parseWaypoint(requested);
    const result = await deps.store.listBoard(waypointId, {
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });

  app.get("/api/v1/media/:id", async (c) => {
    const authorized = await deps.store.getPublicMedia(c.req.param("id"));
    if (!authorized) throw new ApiError(404, "media_not_found", "Media not found.");
    const object = await deps.uploads.read(authorized.key);
    if (!object) throw new ApiError(404, "media_not_found", "Media not found.");
    const allowedType = new Set(["image/jpeg", "image/png", "image/webp"]);
    const contentType = allowedType.has(object.contentType) ? object.contentType : authorized.contentType;
    if (!allowedType.has(contentType)) {
      throw new ApiError(404, "media_not_found", "Media not found.");
    }
    const headers = new Headers({
      "content-type": contentType,
      "cache-control": authorized.cacheControl === "no-store"
        ? "no-store"
        : "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "same-origin"
    });
    if (object.etag) headers.set("etag", object.etag.startsWith('"') ? object.etag : `"${object.etag}"`);
    return new Response(object.body, { status: 200, headers });
  });

  app.post("/api/v1/reports", async (c) => {
    sameOrigin(c.req.raw);
    const key = idempotencyKey(c.req.raw);
    const existing = await deps.store.getReportByIdempotencyKey(key);
    if (existing) return success(c, safeSubmission(existing, true));
    const hunter = await optionalHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "report", hunter);
    const { body, files } = await requestBody(c.req.raw);
    await verifyHuman(deps, c.req.raw, body, "report");
    await validateImages(files);
    const type = requiredString(body, "type", { max: 10 }).toLowerCase();
    if (!["find", "tip", "safety"].includes(type)) {
      throw new ApiError(422, "validation_failed", "Report type must be find, tip, or safety.", {
        field: "type"
      });
    }
    if (type === "find" && files.length === 0) {
      throw new ApiError(422, "photo_required", "A photo is required for a find report.");
    }
    if (type === "find") {
      try {
        if ((await deps.store.getStatus()).state === "found") {
          throw new ApiError(423, "find_reports_closed", "Find claims are closed because the case is marked found.");
        }
      } catch (error) {
        if (error instanceof ApiError) throw error;
        // Private reporting remains available when public status is unavailable.
      }
    }
    const media = await deps.uploads.save(files, { kind: "report", subject: hunter?.subject ?? null });
    const capture = await deps.store.createReport(
      {
        type,
        hunterSubject: hunter?.subject ?? null,
        name: requiredString(body, "name", { max: 100, label: "Name" }),
        email: email(body, "email"),
        phone: optionalString(body, "phone", 40),
        waypointId: parseWaypoint(body.waypointId, false),
        locationDescription: requiredString(body, "locationDescription", {
          max: 500,
          label: "Location description"
        }),
        latitude: numericCoordinate(body, "latitude", -90, 90),
        longitude: numericCoordinate(body, "longitude", -180, 180),
        details: requiredString(body, "details", { max: 4_000, label: "Details" }),
        media
      },
      key
    );
    const response = safeSubmission(capture.value, capture.replayed);
    if (publicMedia(capture.value.media).length === 0 && media.length > 0) response.media = publicMedia(media);
    scheduleOperatorAlert(c, deps.operatorAlerts, capture.operatorAlertJobId);
    return success(c, response, capture.replayed ? 200 : 201);
  });

  app.post("/api/v1/sponsors/inquiries", async (c) => {
    sameOrigin(c.req.raw);
    const key = idempotencyKey(c.req.raw);
    const existing = await deps.store.getSponsorInquiryByIdempotencyKey(key);
    if (existing) return success(c, safeSponsorSubmission(existing, true));

    await applyRateLimit(deps, c.req.raw, "sponsor_inquiry", null);
    const mediaType = requireJsonMediaType(c.req.raw);
    const { body } = await requestBody(c.req.raw, mediaType);
    await verifyHuman(deps, c.req.raw, body, "sponsor_inquiry");

    if (body.acknowledgementAccepted !== true) {
      throw new ApiError(
        422,
        "acknowledgement_required",
        "Accept the current privacy acknowledgement to continue.",
        { field: "acknowledgementAccepted" }
      );
    }
    if (body.acknowledgementVersion !== privacyMediaDocument.version) {
      throw new ApiError(
        409,
        "privacy_version_outdated",
        "The privacy acknowledgement has changed. Review and accept the current version.",
        { field: "acknowledgementVersion" }
      );
    }

    const supportType = requiredString(body, "supportType", {
      max: 32,
      label: "Support type"
    });
    if (!validSponsorSupportTypes.has(supportType as SponsorSupportType)) {
      throw new ApiError(422, "validation_failed", "Select a valid support type.", {
        field: "supportType"
      });
    }

    const contributionRange = optionalString(body, "contributionRange", 32);
    if (
      contributionRange !== null &&
      !validSponsorContributionRanges.has(contributionRange as SponsorContributionRange)
    ) {
      throw new ApiError(422, "validation_failed", "Select a valid contribution range.", {
        field: "contributionRange"
      });
    }

    const capture = await deps.store.createSponsorInquiry(
      {
        contactName: requiredString(body, "contactName", { max: 100, label: "Contact name" }),
        organization: requiredString(body, "organization", { max: 160, label: "Organization" }),
        email: email(body, "email"),
        phone: optionalString(body, "phone", 40),
        supportType: supportType as SponsorSupportType,
        contributionRange: contributionRange as SponsorContributionRange | null,
        desiredOutcome: requiredString(body, "desiredOutcome", {
          min: 10,
          max: 3_000,
          label: "Desired outcome"
        }),
        acknowledgementVersion: privacyMediaDocument.version
      },
      key
    );
    return success(
      c,
      safeSponsorSubmission(capture.value, capture.replayed),
      capture.replayed ? 200 : 201
    );
  });

  app.get("/api/v1/me", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    return success(c, await deps.store.getHunterDashboard(hunter.subject));
  });
  app.get("/api/v1/me/dashboard", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    return success(c, await deps.store.getHunterDashboard(hunter.subject));
  });
  app.post("/api/v1/me/bootstrap", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    const account = await deps.store.getPlayerAccount(hunter.subject);
    if (!account || account.accountState !== "active" || !account.verifiedEmail) {
      throw new ApiError(
        409,
        "identity_sync_pending",
        "Your verified email is still being synchronized. Try again in a moment."
      );
    }
    const access = await deps.store.getPlayerAccess(hunter.subject);
    return success(c, { ...account, ...access });
  });
  app.get("/api/v1/me/profile", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    return success(c, await deps.store.getProfile(hunter.subject));
  });
  app.patch("/api/v1/me/profile", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "profile", hunter);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Profile images are not supported.");
    const account = await deps.store.getPlayerAccount(hunter.subject);
    const verifiedEmail = account?.accountState === "active" && typeof account.verifiedEmail === "string"
      ? account.verifiedEmail
      : null;
    if (!verifiedEmail) {
      throw new ApiError(422, "verified_email_required", "A verified email is required to complete a profile.");
    }
    const participationBasis = participationBasisFrom(body.participationBasis);
    const guardianPermissionAttested =
      participationBasis === "minor_guardian_permission" && body.guardianPermissionAttested === true;
    if (participationBasis === "minor_guardian_permission" && !guardianPermissionAttested) {
      throw new ApiError(
        422,
        "guardian_permission_required",
        "Confirm that your parent or legal guardian reviewed the documents, gave permission, and will supervise your participation."
      );
    }
    if (body.privacyMediaAccepted !== true) {
      throw new ApiError(
        422,
        "privacy_media_acceptance_required",
        "Accept the Privacy Policy & Media Notice to complete your profile."
      );
    }
    if (body.privacyMediaVersion !== privacyMediaDocument.version) {
      throw new ApiError(
        409,
        "privacy_media_version_outdated",
        "The Privacy Policy & Media Notice changed. Review and accept the current version."
      );
    }
    const interests = Array.isArray(body.interests)
      ? body.interests.filter((item): item is string => typeof item === "string").slice(0, 10)
      : [];
    const submittedConsents = body.consents && typeof body.consents === "object"
      ? (body.consents as Record<string, unknown>)
      : {};
    const profile = await deps.store.upsertProfile(hunter.subject, {
        verifiedEmail,
        fullName: requiredString(body, "fullName", { max: 100, label: "Full name" }),
        townArea: optionalString(body, "townArea", 100),
        interests,
        discoverySource: optionalString(body, "discoverySource", 100),
        consents: {
          huntEmail: submittedConsents.huntEmail === true,
          marketing: submittedConsents.marketing === true
        },
        participationBasis,
        guardianPermissionAttested,
        privacyMediaAccepted: true,
        privacyMediaVersion: privacyMediaDocument.version,
        privacyMediaHash: privacyMediaDocument.hash,
        policyVersion: privacyMediaDocument.version
      });
    return success(c, { ...profile, ...(await deps.store.getPlayerAccess(hunter.subject)) });
  });

  app.post("/api/v1/me/waiver/review", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "waiver_review", hunter);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Waiver reviews accept JSON only.");
    const document = requireActiveWaiverIdentity(body);
    if (!deps.store.recordWaiverReview) {
      throw new ApiError(503, "waiver_store_unavailable", "Waiver review is temporarily unavailable.");
    }
    const review = await deps.store.recordWaiverReview(hunter.subject, document);
    return success(c, { review }, 201);
  });

  app.post("/api/v1/me/waiver/accept", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "waiver_accept", hunter);
    const key = idempotencyKey(c.req.raw);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Waiver acceptance accepts JSON only.");
    const document = requireActiveWaiverIdentity(body);
    if (body.waiverAccepted !== true) {
      throw new ApiError(422, "waiver_acceptance_required", "Accept the current participation waiver to continue.");
    }
    const reviewEventId = requiredString(body, "reviewEventId", {
      max: 128,
      label: "Waiver review reference"
    });
    const account = await deps.store.getPlayerAccount(hunter.subject);
    const verifiedEmail =
      account?.accountState === "active" && typeof account.verifiedEmail === "string"
        ? account.verifiedEmail
        : null;
    if (!verifiedEmail) {
      throw new ApiError(
        409,
        "verified_account_required",
        "A verified active account is required to accept the participation waiver."
      );
    }
    const profile = await deps.store.getProfile(hunter.subject);
    if (!profile) {
      throw new ApiError(409, "profile_required", "Complete your hunter profile before accepting the participation waiver.");
    }
    const participationBasis = participationBasisFrom(profile.participationBasis);
    if (
      participationBasis === "minor_guardian_permission" &&
      (!Array.isArray(body.minors) || body.minors.length > 0)
    ) {
      throw new ApiError(
        422,
        "minor_dependants_not_allowed",
        "A participant under 18 cannot add supervised dependants to their waiver acceptance."
      );
    }
    const minors = waiverMinors(body);
    const access = await deps.store.getPlayerAccess(hunter.subject);
    if (access.privacyMediaRequired) {
      throw new ApiError(
        428,
        "privacy_media_acceptance_required",
        "Accept the current Privacy Policy & Media Notice before accepting the participation waiver."
      );
    }
    if (!deps.store.getWaiverReview || !deps.store.acceptParticipationWaiver) {
      throw new ApiError(503, "waiver_store_unavailable", "Waiver acceptance is temporarily unavailable.");
    }
    const review = await deps.store.getWaiverReview(hunter.subject, reviewEventId);
    if (
      !review ||
      review.documentVersion !== document.version ||
      review.documentHash !== document.hash
    ) {
      throw new ApiError(
        422,
        "waiver_review_required",
        "Open and review the current participation waiver before accepting it."
      );
    }
    const capture = await deps.store.acceptParticipationWaiver(hunter.subject, {
      reviewEventId,
      idempotencyKey: key,
      adultName: requiredString(profile, "fullName", { max: 100, label: "Full name" }),
      minors,
      guardianAttested: minors.length > 0,
      accountParticipationBasis: participationBasis,
      accountGuardianPermissionAttested: participationBasis === "minor_guardian_permission",
      documentVersion: document.version,
      documentHash: document.hash
    });
    const shouldDeliverReceipt = capture.replayed
      ? await deps.store.requeueWaiverReceiptForAcceptanceReplay(hunter.subject, capture.value.id)
      : true;
    if (shouldDeliverReceipt) {
      scheduleWaiverReceipt(c, deps.waiverReceipts, capture.value.id);
    }
    return success(
      c,
      {
        acceptance: capture.value,
        participationUnlocked: (await deps.store.getPlayerAccess(hunter.subject)).participationUnlocked,
        replayed: capture.replayed
      },
      capture.replayed ? 200 : 201
    );
  });

  app.get("/api/v1/me/waiver", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    if (!deps.store.getParticipationWaiver) {
      throw new ApiError(503, "waiver_store_unavailable", "Waiver status is temporarily unavailable.");
    }
    const acceptance = await deps.store.getParticipationWaiver(hunter.subject);
    const document =
      acceptance?.documentVersion === participationWaiverDocument.version &&
      acceptance.documentHash === participationWaiverDocument.hash
        ? participationWaiverDocument
        : null;
    return success(c, { acceptance, document });
  });

  app.post("/api/v1/me/waiver/receipt", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "waiver_receipt", hunter);
    if (!deps.store.getParticipationWaiver || !deps.store.queueWaiverReceiptResend) {
      throw new ApiError(503, "waiver_store_unavailable", "Waiver receipts are temporarily unavailable.");
    }
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Waiver receipt requests accept JSON only.");
    const requestedAcceptanceId = optionalString(body, "acceptanceId", 128);
    const acceptance = await deps.store.getParticipationWaiver(hunter.subject);
    if (requestedAcceptanceId && requestedAcceptanceId !== acceptance?.id) {
      throw new ApiError(
        401,
        "waiver_receipt_unauthorized",
        "That waiver receipt is not available to this account."
      );
    }
    if (!acceptance) {
      throw new ApiError(404, "waiver_acceptance_not_found", "No accepted participation waiver was found.");
    }
    if (acceptance.receipt.status === "uncertain") {
      throw new ApiError(
        409,
        "waiver_receipt_delivery_uncertain",
        "The email provider may already have accepted this receipt. The case team must check the configured sender mailbox Sent Items or provider delivery log before another copy can be sent."
      );
    }
    const queued = await deps.store.queueWaiverReceiptResend(hunter.subject, acceptance.id);
    if (!queued) {
      throw new ApiError(404, "waiver_acceptance_not_found", "No accepted participation waiver was found.");
    }
    if (queued.receipt.status === "uncertain") {
      throw new ApiError(
        409,
        "waiver_receipt_delivery_uncertain",
        "The email provider may already have accepted this receipt. The case team must check the configured sender mailbox Sent Items or provider delivery log before another copy can be sent."
      );
    }
    scheduleWaiverReceipt(c, deps.waiverReceipts, queued.id);
    return success(c, { acceptance: queued }, 202);
  });

  app.get("/api/v1/member/waypoints", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    const dashboard = await deps.store.getHunterDashboard(hunter.subject);
    return success(c, dashboard.waypoints ?? []);
  });
  app.get("/api/v1/member/waypoints/:id", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    await requireParticipationAccess(deps, hunter);
    let status;
    try {
      status = await deps.store.getStatus();
    } catch {
      throw new StatusUnavailableError();
    }
    const waypoint = await deps.store.getMemberWaypoint(parseWaypoint(c.req.param("id"))!);
    if (!waypoint) throw new ApiError(404, "waypoint_not_found", "Waypoint not found.");
    if (status.state !== "open" || waypoint.zoneState !== "open") {
      throw new ApiError(423, "exact_directions_unavailable", "Exact directions are unavailable for this waypoint.");
    }
    return success(c, waypoint);
  });

  app.put("/api/v1/progress/:id", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "progress", hunter);
    await requireParticipationAccess(deps, hunter);
    await ensureOpenForWrites(deps);
    const { body } = await requestBody(c.req.raw);
    const state = requiredString(body, "state", { max: 10 });
    if (!["saved", "visited", "searched"].includes(state)) {
      throw new ApiError(422, "validation_failed", "Progress state is invalid.", { field: "state" });
    }
    return success(c, await deps.store.upsertProgress(hunter.subject, parseWaypoint(c.req.param("id"))!, state));
  });

  app.post("/api/v1/board/notes", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "field_note", hunter);
    await ensureOpenForWrites(deps);
    await ensureFeature(deps, "notesEnabled");
    await requireParticipationAccess(deps, hunter);
    const { body, files } = await requestBody(c.req.raw);
    await verifyHuman(deps, c.req.raw, body, "field_note");
    await validateImages(files);
    const media = await deps.uploads.save(files, { kind: "field_note", subject: hunter.subject });
    const capture = await deps.store.createFieldNote({
      authorSubject: hunter.subject,
      waypointId: parseWaypoint(body.waypointId),
      body: requiredString(body, "body", { min: 5, max: 2_000, label: "Field note" }),
      media
    });
    scheduleOperatorAlert(c, deps.operatorAlerts, capture.operatorAlertJobId);
    const note = capture.value;
    return success(c, { ...note, media: publicMedia(note.media ?? media) }, 201);
  });

  app.post("/api/v1/board/notes/:id/replies", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "reply", hunter);
    await ensureOpenForWrites(deps);
    await ensureFeature(deps, "repliesEnabled");
    await requireParticipationAccess(deps, hunter);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Replies cannot include images.");
    await verifyHuman(deps, c.req.raw, body, "reply");
    const replyBody = requiredString(body, "body", { min: 2, max: 500, label: "Reply" });
    if (unsafeReply(replyBody)) {
      throw new ApiError(422, "unsafe_reply", "Remove links, contact details, coordinates, markup, or official-status wording.");
    }
    return success(
      c,
      await deps.store.createReply({
        noteId: c.req.param("id"),
        authorSubject: hunter.subject,
        body: replyBody
      }),
      201
    );
  });

  app.post("/api/v1/board/:kind/:id/flags", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "flag", hunter);
    const kind = c.req.param("kind");
    if (!new Set(["note", "reply"]).has(kind)) {
      throw new ApiError(404, "content_not_found", "Community content not found.");
    }
    const { body } = await requestBody(c.req.raw);
    await verifyHuman(deps, c.req.raw, body, "flag");
    return success(
      c,
      await deps.store.createFlag({
        reporterSubject: hunter.subject,
        targetKind: kind,
        targetId: c.req.param("id"),
        reason: requiredString(body, "reason", { max: 50 }),
        details: optionalString(body, "details", 500)
      }),
      201
    );
  });

  app.get("/api/v1/ops/session", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    return success(c, { subject: staff.subject, email: staff.email });
  });
  app.get("/api/v1/ops/dashboard", async (c) => {
    await requireStaff(deps, c.req.raw);
    return success(c, await deps.store.getOpsDashboard());
  });
  app.put("/api/v1/ops/status", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    const state = requiredString(body, "state", { max: 10 }) as CaseState;
    if (!new Set<CaseState>(["open", "paused", "found"]).has(state)) {
      throw new ApiError(422, "validation_failed", "Case state is invalid.", { field: "state" });
    }
    const version = Number(body.version);
    if (!Number.isInteger(version) || version < 0) {
      throw new ApiError(422, "validation_failed", "A current version is required.", { field: "version" });
    }
    if (state === "found") {
      if (body.confirmFound !== true) {
        throw new ApiError(422, "found_confirmation_required", "Deliberately confirm the FOUND status.");
      }
      const reportId = optionalString(body, "reportId", 100);
      const adjudicationReason = optionalString(body, "adjudicationReason", 1_000);
      if (!reportId && !adjudicationReason) {
        throw new ApiError(422, "found_evidence_required", "Reference a verified report or enter an adjudication reason.");
      }
    }
    return success(
      c,
      await deps.store.updateStatus(
        {
          state,
          version,
          hoursOpen: optionalString(body, "hoursOpen", 5) ?? "09:00",
          hoursClose: optionalString(body, "hoursClose", 5) ?? "20:00",
          nextClueTitle: optionalString(body, "nextClueTitle", 200),
          nextClueAt: optionalString(body, "nextClueAt", 40),
          reportId: optionalString(body, "reportId", 100),
          adjudicationReason: optionalString(body, "adjudicationReason", 1_000)
        },
        staff.subject
      )
    );
  });

  app.post("/api/v1/ops/updates", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    return success(
      c,
      await deps.store.createUpdate(
        {
          title: requiredString(body, "title", { max: 200 }),
          body: requiredString(body, "body", { max: 10_000 }),
          scheduledFor: optionalString(body, "scheduledFor", 40)
        },
        staff.subject
      ),
      201
    );
  });

  app.get("/api/v1/ops/reports", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listReports({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.get("/api/v1/ops/reports/:id/media/:mediaId", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const authorized = await deps.store.getReportMedia(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!authorized) {
      throw new ApiError(404, "report_media_not_found", "Report evidence not found.");
    }
    const object = await deps.uploads.read(authorized.key);
    if (!object) {
      throw new ApiError(404, "report_media_not_found", "Report evidence not found.");
    }
    if (!validImageTypes.has(authorized.contentType) || !validImageTypes.has(object.contentType)) {
      throw new ApiError(404, "report_media_not_found", "Report evidence not found.");
    }
    return new Response(object.body, {
      status: 200,
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin"
      }
    });
  });
  app.get("/api/v1/ops/reports/:id", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const report = await deps.store.getReportDetail(c.req.param("id"), staff.subject);
    if (!report) throw new ApiError(404, "report_not_found", "Report not found.");
    return success(c, report);
  });
  app.patch("/api/v1/ops/reports/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    const status = requiredString(body, "status", { max: 20 });
    if (!validReportStates.has(status)) {
      throw new ApiError(422, "validation_failed", "Report status is invalid.", { field: "status" });
    }
    const report = await deps.store.updateReport(
      c.req.param("id"),
      {
        status,
        note: optionalString(body, "note", 2_000),
        assignedTo: optionalString(body, "assignedTo", 200)
      },
      staff.subject
    );
    if (!report) throw new ApiError(404, "report_not_found", "Report not found.");
    return success(c, report);
  });
  app.post("/api/v1/ops/reports/:id/publish", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw);
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) {
      throw new ApiError(415, "unsupported_media_type", "Report publication accepts JSON only.");
    }
    const published = await deps.store.publishReport(
      c.req.param("id"),
      publicationInput(body),
      staff.subject
    );
    if (!published) throw new ApiError(404, "report_not_found", "Report not found.");
    return success(c, published);
  });
  app.post("/api/v1/ops/reports/:id/unpublish", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const unpublished = await deps.store.unpublishReport(c.req.param("id"), staff.subject);
    if (!unpublished) throw new ApiError(404, "report_not_found", "Report not found.");
    return success(c, unpublished);
  });

  app.get("/api/v1/ops/sponsors", async (c) => {
    await requireStaff(deps, c.req.raw);
    const [result, counts] = await Promise.all([
      deps.store.listSponsorInquiries({
        limit: sponsorQueryLimit(c.req.query("limit")),
        cursor: sponsorCursorQuery(c.req.query("cursor")),
        state: optionalSponsorState(c.req.query("state")),
        supportType: optionalSponsorSupportType(c.req.query("supportType")),
        query: sponsorQuery(c.req.query("q"))
      }),
      deps.store.countSponsorInquiriesByState()
    ]);
    return success(c, { counts, items: result.items }, 200, { nextCursor: result.nextCursor });
  });
  app.patch("/api/v1/ops/sponsors/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw);
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) {
      throw new ApiError(415, "unsupported_media_type", "Sponsor notes cannot include files.");
    }
    const state = requiredString(body, "state", { max: 20 }) as SponsorInquiryState;
    if (!validSponsorStates.has(state)) {
      throw new ApiError(422, "validation_failed", "Choose a valid sponsor state.", {
        field: "state"
      });
    }
    const inquiry = await deps.store.updateSponsorInquiry(
      c.req.param("id"),
      { state, note: optionalString(body, "note", 2_000) },
      staff.subject
    );
    if (!inquiry) {
      throw new ApiError(404, "sponsor_inquiry_not_found", "Sponsor inquiry not found.");
    }
    return success(c, inquiry);
  });

  app.get("/api/v1/ops/moderation/notes", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listPendingNotes({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.post("/api/v1/ops/moderation/notes/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    const decision = requiredString(body, "decision", { max: 10 });
    if (!["approved", "rejected"].includes(decision)) {
      throw new ApiError(422, "validation_failed", "Moderation decision is invalid.", {
        field: "decision"
      });
    }
    const note = await deps.store.moderateNote(
      c.req.param("id"),
      decision,
      optionalString(body, "reason", 1_000),
      staff.subject
    );
    if (!note) throw new ApiError(404, "note_not_found", "Pending note not found.");
    return success(c, note);
  });

  app.get("/api/v1/ops/staff", async (c) => {
    await requireStaff(deps, c.req.raw);
    return success(c, await deps.store.listStaff());
  });
  app.get("/api/v1/ops/subscribers", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listSubscribers({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(
      c,
      { counts: result.counts, items: result.items },
      200,
      { nextCursor: result.nextCursor }
    );
  });
  app.get("/api/v1/ops/players", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listPlayers({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, { counts: result.counts, items: result.items }, 200, {
      nextCursor: result.nextCursor
    });
  });
  app.get("/api/v1/ops/players/:subject/waiver", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const detail = await deps.store.getAndAuditOpsWaiverDetail(c.req.param("subject"), staff.subject);
    if (!detail) throw new ApiError(404, "waiver_acceptance_not_found", "No current waiver acceptance was found.");
    return success(c, detail);
  });
  app.post("/api/v1/ops/players/:subject/waiver/receipt", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    await applyRateLimit(deps, c.req.raw, "waiver_receipt", staff);
    if (
      !deps.store.getOpsWaiverDetail ||
      !deps.store.queueOpsWaiverReceiptResend
    ) {
      throw new ApiError(503, "waiver_store_unavailable", "The legal receipt is temporarily unavailable.");
    }
    const subject = c.req.param("subject");
    const detail = await deps.store.getOpsWaiverDetail(subject);
    if (!detail) throw new ApiError(404, "waiver_acceptance_not_found", "No current waiver acceptance was found.");
    if (
      detail.documentVersion !== participationWaiverDocument.version ||
      detail.documentHash !== participationWaiverDocument.hash
    ) {
      throw new ApiError(409, "waiver_document_outdated", "Only the current waiver acceptance can be resent here.");
    }
    if (c.req.raw.body && mediaTypeEssence(c.req.raw) !== "application/json") {
      throw new ApiError(
        415,
        "unsupported_media_type",
        "Waiver receipt retry requests require JSON."
      );
    }
    const { body } = c.req.raw.body
      ? await requestBody(c.req.raw, "application/json")
      : { body: {} as Record<string, unknown> };
    const confirmUncertainRetry = body.confirmUncertainRetry === true;
    const result = await deps.store.queueOpsWaiverReceiptResend(
      subject,
      detail.id,
      staff.subject,
      confirmUncertainRetry
    );
    if (result.status === "not_found") {
      throw new ApiError(404, "waiver_acceptance_not_found", "No current waiver acceptance was found.");
    }
    if (result.status === "in_progress") {
      throw new ApiError(
        409,
        "waiver_receipt_in_progress",
        "A receipt delivery is already in progress. Try again after it finishes."
      );
    }
    if (result.status === "uncertain") {
      throw new ApiError(
        409,
        "waiver_receipt_delivery_uncertain",
        "Check the configured sender mailbox Sent Items or provider delivery log, then explicitly confirm before retrying this uncertain receipt."
      );
    }
    scheduleWaiverReceipt(c, deps.waiverReceipts, result.acceptance.id);
    return success(c, { acceptance: result.acceptance }, 202);
  });
  app.get("/api/v1/ops/audit", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listAudit({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.post("/api/v1/ops/players/:id/:action", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const action = c.req.param("action");
    if (!new Set(["recovery", "revoke-sessions"]).has(action)) {
      throw new ApiError(404, "player_action_not_found", "Player account action not found.");
    }
    if (!deps.playerAccounts) {
      throw new ApiError(503, "provider_action_unavailable", "Player account recovery is not configured.");
    }
    const target = await deps.store.getPlayerAccount(c.req.param("id"));
    if (!target || target.accountState !== "active") {
      throw new ApiError(404, "player_not_found", "Active player account not found.");
    }
    const result = await deps.playerAccounts.execute(action, target);
    await deps.store.recordPlayerAction(action, c.req.param("id"), staff.subject);
    return success(c, result, 202);
  });
  app.post("/api/v1/ops/staff/:id/:action", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const action = c.req.param("action");
    const providerActions = new Set([
      "recovery",
      "revoke-sessions",
      "suspend",
      "reactivate",
      "reset-mfa",
      "resend-invitation"
    ]);
    if (!providerActions.has(action)) throw new ApiError(404, "staff_action_not_found", "Staff action not found.");
    if (!deps.staffAccounts) {
      throw new ApiError(
        503,
        "provider_action_unavailable",
        "This provider-managed account action is not configured yet. Use the staff account portal."
      );
    }
    const target = await deps.store.getStaffPrincipal(c.req.param("id"));
    if (!target) throw new ApiError(404, "staff_not_found", "Staff account not found.");
    const result = await deps.staffAccounts.execute(action, target);
    await deps.store.recordStaffAction(action, c.req.param("id"), staff.subject);
    return success(c, result, 202);
  });

  app.all("/api/v1/*", (c) => {
    throw new ApiError(404, "not_found", "API route not found.");
  });

  app.all("*", async (c) => {
    const assets = c.env?.ASSETS;
    if (!assets) return new Response("Not found", { status: 404 });
    // Cloudflare Pages' asset binding owns clean-URL resolution. Rewriting
    // `/start` to `/start.html` here causes Pages to redirect it back to
    // `/start`, producing a loop in the real runtime.
    const response = await assets.fetch(c.req.raw);
    const pathname = new URL(c.req.url).pathname;
    const cleanPath = pathname.replace(/\/$/, "") || "/";
    const contentType = response.headers.get("content-type") ?? "";
    if (
      response.ok &&
      contentType.startsWith("text/html") &&
      !cleanRoutes.has(cleanPath) &&
      !staticHtmlPaths.has(cleanPath)
    ) {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" }
      });
    }
    if (
      response.ok &&
      contentType.startsWith("text/html") &&
      deps.config?.deploymentEnvironment === "validation"
    ) {
      return decorateValidationHtml(response);
    }
    return response;
  });

  app.onError((error, c) => {
    if (error instanceof ApiError) return fail(c, error);
    return fail(c, new ApiError(500, "internal_error", "The request could not be completed."));
  });

  return app;
};
