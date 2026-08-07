import { Hono, type Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { waypointId } from "../shared/waypoints";
import {
  isRequestedPublicAttributionKind,
  publicDisplayNameError,
  resolvePublicAttribution,
} from "../shared/publication";
import { isReportReviewState } from "../shared/report-workflow";
import {
  FINDER_SHARING_NOTICE_VERSION,
  normalizePublicationPreference,
} from "../shared/report-sharing";
import {
  isCaseItemAudience,
  isCaseItemCollection,
  isCaseItemMediaAudience
} from "../shared/case-items";
import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_TOTAL_BYTES,
  REPORT_IMAGE_TYPES,
} from "../shared/report-image-limits";
import { ApiError, StatusUnavailableError } from "./errors";
import { participationWaiverDocument, privacyMediaDocument, publicLegalState } from "./legal-documents";
import type {
  ApiDependencies,
  CaseItemInput,
  CaseItemMutation,
  CaseItemStatusMutation,
  CaseItemOwner,
  CaseItemStatus,
  CaseState,
  PagesEnv,
  Principal,
  ReportWorkflowMutation,
  ServiceKeyCreateInput,
  ServiceIdempotencyInput,
  ServiceKeyScope,
  ServicePrincipal,
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
  ["/golf-balls", "/golf-balls.html"],
  ["/clues", "/clues.html"],
  ["/interview", "/interview.html"],
  ["/start", "/start.html"],
  ["/dashboard", "/dashboard.html"],
  ["/updates", "/updates.html"],
  ["/report", "/report.html"],
  ["/rules", "/rules.html"],
  ["/privacy", "/privacy.html"],
  ["/waiver", "/waiver.html"],
  ["/community-guidelines", "/community-guidelines.html"],
  ["/clue-board", "/clue-board.html"],
  ["/ops", "/ops.html"]
]);
const withdrawnPublicPaths = new Set(["/sponsors", "/sponsors.html"]);
const staticHtmlPaths = new Set(cleanRoutes.values());
const legalFrameablePaths = new Set(["/privacy", "/privacy.html", "/waiver", "/waiver.html"]);
const privateReportMediaPath =
  /^\/api\/v1\/ops\/(?:production-snapshot\/)?reports\/[^/]+\/media\/[^/]+$/;
const appPaths = new Set(
  [...cleanRoutes.keys()].filter(
    (path) => !["/", "/route", "/golf-balls", "/interview"].includes(path)
  )
);
const validImageTypes = REPORT_IMAGE_TYPES;
const validCaseItemOwners = new Set<CaseItemOwner>(["tim", "casey"]);
const validCaseItemStatuses = new Set<CaseItemStatus>([
  "draft",
  "out_there",
  "found",
  "paused",
  "archived"
]);
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
const validServiceKeyScopes = new Set<ServiceKeyScope>([
  "case.read",
  "case.write",
  "reports.read",
  "reports.write",
  "media.read",
  "media.write",
  "publishing.read",
  "publishing.write",
  "moderation.read",
  "moderation.write",
  "inquiries.read",
  "inquiries.write",
  "people.read",
  "legal.read",
  "staff.read",
  "audit.read",
]);
const rateLimitRules = {
  report: { limit: 5, windowSeconds: 600 },
  sponsor_inquiry: { limit: 3, windowSeconds: 600 },
  profile: { limit: 10, windowSeconds: 600 },
  progress: { limit: 60, windowSeconds: 600 },
  field_note: { limit: 5, windowSeconds: 600 },
  reply: { limit: 5, windowSeconds: 600 },
  flag: { limit: 10, windowSeconds: 600 },
  waiver_review: { limit: 10, windowSeconds: 600 },
  waiver_accept: { limit: 10, windowSeconds: 600 },
  waiver_receipt: { limit: 3, windowSeconds: 600 },
  clue_order: { limit: 6, windowSeconds: 600 }
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
  const allowed = new Set(["title", "body", "mediaIds", "mediaSelections", "action", "scheduledFor"]);
  const forbidden = Object.keys(body).find((key) => !allowed.has(key));
  if (forbidden) {
    throw new ApiError(
      422,
      "publication_field_forbidden",
      "Official Update fields are invalid for this action.",
      { field: forbidden }
    );
  }
  const rawMediaIds = body.mediaIds ?? [];
  if (
    !Array.isArray(rawMediaIds) ||
    rawMediaIds.length > 3 ||
    rawMediaIds.some(
      (item) => typeof item !== "string" || item.trim().length < 1 || item.trim().length > 200
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
  const rawMediaSelections = body.mediaSelections;
  let mediaSelections: Array<{ id: string; altText: string | null; caption: string | null }> | undefined;
  if (rawMediaSelections !== undefined) {
    if (!Array.isArray(rawMediaSelections) || rawMediaSelections.length !== mediaIds.length) {
      throw new ApiError(422, "validation_failed", "Publication image details must match the selected images.", { field: "mediaSelections" });
    }
    mediaSelections = rawMediaSelections.map((candidate) => {
      if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
        throw new ApiError(422, "validation_failed", "Publication image details are invalid.", { field: "mediaSelections" });
      }
      const selection = candidate as Record<string, unknown>;
      const selectionAllowed = new Set(["id", "altText", "caption"]);
      if (Object.keys(selection).some((key) => !selectionAllowed.has(key))) {
        throw new ApiError(422, "validation_failed", "Publication image details are invalid.", { field: "mediaSelections" });
      }
      const id = typeof selection.id === "string" ? selection.id.trim() : "";
      const altText = selection.altText === null || selection.altText === undefined || selection.altText === ""
        ? null
        : typeof selection.altText === "string" && selection.altText.trim().length <= 200
          ? selection.altText.trim()
          : undefined;
      const caption = selection.caption === null || selection.caption === undefined || selection.caption === ""
        ? null
        : typeof selection.caption === "string" && selection.caption.trim().length <= 500
          ? selection.caption.trim()
          : undefined;
      if (!id || altText === undefined || caption === undefined) {
        throw new ApiError(422, "validation_failed", "Publication image details are invalid.", { field: "mediaSelections" });
      }
      return { id, altText, caption };
    });
    if (mediaSelections.some((selection, index) => selection.id !== mediaIds[index])) {
      throw new ApiError(422, "validation_failed", "Publication image details must follow the selected image order.", { field: "mediaSelections" });
    }
  }
  const rawAction = body.action;
  if (rawAction !== "save_draft" && rawAction !== "schedule" && rawAction !== "publish_now") {
    throw new ApiError(422, "validation_failed", "Choose Save draft, Schedule, or Publish now.", { field: "action" });
  }
  const action: "save_draft" | "schedule" | "publish_now" = rawAction;
  const scheduledFor = optionalString(body, "scheduledFor", 64);
  if (action === "schedule") {
    const scheduledTime = scheduledFor ? new Date(scheduledFor).getTime() : Number.NaN;
    if (!scheduledFor || Number.isNaN(scheduledTime) || scheduledTime <= Date.now()) {
      throw new ApiError(422, "validation_failed", "Choose a future date and time for the scheduled Update.", { field: "scheduledFor" });
    }
  } else if (scheduledFor !== null) {
    throw new ApiError(422, "validation_failed", "scheduledFor is only accepted when scheduling an Update.", { field: "scheduledFor" });
  }
  return {
    title: requiredString(body, "title", { max: 200, label: "Title" }),
    body: requiredString(body, "body", { max: 10_000, label: "Story" }),
    mediaIds,
    ...(mediaSelections ? { mediaSelections } : {}),
    action,
    scheduledFor
  };
};

const caseItemInput = (
  body: Record<string, unknown>,
  mutation: boolean
): CaseItemInput | CaseItemMutation => {
  const allowed = new Set([
    "slug",
    "owner",
    "category",
    "title",
    "description",
    "finderKeeps",
    "closeOnFind",
    "status",
    "displayOrder",
    "collection",
    "collectionOrder",
    "audience",
    "showOnBoard",
    "teaserOrder",
    "reportable",
    ...(mutation ? ["expectedVersion", "mediaSelections"] : [])
  ]);
  const forbidden = Object.keys(body).find((key) => !allowed.has(key));
  if (forbidden) {
    throw new ApiError(422, "validation_failed", "Item fields are invalid.", { field: forbidden });
  }
  const slug = requiredString(body, "slug", { max: 80 });
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    throw new ApiError(422, "validation_failed", "Use a lowercase item slug with words separated by hyphens.", {
      field: "slug"
    });
  }
  const owner = body.owner;
  if (typeof owner !== "string" || !validCaseItemOwners.has(owner as CaseItemOwner)) {
    throw new ApiError(422, "validation_failed", "Choose Tim or Casey as the item owner.", { field: "owner" });
  }
  const status = body.status;
  if (typeof status !== "string" || !validCaseItemStatuses.has(status as CaseItemStatus)) {
    throw new ApiError(422, "validation_failed", "Choose a valid item status.", { field: "status" });
  }
  if (typeof body.finderKeeps !== "boolean") {
    throw new ApiError(422, "validation_failed", "Choose whether the finder keeps this item.", {
      field: "finderKeeps"
    });
  }
  if (typeof body.closeOnFind !== "boolean") {
    throw new ApiError(422, "validation_failed", "Choose whether an approved find closes this item.", {
      field: "closeOnFind"
    });
  }
  const displayOrder = body.displayOrder;
  if (!Number.isInteger(displayOrder) || Number(displayOrder) < 0 || Number(displayOrder) > 999) {
    throw new ApiError(422, "validation_failed", "Display order must be a whole number from 0 to 999.", {
      field: "displayOrder"
    });
  }
  const base: CaseItemInput = {
    slug,
    owner: owner as CaseItemOwner,
    category: requiredString(body, "category", { max: 80 }),
    title: requiredString(body, "title", { max: 160 }),
    description: requiredString(body, "description", { max: 1_000 }),
    finderKeeps: body.finderKeeps,
    closeOnFind: body.closeOnFind,
    status: status as CaseItemStatus,
    displayOrder: Number(displayOrder)
  };
  const collection = body.collection === undefined
    ? mutation ? undefined : "case"
    : isCaseItemCollection(body.collection)
      ? body.collection
      : null;
  if (collection === null) {
    throw new ApiError(422, "validation_failed", "Choose the main case or Fresh Drops collection.", {
      field: "collection"
    });
  }
  const collectionOrder = body.collectionOrder === undefined
    ? mutation ? undefined : null
    : body.collectionOrder;
  if (collectionOrder !== undefined && collectionOrder !== null &&
      (!Number.isInteger(collectionOrder) || Number(collectionOrder) < 0 || Number(collectionOrder) > 999)) {
    throw new ApiError(422, "validation_failed", "Collection order must be a whole number from 0 to 999.", {
      field: "collectionOrder"
    });
  }
  const audience = body.audience === undefined
    ? mutation ? undefined : "public"
    : isCaseItemAudience(body.audience)
      ? body.audience
      : null;
  if (audience === null) {
    throw new ApiError(422, "validation_failed", "Choose public or signed-in hunter visibility.", {
      field: "audience"
    });
  }
  const showOnBoard = body.showOnBoard === undefined
    ? mutation ? undefined : true
    : body.showOnBoard;
  if (showOnBoard !== undefined && typeof showOnBoard !== "boolean") {
    throw new ApiError(422, "validation_failed", "Choose whether this item appears on the public board.", {
      field: "showOnBoard"
    });
  }
  const teaserOrder = body.teaserOrder === undefined
    ? mutation ? undefined : null
    : body.teaserOrder;
  if (teaserOrder !== undefined && teaserOrder !== null && teaserOrder !== 1 && teaserOrder !== 2) {
    throw new ApiError(422, "validation_failed", "Choose teaser slot one, two, or neither.", {
      field: "teaserOrder"
    });
  }
  const reportable = body.reportable === undefined
    ? mutation ? undefined : true
    : body.reportable;
  if (reportable !== undefined && typeof reportable !== "boolean") {
    throw new ApiError(422, "validation_failed", "Choose whether hunters can report this item.", {
      field: "reportable"
    });
  }
  Object.assign(base, {
    ...(collection !== undefined ? { collection } : {}),
    ...(collectionOrder !== undefined ? { collectionOrder: collectionOrder as number | null } : {}),
    ...(audience !== undefined ? { audience } : {}),
    ...(showOnBoard !== undefined ? { showOnBoard } : {}),
    ...(teaserOrder !== undefined ? { teaserOrder: teaserOrder as 1 | 2 | null } : {}),
    ...(reportable !== undefined ? { reportable } : {})
  });
  if (audience === "hunter_only" && (showOnBoard === true || teaserOrder !== null && teaserOrder !== undefined)) {
    throw new ApiError(422, "case_item_private_placement", "Hunter-only items cannot appear on a public surface.");
  }
  if (!mutation) return base;
  const expectedVersion = body.expectedVersion;
  if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
    throw new ApiError(422, "validation_failed", "The item version is invalid. Refresh and try again.", {
      field: "expectedVersion"
    });
  }
  const rawSelections = body.mediaSelections ?? [];
  if (!Array.isArray(rawSelections) || rawSelections.length > 3) {
    throw new ApiError(422, "validation_failed", "Choose up to three item images.", {
      field: "mediaSelections"
    });
  }
  const mediaSelections = rawSelections.map((candidate) => {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
      throw new ApiError(422, "validation_failed", "Item image details are invalid.", {
        field: "mediaSelections"
      });
    }
    const selection = candidate as Record<string, unknown>;
    if (Object.keys(selection).some((key) => !["id", "altText", "caption", "audience"].includes(key))) {
      throw new ApiError(422, "validation_failed", "Item image details are invalid.", {
        field: "mediaSelections"
      });
    }
    const id = requiredString(selection, "id", { max: 200 });
    const altText = requiredString(selection, "altText", { max: 200 });
    const caption = optionalString(selection, "caption", 500);
    const mediaAudience = selection.audience === undefined
      ? audience ?? "public"
      : isCaseItemMediaAudience(selection.audience)
        ? selection.audience
        : null;
    if (!mediaAudience) {
      throw new ApiError(422, "validation_failed", "Choose public or signed-in hunter image visibility.", {
        field: "mediaSelections"
      });
    }
    if (mediaAudience === "public" && audience === "hunter_only") {
      throw new ApiError(422, "case_item_media_audience", "Public images require a public item.");
    }
    return { id, altText, caption, audience: mediaAudience };
  });
  if (new Set(mediaSelections.map((selection) => selection.id)).size !== mediaSelections.length) {
    throw new ApiError(422, "validation_failed", "Choose each item image only once.", {
      field: "mediaSelections"
    });
  }
  return { ...base, expectedVersion: Number(expectedVersion), mediaSelections };
};

const caseItemStatusInput = (body: Record<string, unknown>): CaseItemStatusMutation => {
  const allowed = new Set(["expectedVersion", "status", "confirmed"]);
  const forbidden = Object.keys(body).find((key) => !allowed.has(key));
  if (forbidden || Object.keys(body).length !== allowed.size) {
    throw new ApiError(422, "validation_failed", "Item status fields are invalid.", { field: forbidden ?? "status" });
  }
  if (!Number.isInteger(body.expectedVersion) || Number(body.expectedVersion) < 0) {
    throw new ApiError(422, "validation_failed", "A current item version is required.", { field: "expectedVersion" });
  }
  if (body.status !== "out_there" && body.status !== "found") {
    throw new ApiError(422, "validation_failed", "Choose Out there or Found.", { field: "status" });
  }
  if (body.confirmed !== true) {
    throw new ApiError(422, "validation_failed", "Deliberately confirm this item status change.", { field: "confirmed" });
  }
  return { expectedVersion: Number(body.expectedVersion), status: body.status, confirmed: true };
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
  let total = 0;
  for (const file of files) {
    if (!validImageTypes.has(file.type) || file.size === 0 || file.size > REPORT_IMAGE_DIRECT_BYTES) {
      throw new ApiError(415, "invalid_image", "Images must be JPEG, PNG, or WebP and no larger than 20 MB.");
    }
    total += file.size;
    if (!(await hasImageSignature(file))) {
      throw new ApiError(415, "invalid_image", "An uploaded file does not match its image type.");
    }
  }
  if (total > REPORT_IMAGE_TOTAL_BYTES) {
    throw new ApiError(413, "images_total_too_large", "Prepared images may total no more than 30 MB.");
  }
};

const caseNotePublicationInput = (body: Record<string, unknown>) => {
  const allowed = new Set(["body", "mediaIds"]);
  const forbidden = Object.keys(body).find((key) => !allowed.has(key));
  if (forbidden) {
    throw new ApiError(
      422,
      "publication_field_forbidden",
      "Case Note publication fields are derived from the private report.",
      { field: forbidden }
    );
  }
  const rawMediaIds = body.mediaIds ?? [];
  if (
    !Array.isArray(rawMediaIds) ||
    rawMediaIds.length > 3 ||
    rawMediaIds.some((item) => typeof item !== "string" || !item.trim() || item.trim().length > 200)
  ) {
    throw new ApiError(
      422,
      "validation_failed",
      "Select up to three report images for the Case Note.",
      { field: "mediaIds" }
    );
  }
  const mediaIds = rawMediaIds.map((item) => item.trim());
  if (new Set(mediaIds).size !== mediaIds.length) {
    throw new ApiError(422, "validation_failed", "Each selected report image must be unique.", {
      field: "mediaIds"
    });
  }
  return {
    body: requiredString(body, "body", { max: 1_200, label: "Case Note" }),
    mediaIds
  };
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
  ...(typeof record.caseItemId === "string" && typeof record.caseItemTitle === "string"
    ? { caseItemId: record.caseItemId, caseItemTitle: record.caseItemTitle }
    : {}),
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

const scheduleClueNotice = (
  c: Context<AppBindings>,
  sender: ApiDependencies["clueNotices"],
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
  if (!raw && /^Bearer tls_(?:val|prod)_/.test(request.headers.get("authorization") ?? "")) {
    return;
  }
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

const requireJsonMediaType = (
  request: Request,
  message = "Sponsor inquiries accept application/json only."
) => {
  const mediaType = mediaTypeEssence(request);
  if (mediaType !== "application/json") {
    throw new ApiError(415, "unsupported_media_type", message);
  }
  return mediaType;
};

const requireHunter = async (deps: ApiDependencies, request: Request) => {
  const principal = await deps.identity.authenticateHunter(request);
  if (!principal) throw new ApiError(401, "hunter_auth_required", "Sign in as a hunter to continue.");
  return principal;
};

const requireActiveHunterAccount = async (deps: ApiDependencies, hunter: { subject: string }) => {
  const account = await deps.store.getPlayerAccount(hunter.subject);
  if (!account || account.accountState !== "active" || !account.verifiedEmail) {
    throw new ApiError(
      409,
      "identity_sync_pending",
      "Your verified email is still being synchronized. Try again in a moment."
    );
  }
  return account;
};

const optionalHunter = async (deps: ApiDependencies, request: Request) => {
  const authorization = request.headers.get("authorization");
  if (!authorization) return null;
  const principal = await deps.identity.authenticateHunter(request);
  if (!principal) throw new ApiError(401, "invalid_hunter_session", "The hunter session is invalid.");
  return principal;
};

const clueLabel = (sequence: number, title: string | null, entitled: boolean) =>
  entitled && title ? `Clue ${String(sequence).padStart(2, "0")} — ${title}` : `Clue ${String(sequence).padStart(2, "0")} — Sealed`;

/** Deliberately omits all private clue copy before the reader has earned it. */
const publicClueProjection = (
  clue: Record<string, any>,
  subject: string | null,
  orderStatuses: Map<string, string>
) => {
  const released = clue.state === "released" || (clue.state === "retired" && orderStatuses.get(clue.id) === "approved");
  const riddleEntitled = released && (clue.sequence === 1 || Boolean(subject));
  const orderStatus = orderStatuses.get(clue.id) ?? null;
  const decoderUnlocked = released && riddleEntitled && (clue.decoderMode === "free" || orderStatus === "approved");
  if (!released) return {
    id: clue.id, sequence: clue.sequence, label: clueLabel(clue.sequence, null, false), state: "sealed" as const
  };
  return {
    id: clue.id,
    sequence: clue.sequence,
    label: clueLabel(clue.sequence, clue.title, riddleEntitled),
    state: "released" as const,
    ...(riddleEntitled ? { title: clue.title, riddle: clue.riddle } : {}),
    decoder: {
      mode: clue.decoderMode,
      priceCad: 5,
      access: decoderUnlocked
        ? "unlocked"
        : orderStatus === "waiting_verification"
          ? "waiting_verification"
          : subject
            ? "purchase_required"
            : "sign_in_required",
      ...(decoderUnlocked ? { explanation: clue.decoderExplanation, narrowingSummary: clue.narrowingSummary } : {})
    }
  };
};

const activeClueOrderStatuses = (orders: Array<{ clueId: string; status: string }>) => {
  const statuses = new Map<string, string>();
  const rank: Record<string, number> = { created: 1, waiting_verification: 2, approved: 3 };
  for (const order of orders) {
    const candidateRank = rank[order.status] ?? 0;
    if (candidateRank > (rank[statuses.get(order.clueId) ?? ""] ?? 0)) statuses.set(order.clueId, order.status);
  }
  return statuses;
};

const hunterClueOrderProjection = (order: Record<string, any>) => ({
  id: order.id,
  clueId: order.clueId,
  reference: order.reference,
  senderName: order.senderName,
  status: order.status,
  decisionNote: order.decisionNote,
  decidedAt: order.decidedAt,
  version: order.version,
  createdAt: order.createdAt,
  updatedAt: order.updatedAt
});

const serviceScopesFor = (request: Request): ServiceKeyScope[] | null => {
  const { pathname } = new URL(request.url);
  const method = request.method.toUpperCase();
  const isRead = method === "GET" || method === "HEAD";

  if (/^\/api\/v1\/ops\/(?:api-keys|staff\/|players\/[^/]+\/(?:recovery|revoke-sessions))/.test(pathname)) {
    return null;
  }
  if (/^\/api\/v1\/ops\/players\/[^/]+\/waiver\/receipt$/.test(pathname)) return null;
  if (pathname === "/api/v1/ops/session") return null;

  if (pathname === "/api/v1/ops/dashboard") {
    return isRead
      ? [
          "case.read", "reports.read", "publishing.read", "moderation.read", "inquiries.read",
          "people.read", "legal.read", "staff.read", "audit.read",
        ]
      : null;
  }
  if (pathname === "/api/v1/ops/status") return method === "PUT" ? ["case.write"] : null;

  if (/^\/api\/v1\/ops\/items(?:\/|$)/.test(pathname)) {
    const media = /\/media(?:\/|$)/.test(pathname);
    const announcement = /\/announcement-draft$/.test(pathname);
    if (isRead) return media ? ["case.read", "media.read"] : ["case.read"];
    if (announcement) return ["case.write", "publishing.write"];
    if (media) return ["case.write", "media.write"];
    return ["case.write"];
  }

  if (/^\/api\/v1\/ops\/clue-orders(?:\/|$)/.test(pathname)) {
    return isRead ? ["publishing.read", "people.read"] : ["publishing.write", "people.read"];
  }
  if (/^\/api\/v1\/ops\/clues\/[^/]+\/notify$/.test(pathname)) {
    return ["publishing.write", "people.read"];
  }
  if (/^\/api\/v1\/ops\/clues(?:\/|$)/.test(pathname)) {
    return isRead ? ["publishing.read"] : ["publishing.write"];
  }

  if (/^\/api\/v1\/ops\/updates(?:\/|$)/.test(pathname)) {
    const media = /\/media(?:\/|$)/.test(pathname);
    if (isRead) return media ? ["publishing.read", "media.read"] : ["publishing.read"];
    return media ? ["publishing.write", "media.write"] : ["publishing.write"];
  }

  if (/^\/api\/v1\/ops\/reports(?:\/|$)/.test(pathname)) {
    const media = /\/(?:media|update-media)(?:\/|$)/.test(pathname);
    const publication = /\/(?:case-note|publish|unpublish)(?:\/|$)/.test(pathname);
    if (isRead) return media ? ["reports.read", "media.read"] : ["reports.read"];
    if (media) return ["reports.write", "media.write"];
    if (publication) return ["reports.write", "publishing.write"];
    return ["reports.write"];
  }

  if (/^\/api\/v1\/ops\/sponsors(?:\/|$)/.test(pathname)) {
    return isRead ? ["inquiries.read"] : ["inquiries.write"];
  }
  if (/^\/api\/v1\/ops\/moderation(?:\/|$)/.test(pathname)) {
    if (isRead) {
      return /\/media(?:\/|$)/.test(pathname)
        ? ["moderation.read", "media.read"]
        : ["moderation.read"];
    }
    return ["moderation.write"];
  }
  if (pathname === "/api/v1/ops/staff") return isRead ? ["staff.read"] : null;
  if (pathname === "/api/v1/ops/subscribers" || pathname === "/api/v1/ops/players") {
    return isRead ? ["people.read"] : null;
  }
  if (/^\/api\/v1\/ops\/players\/[^/]+\/waiver$/.test(pathname)) {
    return isRead ? ["legal.read"] : null;
  }
  if (pathname === "/api/v1/ops/audit") return isRead ? ["audit.read"] : null;

  if (/^\/api\/v1\/ops\/production-snapshot(?:\/|$)/.test(pathname) && isRead) {
    if (/\/reports(?:\/|$)/.test(pathname)) {
      return /\/media(?:\/|$)/.test(pathname)
        ? ["reports.read", "media.read"]
        : ["reports.read"];
    }
    if (/\/players\/[^/]+\/waiver$/.test(pathname)) return ["legal.read"];
    if (/\/players(?:\/|$)/.test(pathname)) return ["people.read"];
    if (/\/staff$/.test(pathname)) return ["staff.read"];
    if (/\/audit$/.test(pathname)) return ["audit.read"];
    return ["case.read"];
  }

  return null;
};

const requireStaff = async (deps: ApiDependencies, request: Request) => {
  const principal = await deps.identity.authenticateStaff(request);
  if (principal) {
    if (!(await deps.store.isActiveStaff(principal.subject, principal.email))) {
      throw new ApiError(403, "staff_access_revoked", "This staff identity is not active.");
    }
    return principal;
  }
  const service = await deps.serviceKeys?.authenticate(request);
  if (!service) throw new ApiError(401, "staff_auth_required", "Sign in through the staff account portal.");
  const requiredScopes = serviceScopesFor(request);
  if (!requiredScopes) {
    throw new ApiError(403, "service_route_forbidden", "Service keys cannot access this staff operation.");
  }
  const missing = requiredScopes.filter((scope) => !service.scopes.includes(scope));
  if (missing.length) {
    throw new ApiError(403, "service_scope_required", "The service key does not have the required scope.", {
      requiredScopes,
    });
  }
  return service;
};

const requireService = async (deps: ApiDependencies, request: Request): Promise<ServicePrincipal> => {
  const service = await deps.serviceKeys?.authenticate(request);
  if (!service) {
    throw new ApiError(401, "service_auth_invalid", "A valid service API key is required.");
  }
  return service;
};

const requireApiKeyAdmin = async (deps: ApiDependencies, request: Request) => {
  const staff = await requireStaff(deps, request);
  const email = staff.email?.trim().toLowerCase() ?? "";
  const allowed = new Set(
    (deps.apiKeyAdminEmails ?? []).map((candidate) => candidate.trim().toLowerCase())
  );
  if (!email || !allowed.has(email)) {
    throw new ApiError(
      403,
      "api_key_admin_required",
      "Only an authorized service-key administrator can manage API keys."
    );
  }
  if (!deps.serviceKeys) {
    throw new ApiError(503, "service_key_unavailable", "Service-key management is not configured.");
  }
  return staff;
};

const serviceKeyInput = (body: Record<string, unknown>): ServiceKeyCreateInput => {
  const allowed = new Set(["name", "scopes", "expiresAt"]);
  const forbidden = Object.keys(body).find((key) => !allowed.has(key));
  if (forbidden) {
    throw new ApiError(422, "validation_failed", "The service-key request contains an unsupported field.", {
      field: forbidden,
    });
  }
  const name = requiredString(body, "name", { min: 3, max: 100, label: "Key name" });
  if (
    !Array.isArray(body.scopes) ||
    body.scopes.length < 1 ||
    body.scopes.length > validServiceKeyScopes.size ||
    body.scopes.some((scope) => typeof scope !== "string" || !validServiceKeyScopes.has(scope as ServiceKeyScope))
  ) {
    throw new ApiError(422, "validation_failed", "Choose one or more valid service-key scopes.", {
      field: "scopes",
    });
  }
  const scopes = [...new Set(body.scopes as ServiceKeyScope[])].sort() as ServiceKeyScope[];
  if (scopes.length !== body.scopes.length) {
    throw new ApiError(422, "validation_failed", "Service-key scopes must be unique.", { field: "scopes" });
  }
  const expiresAt = optionalString(body, "expiresAt", 64);
  if (expiresAt && (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now())) {
    throw new ApiError(422, "validation_failed", "Key expiry must be a future date and time.", {
      field: "expiresAt",
    });
  }
  return { name, scopes, expiresAt };
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
  principal: Principal | ServicePrincipal | null
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

const applyServiceRateLimit = async (
  deps: ApiDependencies,
  request: Request,
  service: ServicePrincipal,
  kind: "read" | "mutation" | "upload"
) => {
  if (!deps.rateLimits) {
    throw new ApiError(503, "rate_limit_unavailable", "Service API abuse protection is unavailable.");
  }
  const rule = kind === "read"
    ? { limit: 300, windowSeconds: 60 }
    : kind === "upload"
      ? { limit: 20, windowSeconds: 60 }
      : { limit: 60, windowSeconds: 60 };
  const clientIp = request.headers.get("cf-connecting-ip")?.trim() || "client-unavailable";
  const result = await deps.rateLimits.consume({
    scope: `service_${kind}`,
    identifiers: [`key:${service.keyId}`, `ip:${clientIp}`],
    ...rule,
  });
  if (!result.allowed) {
    throw new ApiError(429, "rate_limit_exceeded", "Too many service API requests. Try again later.", {
      retryAfter: result.retryAfter,
    });
  }
};

const requestFingerprint = async (request: Request) => {
  const url = new URL(request.url);
  const maximumBytes = mediaTypeEssence(request) === "multipart/form-data"
    ? 32 * 1024 * 1024
    : 64 * 1024;
  const prefix = new TextEncoder().encode(
    `${request.method.toUpperCase()}\n${url.pathname}${url.search}\n${mediaTypeEssence(request)}\n`
  );
  const body = await readLimitedBody(request.clone(), maximumBytes);
  const bytes = new Uint8Array(prefix.byteLength + body.byteLength);
  bytes.set(prefix);
  bytes.set(body, prefix.byteLength);
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
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
  const requireUnlockedHunter = async (request: Request) => {
    const hunter = await requireHunter(deps, request);
    const access = await deps.store.getPlayerAccess(hunter.subject);
    if (!access.participationUnlocked) {
      throw new ApiError(
        403,
        "participation_locked",
        "Complete your profile and current legal steps to open Fresh Drops."
      );
    }
    return hunter;
  };

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

  app.use("/api/v1/ops/*", async (c, next) => {
    const service = await deps.serviceKeys?.authenticate(c.req.raw);
    if (!service) {
      await next();
      return;
    }
    const requiredScopes = serviceScopesFor(c.req.raw);
    if (!requiredScopes) {
      await next();
      return;
    }
    const missing = requiredScopes.filter((scope) => !service.scopes.includes(scope));
    if (missing.length) {
      throw new ApiError(403, "service_scope_required", "The service key does not have the required scope.", {
        requiredScopes,
      });
    }
    const method = c.req.method.toUpperCase();
    const isMutation = !["GET", "HEAD", "OPTIONS"].includes(method);
    const isUpload = isMutation && (
      /\/(?:media|update-media)(?:\/|$)/.test(new URL(c.req.url).pathname) ||
      mediaTypeEssence(c.req.raw) === "multipart/form-data"
    );
    await applyServiceRateLimit(deps, c.req.raw, service, isUpload ? "upload" : isMutation ? "mutation" : "read");
    if (!isMutation) {
      await next();
      return;
    }
    if (c.req.header("x-tim-confirm")?.toLowerCase() !== "true") {
      throw new ApiError(
        422,
        "service_confirmation_required",
        "Service mutations require X-Tim-Confirm: true."
      );
    }
    const idempotencyKey = c.req.header("idempotency-key")?.trim() ?? "";
    if (idempotencyKey.length < 8 || idempotencyKey.length > 200 || !/^[A-Za-z0-9._:-]+$/.test(idempotencyKey)) {
      throw new ApiError(
        422,
        "idempotency_key_required",
        "Service mutations require a unique Idempotency-Key of 8 to 200 safe characters."
      );
    }
    const url = new URL(c.req.url);
    const input: ServiceIdempotencyInput = {
      keyId: service.keyId,
      idempotencyKey,
      method,
      path: `${url.pathname}${url.search}`,
      requestHash: await requestFingerprint(c.req.raw),
    };
    const start = await deps.serviceKeys!.beginIdempotentRequest(input);
    if (start.state === "conflict") {
      throw new ApiError(409, "idempotency_conflict", "This Idempotency-Key was already used for another request.");
    }
    if (start.state === "in_progress") {
      throw new ApiError(409, "idempotency_in_progress", "This idempotent request is still in progress.");
    }
    if (start.state === "replay") {
      c.header("idempotency-replayed", "true");
      c.header("cache-control", "no-store");
      c.header("content-type", "application/json; charset=UTF-8");
      c.res = new Response(start.body, { status: start.status, headers: c.res.headers });
      return;
    }
    try {
      await next();
    } catch (error) {
      await deps.serviceKeys!.cancelIdempotentRequest(input);
      throw error;
    }
    if (c.res.status >= 500) {
      await deps.serviceKeys!.cancelIdempotentRequest(input);
      return;
    }
    await deps.serviceKeys!.completeIdempotentRequest(input, {
      status: c.res.status,
      body: await c.res.clone().text(),
    });
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

  app.get("/api/v1/clues", async (c) => {
    const hunter = await optionalHunter(deps, c.req.raw);
    if (hunter) await requireActiveHunterAccount(deps, hunter);
    const orders = hunter ? await deps.store.listPlayerClueOrders(hunter.subject) : [];
    const statuses = activeClueOrderStatuses(orders);
    const clues = await deps.store.listPaidClues();
    return success(c, { clues: clues.map((clue) => publicClueProjection(clue, hunter?.subject ?? null, statuses)) });
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
    const publicationPreference = normalizePublicationPreference(body.publicationPreference);
    if (!publicationPreference) {
      throw new ApiError(422, "publication_preference_required", "Choose whether staff may share this after review.", {
        field: "publicationPreference"
      });
    }
    if (body.sharingAcknowledgementAccepted !== true && body.sharingAcknowledgementAccepted !== "true") {
      throw new ApiError(422, "sharing_acknowledgement_required", "Accept the finder sharing notice to continue.", {
        field: "sharingAcknowledgementAccepted"
      });
    }
    if (body.sharingNoticeVersion !== FINDER_SHARING_NOTICE_VERSION) {
      throw new ApiError(409, "sharing_notice_outdated", "The finder sharing notice changed. Review it and try again.", {
        field: "sharingNoticeVersion"
      });
    }
    if (hunter && publicationPreference === "share_after_review" &&
        !isRequestedPublicAttributionKind(body.publicAttributionKind)) {
      throw new ApiError(
        422,
        "public_attribution_required",
        "Choose how this report may be credited if a representative from SebaHub shares it.",
        { field: "publicAttributionKind" }
      );
    }
    const requestedAttribution = isRequestedPublicAttributionKind(body.publicAttributionKind)
      ? body.publicAttributionKind
      : "community";
    const requestedCaseItemId = optionalString(body, "caseItemId", 128);
    const customItemName = optionalString(body, "customItemName", 160);
    if (requestedCaseItemId !== null && customItemName !== null) {
      throw new ApiError(422, "report_item_choice_invalid", "Choose a known item or enter a custom item, not both.");
    }
    if (type === "find" && requestedCaseItemId === null && customItemName === null) {
      throw new ApiError(422, "report_item_required", "Choose a known item or name what you found.", {
        field: "customItemName"
      });
    }
    let reportedCaseItem: {
      id: string;
      title: string;
      audience: "public" | "hunter_only";
    } | null = null;
    if (requestedCaseItemId !== null) {
      if (!/^[A-Za-z0-9_-]{1,128}$/.test(requestedCaseItemId)) {
        throw new ApiError(422, "case_item_invalid", "The selected Fresh Drops item is invalid.", {
          field: "caseItemId"
        });
      }
      reportedCaseItem = await deps.store.getReportableCaseItem(requestedCaseItemId);
      if (!reportedCaseItem) {
        throw new ApiError(422, "case_item_invalid", "That Fresh Drops item is not available for reporting.", {
          field: "caseItemId"
        });
      }
      if (reportedCaseItem.audience === "hunter_only") {
        await requireUnlockedHunter(c.req.raw);
      }
    }
    const attribution = resolvePublicAttribution(
      hunter ? await deps.store.getProfile(hunter.subject) : null,
      requestedAttribution
    );
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
        caseItemId: reportedCaseItem?.id ?? null,
        caseItemTitle: reportedCaseItem?.title ?? null,
        customItemName,
        publicationPreference,
        sharingNoticeVersion: FINDER_SHARING_NOTICE_VERSION,
        sharingNoticeAcceptedAt: new Date().toISOString(),
        publicAttribution: attribution.label,
        attributionKind: attribution.kind,
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
  app.get("/api/v1/me/clues", async (c) => {
    const hunter = await requireHunter(deps, c.req.raw);
    await requireActiveHunterAccount(deps, hunter);
    const [clues, orders] = await Promise.all([
      deps.store.listPaidClues(), deps.store.listPlayerClueOrders(hunter.subject)
    ]);
    const statuses = activeClueOrderStatuses(orders);
    return success(c, {
      clues: clues.map((clue) => publicClueProjection(clue, hunter.subject, statuses)),
      orders: orders.map(hunterClueOrderProjection)
    });
  });
  app.post("/api/v1/clues/:id/orders", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await requireActiveHunterAccount(deps, hunter);
    await applyRateLimit(deps, c.req.raw, "clue_order", hunter);
    const { files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Decoder purchases accept JSON only.");
    const result = await deps.store.createOrReuseClueOrder(hunter.subject, c.req.param("id"));
    const validation = deps.config?.deploymentEnvironment === "validation";
    const payment = result.order.status === "approved"
      ? { status: "unlocked" }
      : result.order.status === "waiting_verification"
        ? { status: "waiting_verification" }
        : validation
          ? { amountCad: 5, instructions: "Validation only — do not send money. Use the Ops test approval flow." }
          : { amountCad: 5, recipient: "tim@businessasaforceforgood.ca", reference: result.order.reference,
              instructions: "Send a $5 CAD Interac e-Transfer, include this reference, then return here and confirm it was sent." };
    return success(c, {
      order: hunterClueOrderProjection(result.order),
      reused: result.reused,
      payment
    }, result.reused ? 200 : 201);
  });
  app.post("/api/v1/me/clue-orders/:id/claim", async (c) => {
    sameOrigin(c.req.raw);
    const hunter = await requireHunter(deps, c.req.raw);
    await requireActiveHunterAccount(deps, hunter);
    await applyRateLimit(deps, c.req.raw, "clue_order", hunter);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Payment confirmation accepts JSON only.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    }
    const order = await deps.store.claimClueOrder(
      hunter.subject,
      c.req.param("id"),
      requiredString(body, "senderName", { min: 2, max: 100, label: "Sender name" }),
      Number(expectedVersion)
    );
    if (!order) throw new ApiError(404, "clue_order_not_found", "That payment request was not found.");
    return success(c, { order: hunterClueOrderProjection(order), message: "Waiting for verification." });
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
    const publicDisplayName = optionalString(body, "publicDisplayName", 40) ?? "";
    const displayNameError = publicDisplayNameError(publicDisplayName);
    if (displayNameError) {
      throw new ApiError(422, "public_display_name_invalid", displayNameError, {
        field: "publicDisplayName"
      });
    }
    const submittedConsents = body.consents && typeof body.consents === "object"
      ? (body.consents as Record<string, unknown>)
      : {};
    const profile = await deps.store.upsertProfile(hunter.subject, {
        verifiedEmail,
        fullName: requiredString(body, "fullName", { max: 100, label: "Full name" }),
        publicDisplayName: publicDisplayName || null,
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
    const key = idempotencyKey(c.req.raw);
    const replay = await deps.store.getFieldNoteByIdempotencyKey(hunter.subject, key);
    if (replay) return success(c, { ...replay, media: publicMedia(replay.media) });
    const media = await deps.uploads.save(files, { kind: "field_note", subject: hunter.subject });
    const capture = await deps.store.createFieldNote({
      authorSubject: hunter.subject,
      waypointId: parseWaypoint(body.waypointId),
      body: requiredString(body, "body", { min: 5, max: 2_000, label: "Field note" }),
      media
    }, key);
    scheduleOperatorAlert(c, deps.operatorAlerts, capture.operatorAlertJobId);
    const note = capture.value;
    return success(c, { ...note, media: publicMedia(note.media ?? media) }, capture.replayed ? 200 : 201);
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

  app.get("/api/v1/service/session", async (c) => {
    const service = await requireService(deps, c.req.raw);
    await applyServiceRateLimit(deps, c.req.raw, service, "read");
    return success(c, {
      keyId: service.keyId,
      name: service.name,
      environment: service.environment,
      scopes: service.scopes,
    });
  });
  app.get("/api/v1/service/capabilities", async (c) => {
    const service = await requireService(deps, c.req.raw);
    await applyServiceRateLimit(deps, c.req.raw, service, "read");
    return success(c, {
      keyId: service.keyId,
      environment: service.environment,
      scopes: service.scopes,
      safeguards: {
        mutationsRequireConfirmation: true,
        mutationsRequireIdempotencyKey: true,
        accountSecurityUnavailable: true,
        legalWritesUnavailable: true,
        serviceKeyAdministrationUnavailable: true,
      },
    });
  });
  app.get("/api/v1/ops/session", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    return success(c, { subject: staff.subject, email: staff.email });
  });
  app.get("/api/v1/ops/dashboard", async (c) => {
    await requireStaff(deps, c.req.raw);
    return success(c, await deps.store.getOpsDashboard());
  });
  app.get("/api/v1/items", async (c) => {
    return success(c, await deps.store.listPublicCaseItems());
  });
  app.get("/api/v1/me/fresh-drops", async (c) => {
    await requireUnlockedHunter(c.req.raw);
    return success(c, await deps.store.listHunterFreshDrops());
  });
  app.get("/api/v1/me/fresh-drops/media/:mediaId", async (c) => {
    await requireUnlockedHunter(c.req.raw);
    const authorized = await deps.store.getHunterCaseItemMedia(c.req.param("mediaId"));
    if (!authorized) {
      throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
    }
    const object = await deps.uploads.read(authorized.key);
    if (!object || !validImageTypes.has(object.contentType)) {
      throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin"
      }
    });
  });
  const productionSnapshot = async (request: Request) => {
    await requireStaff(deps, request);
    if (!deps.productionSnapshot) {
      throw new ApiError(
        503,
        "production_snapshot_unavailable",
        "The read-only production snapshot is unavailable."
      );
    }
    const summary = await deps.productionSnapshot.summary();
    if (!summary) {
      throw new ApiError(
        503,
        "production_snapshot_unavailable",
        "The read-only production snapshot is unavailable."
      );
    }
    return { store: deps.productionSnapshot, summary };
  };
  app.get("/api/v1/ops/production-snapshot", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    return success(c, snapshot.summary);
  });
  app.get("/api/v1/ops/production-snapshot/reports", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    const result = await snapshot.store.listReports({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.get("/api/v1/ops/production-snapshot/reports/:id/media/:mediaId", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    if (!deps.productionSnapshotMedia) {
      throw new ApiError(
        503,
        "production_snapshot_unavailable",
        "The read-only production snapshot is unavailable."
      );
    }
    const authorized = await snapshot.store.getReportMedia(
      c.req.param("id"),
      c.req.param("mediaId")
    );
    if (!authorized) {
      throw new ApiError(404, "production_snapshot_media_not_found", "Snapshot evidence not found.");
    }
    const object = await deps.productionSnapshotMedia.read(authorized.key);
    if (
      !object ||
      !validImageTypes.has(authorized.contentType) ||
      !validImageTypes.has(object.contentType)
    ) {
      throw new ApiError(404, "production_snapshot_media_not_found", "Snapshot evidence not found.");
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
  app.get("/api/v1/ops/production-snapshot/reports/:id", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    const report = await snapshot.store.getReport(c.req.param("id"));
    if (!report) throw new ApiError(404, "production_snapshot_report_not_found", "Snapshot report not found.");
    return success(c, report);
  });
  app.get("/api/v1/ops/production-snapshot/players", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    const result = await snapshot.store.listPlayers({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.get("/api/v1/ops/production-snapshot/players/:subject/waiver", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    const waiver = await snapshot.store.getWaiver(c.req.param("subject"));
    if (!waiver) throw new ApiError(404, "production_snapshot_waiver_not_found", "Snapshot waiver not found.");
    return success(c, waiver);
  });
  app.get("/api/v1/ops/production-snapshot/staff", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    return success(c, await snapshot.store.listStaff());
  });
  app.get("/api/v1/ops/production-snapshot/audit", async (c) => {
    const snapshot = await productionSnapshot(c.req.raw);
    const result = await snapshot.store.listAudit({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
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

  app.get("/api/v1/ops/clues", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const canReadPayments = staff.kind !== "service" || staff.scopes.includes("people.read");
    if (!canReadPayments) return success(c, { clues: await deps.store.listOpsPaidClues() });
    const [clues, orderPage] = await Promise.all([
      deps.store.listOpsPaidClues(),
      deps.store.listOpsClueOrders({ limit: 1 })
    ]);
    return success(c, { clues, paymentCounts: orderPage.counts });
  });
  app.patch("/api/v1/ops/clues/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Clue editing accepts JSON only.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    const decoderMode = body.decoderMode;
    if (decoderMode !== undefined && decoderMode !== "paid" && decoderMode !== "free") throw new ApiError(422, "validation_failed", "Decoder mode is invalid.", { field: "decoderMode" });
    const state = body.state;
    if (state === "released") throw new ApiError(422, "clue_lifecycle_route_required", "Use the dedicated release action to publish a clue.", { field: "state" });
    if (state !== undefined && !["draft", "ready", "retired"].includes(String(state))) throw new ApiError(422, "validation_failed", "Clue state is invalid.", { field: "state" });
    const score = body.internalScore;
    if (score !== undefined && (!Number.isInteger(score) || Number(score) < 0 || Number(score) > 100)) throw new ApiError(422, "validation_failed", "Internal score must be 0 to 100.", { field: "internalScore" });
    const clue = await deps.store.updatePaidClue(c.req.param("id"), {
      expectedVersion: Number(expectedVersion),
      title: optionalString(body, "title", 160) ?? undefined,
      riddle: optionalString(body, "riddle", 8_000) ?? undefined,
      decoderExplanation: optionalString(body, "decoderExplanation", 8_000) ?? undefined,
      narrowingSummary: optionalString(body, "narrowingSummary", 2_000) ?? undefined,
      internalNapkinNote: optionalString(body, "internalNapkinNote", 8_000) ?? undefined,
      internalScore: score === undefined ? undefined : Number(score),
      decoderMode: decoderMode as "paid" | "free" | undefined,
      state: state as any
    }, staff.subject);
    if (!clue) throw new ApiError(404, "clue_not_found", "That clue was not found.");
    return success(c, { clue });
  });
  app.post("/api/v1/ops/clues/:id/release", async (c) => {
    sameOrigin(c.req.raw); const staff = await requireStaff(deps, c.req.raw); const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Clue release accepts JSON only.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion)) throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    const clue = await deps.store.releasePaidClue(c.req.param("id"), Number(expectedVersion), staff.subject);
    if (!clue) throw new ApiError(404, "clue_not_found", "That clue was not found."); return success(c, { clue });
  });
  app.post("/api/v1/ops/clues/:id/retract", async (c) => {
    sameOrigin(c.req.raw); const staff = await requireStaff(deps, c.req.raw); const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Clue retraction accepts JSON only.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion)) throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    const clue = await deps.store.retractPaidClue(c.req.param("id"), Number(expectedVersion), requiredString(body, "reason", { min: 3, max: 1_000, label: "Retraction reason" }), staff.subject);
    if (!clue) throw new ApiError(404, "clue_not_found", "That clue was not found."); return success(c, { clue });
  });
  app.post("/api/v1/ops/clues/:id/notify", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Clue notifications accept JSON only.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    }
    if (body.confirmNotify !== true) {
      throw new ApiError(422, "clue_notification_confirmation_required", "Deliberately confirm the clue notification.");
    }
    const queued = await deps.store.queueClueReleaseNotice(c.req.param("id"), Number(expectedVersion), staff.subject);
    if (!queued) throw new ApiError(404, "clue_not_found", "That clue was not found.");
    const retry = queued.replayed
      ? await deps.store.requeueClueNoticeJob(queued.jobId, staff.subject)
      : { status: "queued" as const };
    if (retry.status === "uncertain") {
      throw new ApiError(409, "clue_notice_delivery_uncertain", "The email provider may already have accepted this notice. Check provider delivery evidence before retrying.");
    }
    if (retry.status === "in_progress") {
      throw new ApiError(409, "clue_notice_in_progress", "This clue notice is already being delivered.");
    }
    if (retry.status === "queued") scheduleClueNotice(c, deps.clueNotices, queued.jobId);
    return success(c, { replayed: queued.replayed, status: retry.status }, retry.status === "sent" ? 200 : 202);
  });
  app.get("/api/v1/ops/clue-orders", async (c) => {
    await requireStaff(deps, c.req.raw);
    const status = c.req.query("status") ?? null;
    if (status && !["created", "waiting_verification", "approved", "rejected", "cancelled"].includes(status)) throw new ApiError(422, "validation_failed", "Payment status is invalid.", { field: "status" });
    const page = await deps.store.listOpsClueOrders({
      status: status as any,
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, { orders: page.items, counts: page.counts }, 200, { nextCursor: page.nextCursor });
  });
  app.post("/api/v1/ops/clue-orders/:id/notify", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Clue order notifications accept JSON only.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion) || Number(expectedVersion) < 1) {
      throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    }
    if (body.confirmNotify !== true) {
      throw new ApiError(422, "clue_notification_confirmation_required", "Deliberately confirm the clue order notification.");
    }
    const jobId = await deps.store.queueClueOrderApprovalNotice(c.req.param("id"), Number(expectedVersion), staff.subject);
    if (!jobId) throw new ApiError(404, "clue_order_not_found", "That approved payment request was not found.");
    const retry = await deps.store.requeueClueNoticeJob(jobId, staff.subject);
    if (retry.status === "uncertain") {
      throw new ApiError(409, "clue_notice_delivery_uncertain", "The email provider may already have accepted this notice. Check provider delivery evidence before retrying.");
    }
    if (retry.status === "in_progress") {
      throw new ApiError(409, "clue_notice_in_progress", "This clue notice is already being delivered.");
    }
    if (retry.status === "queued") scheduleClueNotice(c, deps.clueNotices, jobId);
    return success(c, { status: retry.status }, retry.status === "sent" ? 200 : 202);
  });
  app.post("/api/v1/ops/clue-orders/:id/:decision", async (c) => {
    sameOrigin(c.req.raw); const staff = await requireStaff(deps, c.req.raw); const { body, files } = await requestBody(c.req.raw);
    if (files.length) throw new ApiError(415, "unsupported_media_type", "Payment decisions accept JSON only.");
    const decision = c.req.param("decision");
    const status = decision === "reopen" ? "created" : decision === "approve" ? "approved" : decision === "reject" ? "rejected" : decision === "cancel" ? "cancelled" : decision;
    if (!["approved", "rejected", "cancelled", "created"].includes(status)) throw new ApiError(404, "clue_order_decision_not_found", "That payment decision is not available.");
    const expectedVersion = body.expectedVersion;
    if (!Number.isInteger(expectedVersion)) throw new ApiError(422, "validation_failed", "expectedVersion is required.", { field: "expectedVersion" });
    const order = await deps.store.decideClueOrder(c.req.param("id"), { expectedVersion: Number(expectedVersion), status: status as any, decisionNote: optionalString(body, "decisionNote", 1_000) }, staff.subject);
    if (!order) throw new ApiError(404, "clue_order_not_found", "That payment request was not found.");
    let noticeJobId: string | null = null;
    if (order.status === "approved") {
      try {
        noticeJobId = await deps.store.queueClueOrderApprovalNotice(order.id, order.version, staff.subject);
      } catch {
        // Approval is the access grant. A notification outage must never undo it.
      }
      scheduleClueNotice(c, deps.clueNotices, noticeJobId);
    }
    return success(c, { order });
  });

  app.get("/api/v1/ops/updates", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listOpsUpdates({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.get("/api/v1/ops/items", async (c) => {
    await requireStaff(deps, c.req.raw);
    return success(c, await deps.store.listOpsCaseItems());
  });
  app.post("/api/v1/ops/items", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    return success(c, await deps.store.createCaseItem(
      caseItemInput(body, false) as CaseItemInput,
      staff.subject
    ), 201);
  });
  app.patch("/api/v1/ops/items/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    const item = await deps.store.updateCaseItem(
      c.req.param("id"),
      caseItemInput(body, true) as CaseItemMutation,
      staff.subject
    );
    if (!item) throw new ApiError(404, "case_item_not_found", "Item not found.");
    return success(c, item);
  });
  app.post("/api/v1/ops/items/:id/status", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw, "Item status changes require a JSON body.");
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) throw new ApiError(422, "validation_failed", "Item status fields are invalid.");
    const item = await deps.store.updateCaseItemStatus(
      c.req.param("id"),
      caseItemStatusInput(body),
      staff.subject
    );
    if (!item) throw new ApiError(404, "case_item_not_found", "Item not found.");
    return success(c, item);
  });
  app.post("/api/v1/ops/items/:id/media", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { files } = await requestBody(c.req.raw);
    await validateImages(files);
    if (files.length < 1 || files.length > 3) {
      throw new ApiError(422, "validation_failed", "Choose one to three item images.");
    }
    const existing = await deps.store.listOpsCaseItems();
    const item = existing.find((candidate) => candidate.id === c.req.param("id"));
    if (!item) throw new ApiError(404, "case_item_not_found", "Item not found.");
    const uploads = Array.isArray(item.uploads) ? item.uploads as Array<Record<string, unknown>> : [];
    const activeCount = uploads.filter((upload) => upload.status !== "deleted" && upload.status !== "rejected").length;
    if (activeCount + files.length > 3) {
      throw new ApiError(422, "validation_failed", "An item can have no more than three images.");
    }
    const media = await deps.uploads.save(files, { kind: "case_item", subject: staff.subject });
    const updated = await deps.store.addCaseItemUploads(c.req.param("id"), media, staff.subject);
    if (!updated) throw new ApiError(404, "case_item_not_found", "Item not found.");
    return success(c, updated, 201);
  });
  app.get("/api/v1/ops/items/:id/media/:mediaId", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const authorized = await deps.store.getCaseItemMedia(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!authorized) throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
    const object = await deps.uploads.read(authorized.key);
    if (!object || !validImageTypes.has(authorized.contentType) || !validImageTypes.has(object.contentType)) {
      throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin"
      }
    });
  });
  app.delete("/api/v1/ops/items/:id/media/:mediaId", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const removed = await deps.store.removeCaseItemUpload(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!removed) throw new ApiError(404, "case_item_media_not_found", "Item image not found.");
    return success(c, removed);
  });
  app.post("/api/v1/ops/items/:id/announcement-draft", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw, "Announcement drafts accept application/json only.");
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length || Object.keys(body).length > 0) {
      throw new ApiError(422, "validation_failed", "Announcement draft creation does not accept fields.");
    }
    const draft = await deps.store.createCaseItemAnnouncementDraft(c.req.param("id"), staff.subject);
    if (!draft) throw new ApiError(404, "case_item_not_found", "Item not found.");
    return success(c, draft, 201);
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
          body: requiredString(body, "body", { max: 10_000 })
        },
        staff.subject
      ),
      201
    );
  });
  app.get("/api/v1/ops/updates/:id", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const update = await deps.store.getOpsUpdateDetail(c.req.param("id"), staff.subject);
    if (!update) throw new ApiError(404, "update_not_found", "Official Update not found.");
    return success(c, update);
  });
  app.post("/api/v1/ops/updates/:id/media", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const updateId = c.req.param("id");
    const detail = await deps.store.getOpsUpdateDetail(updateId, staff.subject);
    if (!detail) throw new ApiError(404, "update_not_found", "Official Update draft not found.");
    const { files } = await requestBody(c.req.raw);
    await validateImages(files);
    if (files.length < 1 || files.length > 3) {
      throw new ApiError(422, "validation_failed", "Choose one to three Update images.");
    }
    const uploads = Array.isArray(detail.uploads)
      ? detail.uploads as Array<Record<string, unknown>>
      : [];
    const activeUploadCount = uploads.filter((upload) =>
      upload.status !== "deleted" && upload.status !== "rejected"
    ).length;
    if (activeUploadCount + files.length > 3) {
      throw new ApiError(422, "validation_failed", "An Official Update can have no more than three direct uploads.");
    }
    const media = await deps.uploads.save(files, { kind: "official_update", subject: staff.subject });
    const update = await deps.store.addUpdateUploads(updateId, media, staff.subject);
    if (!update) throw new ApiError(404, "update_not_found", "Official Update draft not found.");
    return success(c, update, 201);
  });
  app.get("/api/v1/ops/updates/:id/media/:mediaId", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const authorized = await deps.store.getUpdateMedia(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!authorized) throw new ApiError(404, "update_media_not_found", "Update image not found.");
    const object = await deps.uploads.read(authorized.key);
    if (
      !object ||
      !validImageTypes.has(authorized.contentType) ||
      !validImageTypes.has(object.contentType)
    ) {
      throw new ApiError(404, "update_media_not_found", "Update image not found.");
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin"
      }
    });
  });
  app.delete("/api/v1/ops/updates/:id/media/:mediaId", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const removed = await deps.store.removeUpdateUpload(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!removed) throw new ApiError(404, "update_media_not_found", "Update image not found.");
    return success(c, removed);
  });
  app.post("/api/v1/ops/updates/:id/publish", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw, "Update publication accepts application/json only.");
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) {
      throw new ApiError(415, "unsupported_media_type", "Update publication accepts JSON only.");
    }
    const update = await deps.store.mutateUpdate(
      c.req.param("id"),
      publicationInput(body),
      staff.subject
    );
    if (!update) throw new ApiError(404, "update_not_found", "Official Update not found.");
    return success(c, update);
  });
  app.post("/api/v1/ops/updates/:id/withdraw", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw, "Update withdrawal accepts application/json only.");
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length || Object.keys(body).length > 0) {
      throw new ApiError(422, "validation_failed", "Update withdrawal does not accept fields.");
    }
    const update = await deps.store.withdrawUpdate(c.req.param("id"), staff.subject);
    if (!update) throw new ApiError(404, "update_not_found", "Official Update not found.");
    return success(c, update);
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
  app.post("/api/v1/ops/reports/:id/update-media", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const reportId = c.req.param("id");
    const detail = await deps.store.getReportDetail(reportId, staff.subject);
    if (!detail) throw new ApiError(404, "report_not_found", "Report not found.");
    const publication = detail.publication && typeof detail.publication === "object"
      ? detail.publication as Record<string, unknown>
      : null;
    if (!publication || typeof publication.updateId !== "string" || !publication.updateId) {
      throw new ApiError(409, "update_draft_required", "Save the Official Update draft before uploading images.");
    }
    const { files } = await requestBody(c.req.raw);
    await validateImages(files);
    if (files.length === 0) throw new ApiError(422, "validation_failed", "Choose at least one image.");
    const existingUploads = Array.isArray(publication.uploads) ? publication.uploads.length : 0;
    if (existingUploads + files.length > 3) {
      throw new ApiError(422, "validation_failed", "An Official Update can have no more than three direct uploads.");
    }
    const media = await deps.uploads.save(files, { kind: "official_update", subject: staff.subject });
    const updated = await deps.store.addReportUpdateUploads(reportId, media, staff.subject);
    if (!updated) throw new ApiError(409, "update_draft_required", "Save the Official Update draft before uploading images.");
    return success(c, updated, 201);
  });
  app.get("/api/v1/ops/reports/:id/update-media/:mediaId", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const authorized = await deps.store.getReportUpdateMedia(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!authorized) throw new ApiError(404, "update_media_not_found", "Update image not found.");
    const object = await deps.uploads.read(authorized.key);
    if (!object || !validImageTypes.has(authorized.contentType) || !validImageTypes.has(object.contentType)) {
      throw new ApiError(404, "update_media_not_found", "Update image not found.");
    }
    return new Response(object.body, {
      headers: {
        "content-type": object.contentType,
        "cache-control": "private, no-store",
        "x-content-type-options": "nosniff",
        "content-security-policy": "default-src 'none'; sandbox",
        "cross-origin-resource-policy": "same-origin"
      }
    });
  });
  app.patch("/api/v1/ops/reports/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const { body } = await requestBody(c.req.raw);
    const operation = requiredString(body, "operation", { max: 20 });
    const expectedStatus = requiredString(body, "expectedStatus", { max: 20 });
    if (Object.hasOwn(body, "assignedTo")) {
      throw new ApiError(
        422,
        "validation_failed",
        "Report assignment cannot be set through a status request."
      );
    }
    if (!isReportReviewState(expectedStatus)) {
      throw new ApiError(422, "validation_failed", "Expected report status is invalid.", {
        field: "expectedStatus"
      });
    }
    const note = optionalString(body, "note", 2_000);
    const confirmed = body.confirmed === true;

    let mutation: ReportWorkflowMutation;
    if (operation === "transition") {
      const status = requiredString(body, "status", { max: 20 });
      if (!isReportReviewState(status)) {
        throw new ApiError(422, "validation_failed", "Report status is invalid.", { field: "status" });
      }
      mutation = { operation, expectedStatus, status, note, confirmed };
    } else if (operation === "unassign") {
      if (Object.hasOwn(body, "status") || Object.hasOwn(body, "assignedTo")) {
        throw new ApiError(
          422,
          "validation_failed",
          "Unassign does not accept a status or assignment value."
        );
      }
      mutation = { operation, expectedStatus, note, confirmed };
    } else {
      throw new ApiError(422, "validation_failed", "Report operation is invalid.", {
        field: "operation"
      });
    }
    const report = await deps.store.updateReport(c.req.param("id"), mutation, staff.subject);
    if (!report) throw new ApiError(404, "report_not_found", "Report not found.");
    return success(c, report);
  });
  app.post("/api/v1/ops/reports/:id/case-note", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw);
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) {
      throw new ApiError(415, "unsupported_media_type", "Case Note publication accepts JSON only.");
    }
    const note = await deps.store.publishReportToCaseNotes(
      c.req.param("id"),
      caseNotePublicationInput(body),
      staff.subject
    );
    if (!note) throw new ApiError(404, "report_not_found", "Report not found.");
    return success(c, note);
  });
  app.post("/api/v1/ops/reports/:id/case-note/withdraw", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw);
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length || Object.keys(body).length > 0) {
      throw new ApiError(422, "validation_failed", "Case Note withdrawal does not accept fields.");
    }
    const note = await deps.store.withdrawReportCaseNote(c.req.param("id"), staff.subject);
    if (!note) throw new ApiError(404, "report_case_note_not_found", "Published Case Note not found.");
    return success(c, note);
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
  app.get("/api/v1/ops/moderation/replies", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listModerationReplies({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.get("/api/v1/ops/moderation/flags", async (c) => {
    await requireStaff(deps, c.req.raw);
    const result = await deps.store.listContentFlags({
      limit: queryLimit(c.req.query("limit")),
      cursor: c.req.query("cursor") ?? null
    });
    return success(c, result.items, 200, { nextCursor: result.nextCursor });
  });
  app.post("/api/v1/ops/moderation/replies/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw, "Reply moderation accepts application/json only.");
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) {
      throw new ApiError(415, "unsupported_media_type", "Reply moderation accepts JSON only.");
    }
    const action = requiredString(body, "action", { max: 10 });
    if (action !== "hide" && action !== "restore") {
      throw new ApiError(422, "validation_failed", "Choose hide or restore.", { field: "action" });
    }
    const result = await deps.store.moderateReply(
      c.req.param("id"),
      action,
      requiredString(body, "reason", { min: 3, max: 500 }),
      staff.subject
    );
    if (!result) {
      throw new ApiError(
        409,
        "reply_state_conflict",
        "The reply state changed. Refresh and try again."
      );
    }
    return success(c, result);
  });
  app.post("/api/v1/ops/moderation/flags/:id", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    const mediaType = requireJsonMediaType(c.req.raw, "Flag moderation accepts application/json only.");
    const { body, files } = await requestBody(c.req.raw, mediaType);
    if (files.length) {
      throw new ApiError(415, "unsupported_media_type", "Flag moderation accepts JSON only.");
    }
    const action = requiredString(body, "action", { max: 20 });
    if (action !== "dismiss" && action !== "hide_target") {
      throw new ApiError(422, "validation_failed", "Choose dismiss or hide_target.", { field: "action" });
    }
    const result = await deps.store.moderateContentFlag(
      c.req.param("id"),
      action,
      requiredString(body, "reason", { min: 3, max: 500 }),
      staff.subject
    );
    if (!result) {
      throw new ApiError(
        409,
        "flag_state_conflict",
        "The flag or target state changed. Refresh and try again."
      );
    }
    return success(c, result);
  });
  app.get("/api/v1/ops/moderation/notes/:id/media/:mediaId", async (c) => {
    const staff = await requireStaff(deps, c.req.raw);
    const authorized = await deps.store.getFieldNoteMedia(
      c.req.param("id"),
      c.req.param("mediaId"),
      staff.subject
    );
    if (!authorized) {
      throw new ApiError(404, "note_media_not_found", "Case Note image not found.");
    }
    const object = await deps.uploads.read(authorized.key);
    if (!object || !validImageTypes.has(authorized.contentType) || !validImageTypes.has(object.contentType)) {
      throw new ApiError(404, "note_media_not_found", "Case Note image not found.");
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
    const staff = await requireStaff(deps, c.req.raw);
    return success(c, await deps.store.listStaff(staff.subject));
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
  app.get("/api/v1/ops/api-keys", async (c) => {
    await requireApiKeyAdmin(deps, c.req.raw);
    return success(c, await deps.serviceKeys!.list());
  });
  app.post("/api/v1/ops/api-keys", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireApiKeyAdmin(deps, c.req.raw);
    requireJsonMediaType(c.req.raw, "Service-key creation requires JSON.");
    const { body, files } = await requestBody(c.req.raw);
    if (files.length) {
      throw new ApiError(422, "validation_failed", "Service-key creation does not accept files.");
    }
    const created = await deps.serviceKeys!.create(serviceKeyInput(body), staff.subject);
    return success(c, { key: created.record, secret: created.plaintext }, 201);
  });
  app.post("/api/v1/ops/api-keys/:id/rotate", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireApiKeyAdmin(deps, c.req.raw);
    requireJsonMediaType(c.req.raw, "Service-key rotation requires JSON.");
    const { body, files } = await requestBody(c.req.raw);
    if (files.length || Object.keys(body).length !== 1 || body.confirmed !== true) {
      throw new ApiError(422, "validation_failed", "Deliberately confirm this service-key rotation.", {
        field: "confirmed",
      });
    }
    const rotated = await deps.serviceKeys!.rotate(c.req.param("id"), staff.subject);
    if (!rotated) throw new ApiError(404, "service_key_not_found", "Service key not found.");
    return success(c, { key: rotated.record, secret: rotated.plaintext }, 201);
  });
  app.post("/api/v1/ops/api-keys/:id/revoke", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireApiKeyAdmin(deps, c.req.raw);
    requireJsonMediaType(c.req.raw, "Service-key revocation requires JSON.");
    const { body, files } = await requestBody(c.req.raw);
    if (files.length || Object.keys(body).length !== 1 || body.confirmed !== true) {
      throw new ApiError(422, "validation_failed", "Deliberately confirm this service-key revocation.", {
        field: "confirmed",
      });
    }
    const revoked = await deps.serviceKeys!.revoke(c.req.param("id"), staff.subject);
    if (!revoked) throw new ApiError(404, "service_key_not_found", "Service key not found.");
    return success(c, revoked);
  });
  app.post("/api/v1/ops/staff/invitations", async (c) => {
    sameOrigin(c.req.raw);
    const staff = await requireStaff(deps, c.req.raw);
    if (mediaTypeEssence(c.req.raw) !== "application/json") {
      throw new ApiError(415, "unsupported_media_type", "Staff invitations require a JSON body.");
    }
    const { body, files } = await requestBody(c.req.raw);
    if (files.length || Object.keys(body).length !== 1 || !("email" in body)) {
      throw new ApiError(422, "validation_failed", "A staff invitation requires only an email address.", { field: "email" });
    }
    const invitation = await deps.store.inviteStaff(email(body, "email"), staff.subject);
    let delivery: "sent" | "failed" | "not_sent" = "not_sent";
    if (invitation.created) {
      delivery = "sent";
      try {
        if (!deps.staffAccounts) throw new Error("provider unavailable");
        await deps.staffAccounts.execute("resend-invitation", invitation.record);
      } catch {
        delivery = "failed";
        await deps.store.recordStaffProviderWarning("invitation", String(invitation.record.id), staff.subject);
      }
    }
    return success(c, {
      ...invitation.record,
      actions: ["resend-invitation"],
      created: invitation.created,
      delivery
    }, 202);
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
      "resend-invitation"
    ]);
    if (!providerActions.has(action)) throw new ApiError(404, "staff_action_not_found", "Staff action not found.");
    const target = await deps.store.getStaffPrincipal(c.req.param("id"));
    if (!target) throw new ApiError(404, "staff_not_found", "Staff account not found.");
    if (action === "suspend" || action === "reactivate") {
      const { body, files } = await requestBody(c.req.raw);
      if (files.length || Object.keys(body).length !== 1 || body.confirmed !== true) {
        throw new ApiError(422, "validation_failed", "Deliberately confirm this staff access change.", { field: "confirmed" });
      }
      const changed = await deps.store.changeStaffAccess(c.req.param("id"), action, staff.subject);
      if (!changed) throw new ApiError(404, "staff_not_found", "Staff account not found.");
      let providerWarning = false;
      try {
        if (!deps.staffAccounts) throw new Error("provider unavailable");
        await deps.staffAccounts.execute(action, changed);
      } catch {
        providerWarning = true;
        await deps.store.recordStaffProviderWarning(action, c.req.param("id"), staff.subject);
      }
      return success(c, {
        ...changed,
        ...(changed.subject === staff.subject && action === "suspend" ? { selfSuspended: true } : {}),
        ...(providerWarning ? { providerWarning: true } : {})
      }, 202);
    }
    const grantedActions = Array.isArray(target.actions)
      ? target.actions.filter((candidate): candidate is string => typeof candidate === "string")
      : [];
    if (!grantedActions.includes(action)) {
      throw new ApiError(
        409,
        "staff_action_not_available",
        "This staff action is not available for the account's current access state. Refresh and try again."
      );
    }
    if (!deps.staffAccounts) {
      throw new ApiError(
        503,
        "provider_action_unavailable",
        "This provider-managed account action is not configured yet. Use the staff account portal."
      );
    }
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
    const pathname = new URL(c.req.url).pathname;
    if (withdrawnPublicPaths.has(pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: { "cache-control": "no-store", "content-type": "text/plain; charset=utf-8" }
      });
    }
    // Cloudflare Pages' asset binding owns clean-URL resolution. Rewriting
    // `/start` to `/start.html` here causes Pages to redirect it back to
    // `/start`, producing a loop in the real runtime.
    const response = await assets.fetch(c.req.raw);
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
