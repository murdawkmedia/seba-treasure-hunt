import { routeOrder, waypointId } from "../shared/waypoints";
import { publicDisplayNameError } from "../shared/publication";
import {
  createHunterSignupResume,
  createHunterSignupResumeStore,
  nextHunterSignupResendAvailableAt,
  reconcileHunterSignupResume,
  updateHunterSignupResume,
  type HunterSignupResumeRecord,
  type HunterSignupResumeStore,
} from "./hunter-signup-resume";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const text = (value: unknown, fallback = "Not supplied"): string =>
  typeof value === "string" && value.trim() ? value.trim() : fallback;

export interface HunterAuthHook {
  getToken: () => Promise<string | null>;
}

export interface PublicConfig {
  hunterPublishableKey: string | null;
  deploymentEnvironment: string | null;
  privacyMedia: LegalDocumentIdentity | null;
  waiver: LegalDocumentIdentity | null;
}

export interface LegalDocumentIdentity {
  version: string;
  hash: string;
}

export interface HunterSignupDraft {
  fullName: string;
  emailAddress: string;
  password: string;
  confirmation: string;
  participationBasis: "adult" | "minor_guardian_permission" | "";
  guardianPermissionAttested: boolean;
  privacyMediaReviewed: boolean;
  privacyMediaAccepted: boolean;
  privacyMediaDocument: LegalDocumentIdentity | null;
  waiverReviewed: boolean;
  waiverAccepted: boolean;
  waiverDocument: LegalDocumentIdentity | null;
  finalizationIdempotencyKey?: string;
}

const isLegalDocumentIdentity = (value: unknown): value is LegalDocumentIdentity =>
  isRecord(value) && typeof value.version === "string" && value.version.trim().length > 0 &&
  typeof value.hash === "string" && /^[a-f0-9]{64}$/i.test(value.hash);

const legalDocumentIdentitiesMatch = (
  reviewed: LegalDocumentIdentity | null,
  current: LegalDocumentIdentity | null,
): boolean => Boolean(reviewed && current && reviewed.version === current.version && reviewed.hash === current.hash);

type SignupLegalDocumentKind = "privacy-media" | "waiver";

export interface SignupLegalViewerLoadLease {
  generation: number;
  signal: AbortSignal;
}

interface SignupLegalViewerLoadCoordinator {
  begin: () => SignupLegalViewerLoadLease;
  invalidate: () => void;
  isCurrent: (lease: SignupLegalViewerLoadLease) => boolean;
  apply: (lease: SignupLegalViewerLoadLease, update: () => void) => boolean;
  prepareFrame: (lease: SignupLegalViewerLoadLease) => HTMLIFrameElement | null;
}

export function createSignupLegalViewerLoadCoordinator(
  dialog: HTMLDialogElement | null = null,
): SignupLegalViewerLoadCoordinator {
  let generation = 0;
  let controller: AbortController | null = null;
  const suppressFrame = (): void => {
    const frame = dialog?.querySelector<HTMLIFrameElement>("iframe");
    if (!frame) return;
    frame.hidden = true;
    frame.removeAttribute("src");
  };
  const isCurrent = (lease: SignupLegalViewerLoadLease): boolean =>
    controller !== null && lease.generation === generation &&
    lease.signal === controller.signal && !lease.signal.aborted;

  return {
    begin: () => {
      controller?.abort();
      suppressFrame();
      controller = new AbortController();
      generation += 1;
      return Object.freeze({ generation, signal: controller.signal });
    },
    invalidate: () => {
      generation += 1;
      controller?.abort();
      controller = null;
      suppressFrame();
    },
    isCurrent,
    apply: (lease, update) => {
      if (!isCurrent(lease)) return false;
      update();
      return true;
    },
    prepareFrame: (lease) => {
      if (!isCurrent(lease)) return null;
      const currentFrame = dialog?.querySelector<HTMLIFrameElement>("iframe");
      if (!currentFrame) return null;
      const frame = currentFrame.cloneNode(false) as HTMLIFrameElement;
      frame.hidden = true;
      frame.removeAttribute("src");
      currentFrame.replaceWith(frame);
      return frame;
    },
  };
}

export function installSignupLegalDialogBackdropDismissal(dialog: HTMLDialogElement): void {
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });
}

interface SignupLegalReviewPreparation {
  kind: SignupLegalDocumentKind;
  identity: LegalDocumentIdentity;
  loadViewer: (url: string) => Promise<void>;
}

function signupLegalViewerUrl(
  kind: SignupLegalDocumentKind,
  identity: LegalDocumentIdentity,
): string {
  const query = new URLSearchParams({
    embed: "signup",
    documentVersion: identity.version,
    documentHash: identity.hash,
  });
  const path = kind === "privacy-media" ? "/privacy.html" : "/waiver.html";
  const fragment = kind === "privacy-media" ? "#media-notice" : "";
  return `${path}?${query.toString()}${fragment}`;
}

export async function prepareSignupLegalReview(
  preparation: SignupLegalReviewPreparation,
): Promise<string> {
  const viewerUrl = signupLegalViewerUrl(preparation.kind, preparation.identity);
  await preparation.loadViewer(viewerUrl);
  return viewerUrl;
}

export function assertReviewedSignupDocumentsCurrent(
  draft: HunterSignupDraft,
  current: { privacyMedia: LegalDocumentIdentity | null; waiver: LegalDocumentIdentity | null },
): void {
  const changed: SignupLegalDocumentKind[] = [];
  if (!legalDocumentIdentitiesMatch(draft.privacyMediaDocument, current.privacyMedia)) changed.push("privacy-media");
  if (!legalDocumentIdentitiesMatch(draft.waiverDocument, current.waiver)) changed.push("waiver");
  if (changed.length) throw new SignupLegalDocumentsChangedError(changed);
}

export class SignupLegalDocumentsChangedError extends Error {
  constructor(readonly changed: SignupLegalDocumentKind[]) {
    super("The legal documents changed while your email was being verified. Review and accept only the updated documents to finish your account.");
  }
}

interface HunterRegistrationState {
  profileAndPrivacyComplete: boolean;
  waiverAcceptance: Record<string, unknown> | null;
}

export function assertMissingSignupDocumentsCurrent(
  draft: HunterSignupDraft,
  current: { privacyMedia: LegalDocumentIdentity | null; waiver: LegalDocumentIdentity | null },
  state: HunterRegistrationState,
): void {
  const changed: SignupLegalDocumentKind[] = [];
  if (!state.profileAndPrivacyComplete && !legalDocumentIdentitiesMatch(draft.privacyMediaDocument, current.privacyMedia)) {
    changed.push("privacy-media");
  }
  const waiverMissing = !current.waiver || !state.waiverAcceptance ||
    !waiverDocumentMatchesAcceptance(
      { version: current.waiver.version, hash: current.waiver.hash },
      state.waiverAcceptance,
    );
  if (waiverMissing && !legalDocumentIdentitiesMatch(draft.waiverDocument, current.waiver)) {
    changed.push("waiver");
  }
  if (changed.length) throw new SignupLegalDocumentsChangedError(changed);
}

type HunterSignupErrors = Partial<Record<"fullName" | "emailAddress" | "password" | "participationBasis" | "guardianPermission" | "privacyMedia" | "waiver", string>>;

export function validateHunterSignupDraft(draft: HunterSignupDraft): HunterSignupErrors {
  const errors: HunterSignupErrors = {};
  if (!draft.fullName.trim()) errors.fullName = "Enter the participant's full name.";
  if (!/^\S+@\S+\.\S+$/.test(draft.emailAddress.trim())) errors.emailAddress = "Enter a valid email address.";
  if (draft.password.length < 12 || draft.password !== draft.confirmation) {
    errors.password = "Enter matching passwords of at least 12 characters.";
  }
  if (draft.participationBasis !== "adult" && draft.participationBasis !== "minor_guardian_permission") {
    errors.participationBasis = "Choose whether you are 18 or older or participating with guardian permission.";
  } else if (draft.participationBasis === "minor_guardian_permission" && !draft.guardianPermissionAttested) {
    errors.guardianPermission = "Confirm that your parent or legal guardian reviewed the documents, gave permission, and will supervise your participation.";
  }
  if (!draft.privacyMediaAccepted) {
    errors.privacyMedia = "Accept the current Privacy Policy & Media Notice.";
  } else if (!isLegalDocumentIdentity(draft.privacyMediaDocument)) {
    errors.privacyMedia = "The current Privacy Policy & Media Notice is unavailable. Refresh and try again.";
  }
  if (!draft.waiverAccepted) {
    errors.waiver = "Accept the current Participation Waiver.";
  } else if (!isLegalDocumentIdentity(draft.waiverDocument)) {
    errors.waiver = "The current Participation Waiver is unavailable. Refresh and try again.";
  }
  return errors;
}

export function signupLegalAcceptanceAfterIdentityLoad(
  previous: LegalDocumentIdentity | null,
  next: LegalDocumentIdentity,
  accepted: boolean,
): boolean {
  return accepted && legalDocumentIdentitiesMatch(previous, next);
}

export function hunterSignupDraftFromResume(resume: HunterSignupResumeRecord): HunterSignupDraft {
  return {
    fullName: resume.fullName,
    emailAddress: resume.emailAddress,
    password: "",
    confirmation: "",
    participationBasis: resume.participationBasis,
    guardianPermissionAttested: resume.guardianPermissionAttested,
    privacyMediaReviewed: false,
    privacyMediaAccepted: true,
    privacyMediaDocument: resume.privacyMediaDocument,
    waiverReviewed: false,
    waiverAccepted: true,
    waiverDocument: resume.waiverDocument,
    finalizationIdempotencyKey: resume.finalizationIdempotencyKey,
  };
}

interface SignupEmailVerificationWorkflow {
  code: string;
  resume: HunterSignupResumeRecord;
  attemptVerification: (code: string) => Promise<{ status: string | null; createdSessionId: string | null }>;
  activateSession: (sessionId: string) => Promise<boolean>;
  finalize: (draft: HunterSignupDraft, signal?: AbortSignal) => Promise<void>;
  signal?: AbortSignal;
  clearResume: () => void;
}

export async function completeSignupEmailVerification(
  workflow: SignupEmailVerificationWorkflow,
): Promise<void> {
  const verified = await workflow.attemptVerification(workflow.code);
  if (verified.status !== "complete" || !verified.createdSessionId) {
    throw new Error("Email verification is not complete. Follow the next step shown by the identity provider.");
  }
  if (!await workflow.activateSession(verified.createdSessionId)) {
    throw new Error("Email verification succeeded, but the new session is still starting. Try again shortly.");
  }
  throwIfAborted(workflow.signal);
  await workflow.finalize(hunterSignupDraftFromResume(workflow.resume), workflow.signal);
  workflow.clearResume();
}

interface HunterRegistrationWorkflow {
  bootstrap: () => Promise<void>;
  loadState: () => Promise<HunterRegistrationState>;
  saveProfileAndPrivacy: () => Promise<void>;
  fetchWaiverDocument: () => Promise<Record<string, unknown>>;
  validateMissingDocuments?: (
    state: HunterRegistrationState,
    waiverDocument: Record<string, unknown>,
  ) => void | Promise<void>;
  recordWaiverReview: (documentValue: Record<string, unknown>) => Promise<string>;
  acceptWaiver: (documentValue: Record<string, unknown>, reviewEventId: string) => Promise<void>;
  refreshDashboard: () => Promise<void>;
  ensureActive?: () => void;
}

export async function completeHunterRegistration(workflow: HunterRegistrationWorkflow): Promise<void> {
  await workflow.bootstrap();
  let state = await workflow.loadState();
  const documentValue = await workflow.fetchWaiverDocument();
  await workflow.validateMissingDocuments?.(state, documentValue);
  if (!state.profileAndPrivacyComplete) {
    workflow.ensureActive?.();
    try {
      await workflow.saveProfileAndPrivacy();
    } catch (error) {
      state = await workflow.loadState();
      if (!state.profileAndPrivacyComplete) throw error;
    }
  }
  state = await workflow.loadState();
  if (!state.waiverAcceptance || !waiverDocumentMatchesAcceptance(documentValue, state.waiverAcceptance)) {
    workflow.ensureActive?.();
    const reviewEventId = await workflow.recordWaiverReview(documentValue);
    if (!reviewEventId.trim()) throw new Error("The current waiver review could not be recorded.");
    workflow.ensureActive?.();
    try {
      await workflow.acceptWaiver(documentValue, reviewEventId);
    } catch (error) {
      state = await workflow.loadState();
      if (!state.waiverAcceptance || !waiverDocumentMatchesAcceptance(documentValue, state.waiverAcceptance)) {
        throw error;
      }
    }
  }
  workflow.ensureActive?.();
  await workflow.refreshDashboard();
}

export interface HunterProfileDraft {
  fullName: string;
  publicDisplayName: string;
  townArea: string;
  interests: string[];
  discoverySource: string;
  participationBasis: "adult" | "minor_guardian_permission" | "";
  guardianPermissionAttested: boolean;
  privacyMediaAccepted: boolean;
  huntEmail: boolean;
  marketing: boolean;
}

export interface WaiverMinorDraft {
  fullName: string;
  birthYear: string;
}

export interface WaiverDraft {
  reviewEventId: string;
  version: string;
  hash: string;
  waiverAccepted: boolean;
  guardianAttested: boolean;
  minors: WaiverMinorDraft[];
}

type WaiverErrors = Partial<Record<"review" | "waiverAccepted" | "guardianAttested" | "minors", string>>;

type ProfileErrors = Partial<Record<"fullName" | "publicDisplayName" | "participationBasis" | "guardianPermissionAttested" | "privacyMediaAccepted", string>>;

export function validateProfileDraft(draft: HunterProfileDraft): ProfileErrors {
  const errors: ProfileErrors = {};
  if (!draft.fullName.trim()) errors.fullName = "Enter your name.";
  const displayNameError = publicDisplayNameError(draft.publicDisplayName);
  if (displayNameError) errors.publicDisplayName = displayNameError;
  if (draft.participationBasis !== "adult" && draft.participationBasis !== "minor_guardian_permission") {
    errors.participationBasis = "Choose whether you are 18 or older or participating with guardian permission.";
  } else if (draft.participationBasis === "minor_guardian_permission" && !draft.guardianPermissionAttested) {
    errors.guardianPermissionAttested = "Confirm that your parent or legal guardian reviewed the documents, gave permission, and will supervise your participation.";
  }
  if (!draft.privacyMediaAccepted) {
    errors.privacyMediaAccepted = "Read and accept the current Privacy Policy & Media Notice.";
  }
  return errors;
}

export function buildProfilePayload(draft: HunterProfileDraft): Record<string, unknown> {
  return {
    fullName: draft.fullName.trim(),
    publicDisplayName: draft.publicDisplayName.trim() || null,
    townArea: draft.townArea.trim() || null,
    interests: draft.interests.slice(0, 10),
    discoverySource: draft.discoverySource.trim() || null,
    participationBasis: draft.participationBasis,
    guardianPermissionAttested: draft.participationBasis === "minor_guardian_permission" && draft.guardianPermissionAttested,
    privacyMediaAccepted: draft.privacyMediaAccepted,
    privacyMediaVersion: "2026.3",
    consents: {
      huntEmail: draft.huntEmail,
      marketing: draft.marketing,
    },
  };
}

const currentEdmontonYear = (): number =>
  Number(new Intl.DateTimeFormat("en-CA", { year: "numeric", timeZone: "America/Edmonton" }).format(new Date()));

export function validateWaiverDraft(draft: WaiverDraft): WaiverErrors {
  const errors: WaiverErrors = {};
  if (!draft.reviewEventId.trim() || !draft.version.trim() || !/^[a-f0-9]{64}$/i.test(draft.hash)) {
    errors.review = "Open and review the current participation waiver before accepting it.";
  }
  if (!draft.waiverAccepted) {
    errors.waiverAccepted = "Accept the participation waiver to register.";
  }
  if (draft.minors.length > 10) {
    errors.minors = "Add no more than 10 supervised minors.";
  } else {
    const year = currentEdmontonYear();
    const oldestMinorYear = year - 18;
    const hasInvalidMinor = draft.minors.some((minor) => {
      const name = minor.fullName.trim();
      const birthYear = Number(minor.birthYear);
      return name.length < 1 || name.length > 100 ||
        !/^\d{4}$/.test(minor.birthYear.trim()) ||
        !Number.isInteger(birthYear) ||
        birthYear < oldestMinorYear ||
        birthYear > year;
    });
    if (hasInvalidMinor) {
      errors.minors = "Enter each minor's full name (1–100 characters) and a valid minor birth year.";
    }
  }
  if (draft.minors.length > 0 && !draft.guardianAttested) {
    errors.guardianAttested = "Confirm that you are the parent or legal guardian of every listed minor.";
  }
  return errors;
}

export function buildWaiverPayload(draft: WaiverDraft): Record<string, unknown> {
  return {
    reviewEventId: draft.reviewEventId.trim(),
    version: draft.version.trim(),
    hash: draft.hash.trim().toLowerCase(),
    waiverAccepted: draft.waiverAccepted,
    guardianAttested: draft.guardianAttested,
    minors: draft.minors.map((minor) => ({
      fullName: minor.fullName.trim(),
      birthYear: Number(minor.birthYear.trim()),
    })),
  };
}

export interface WaiverAcceptanceProjection {
  acceptance: Record<string, unknown>;
  document: Record<string, unknown>;
}

export class WaiverRequestError extends Error {
  constructor(
    readonly status: number,
    readonly code: string | null,
    _message: string,
  ) {
    super(code === "waiver_document_outdated"
      ? "The waiver changed. Review the current document before accepting it."
      : provisioningFailureMessage(classifyPlayerBootstrapFailure(status)));
    this.name = "WaiverRequestError";
  }
}

interface WaiverReviewWorkflow {
  fetchDocument: () => Promise<Record<string, unknown>>;
  renderAndReveal: (documentValue: Record<string, unknown>) => void | Promise<void>;
  recordReview: (documentValue: Record<string, unknown>) => Promise<string>;
  setAcceptanceEnabled: (enabled: boolean) => void;
}

export async function performWaiverReview(
  workflow: WaiverReviewWorkflow,
): Promise<{ document: Record<string, unknown>; reviewEventId: string }> {
  workflow.setAcceptanceEnabled(false);
  const documentValue = await workflow.fetchDocument();
  await workflow.renderAndReveal(documentValue);
  try {
    const reviewEventId = await workflow.recordReview(documentValue);
    if (!reviewEventId.trim()) throw new Error("Your waiver review could not be confirmed.");
    workflow.setAcceptanceEnabled(true);
    return { document: documentValue, reviewEventId };
  } catch (error) {
    workflow.setAcceptanceEnabled(false);
    throw error;
  }
}

export function createSerializedWaiverReviewActivation<T>(
  activate: () => Promise<T>,
): () => Promise<T | null> {
  let inFlight = false;
  return async () => {
    if (inFlight) return null;
    inFlight = true;
    try {
      return await activate();
    } finally {
      inFlight = false;
    }
  };
}

interface WaiverAcceptanceWorkflow {
  accept: () => Promise<unknown>;
  loadProjection: () => Promise<WaiverAcceptanceProjection>;
  fetchDashboard: () => Promise<Record<string, unknown>>;
  renderDashboard: (dashboard: Record<string, unknown>) => void | Promise<void>;
  renderProjection: (projection: WaiverAcceptanceProjection) => void | Promise<void>;
  resetOutdatedState: () => void;
}

export async function performWaiverAcceptance(
  workflow: WaiverAcceptanceWorkflow,
): Promise<{
  projection: WaiverAcceptanceProjection;
  dashboardRefreshed: boolean;
  dashboardError: unknown | null;
}> {
  try {
    await workflow.accept();
    const projection = await workflow.loadProjection();
    await workflow.renderProjection(projection);
    try {
      const dashboard = await workflow.fetchDashboard();
      await workflow.renderDashboard(dashboard);
      return { projection, dashboardRefreshed: true, dashboardError: null };
    } catch (dashboardError) {
      return { projection, dashboardRefreshed: false, dashboardError };
    }
  } catch (error) {
    if (error instanceof WaiverRequestError &&
      error.status === 409 &&
      error.code === "waiver_document_outdated") {
      workflow.resetOutdatedState();
    }
    throw error;
  }
}

export function waiverAcceptanceResultMessage(dashboardRefreshed: boolean): string {
  return dashboardRefreshed
    ? "Waiver accepted and registration stored."
    : "Registration is stored and your confirmation is available, but unlocked dashboard data could not refresh yet. Refresh the page to try again.";
}

export function exactAcceptedWaiverDocument(
  acceptance: Record<string, unknown>,
  documentValue: Record<string, unknown>,
): Record<string, unknown> | null {
  return waiverDocumentMatchesAcceptance(documentValue, acceptance) ? documentValue : null;
}

export async function performAcceptedWaiverView(
  acceptedDocument: Record<string, unknown> | null,
  render: (documentValue: Record<string, unknown>) => void | Promise<void>,
): Promise<void> {
  if (!acceptedDocument) throw new Error("The exact accepted waiver document is unavailable.");
  await render(acceptedDocument);
}

const unavailableConfig = (): PublicConfig => ({
  hunterPublishableKey: null,
  deploymentEnvironment: null,
  privacyMedia: null,
  waiver: null,
});

let hunterClerk: Clerk | null = null;
let signInAttempt: SignInResource | null = null;
let signUpAttempt: SignUpResource | null = null;

async function authHeaders(auth: HunterAuthHook | null): Promise<Headers> {
  const headers = new Headers({ Accept: "application/json" });
  try {
    const token = await auth?.getToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  } catch {
    // A same-origin identity cookie may still be available to the backend.
  }
  return headers;
}

function safeHttpsUrl(value: unknown): URL | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value, window.location.origin);
    return url.protocol === "https:" || url.origin === window.location.origin ? url : null;
  } catch {
    return null;
  }
}

export function profileMutationInvalidatesWaiver(
  previous: Record<string, unknown> | null,
  next: Record<string, unknown> | null,
): boolean {
  if (!previous || !next) return false;
  const previousName = typeof previous.fullName === "string" ? previous.fullName.trim() : "";
  const nextName = typeof next.fullName === "string" ? next.fullName.trim() : "";
  return previousName !== nextName || previous.participationBasis !== next.participationBasis;
}

export function supervisedDependantsState(participationBasis: string): {
  hidden: boolean;
  disabled: boolean;
  clearRows: boolean;
} {
  const unavailable = participationBasis === "minor_guardian_permission";
  return { hidden: unavailable, disabled: unavailable, clearRows: unavailable };
}

export function waiverMinorsForParticipationBasis(
  participationBasis: string,
  minors: WaiverMinorDraft[],
): WaiverMinorDraft[] {
  return participationBasis === "minor_guardian_permission" ? [] : minors;
}

async function loadPublicConfig(signal?: AbortSignal): Promise<PublicConfig> {
  try {
    const response = await fetch("/api/v1/config", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: requestSignal(8_000, signal),
    });
    if (!response.ok) {
      return unavailableConfig();
    }
    const envelope: unknown = await response.json();
    if (!isRecord(envelope) || !isRecord(envelope.data)) {
      return unavailableConfig();
    }
    const privacyMedia = {
      version: envelope.data.privacyMediaVersion,
      hash: envelope.data.privacyMediaHash,
    };
    const waiver = {
      version: envelope.data.waiverVersion,
      hash: envelope.data.waiverHash,
    };
    return {
      hunterPublishableKey:
        typeof envelope.data.hunterPublishableKey === "string" &&
        envelope.data.hunterPublishableKey
          ? envelope.data.hunterPublishableKey
          : null,
      deploymentEnvironment:
        typeof envelope.data.deploymentEnvironment === "string" && envelope.data.deploymentEnvironment.trim()
          ? envelope.data.deploymentEnvironment.trim().toLowerCase()
          : null,
      privacyMedia: isLegalDocumentIdentity(privacyMedia) ? privacyMedia : null,
      waiver: isLegalDocumentIdentity(waiver) ? waiver : null,
    };
  } catch {
    throwIfAborted(signal);
    return unavailableConfig();
  }
}

async function initializeManagedAuth(config: PublicConfig): Promise<HunterAuthHook | null> {
  if (!config.hunterPublishableKey) return null;
  try {
    const { Clerk } = await import("@clerk/clerk-js");
    hunterClerk = new Clerk(config.hunterPublishableKey);
    await hunterClerk.load();
    const auth: HunterAuthHook = {
      getToken: async () => hunterClerk?.session?.getToken() ?? null,
    };
    (window as unknown as { timLostAuth?: HunterAuthHook }).timLostAuth = auth;
    return auth;
  } catch (error) {
    console.error("Hunter identity initialization failed.", identityDiagnostic(error));
    return null;
  }
}

function message(kind: "info" | "error" | "success", copy: string): void {
  const element = document.querySelector<HTMLElement>("[data-dashboard-message]");
  if (!element) return;
  element.dataset.kind = kind;
  element.textContent = copy;
  element.hidden = false;
}

function showSignedOut(reason: "signed-out" | "unavailable"): void {
  const gate = document.querySelector<HTMLElement>("[data-dashboard-state]");
  const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
  if (gate) {
    gate.hidden = false;
    gate.dataset.dashboardState = reason;
  }
  if (content) content.hidden = true;

  message(
    reason === "signed-out" ? "info" : "error",
    reason === "signed-out"
      ? "Sign in to retrieve your private Hunter Dashboard."
      : "Hunter Dashboard data cannot be verified right now. Public pages and private reporting remain available.",
  );
}

function renderProfile(profile: unknown): void {
  const root = document.querySelector<HTMLElement>("[data-dashboard-profile]");
  if (!root) return;
  root.replaceChildren();
  if (!isRecord(profile)) {
    const copy = document.createElement("p");
    copy.textContent = "Complete your private profile before using member tools.";
    root.appendChild(copy);
    return;
  }

  const heading = document.createElement("h2");
  const handle = document.createElement("p");
  const location = document.createElement("p");
  heading.textContent = text(profile.fullName, "Hunter profile");
  handle.className = "identity-card__handle";
  handle.textContent = text(profile.publicHandle, "Public handle pending");
  location.textContent = text(profile.townArea, "Town or area not supplied");
  root.appendChild(heading);
  root.appendChild(handle);
  root.appendChild(location);
}

function zoneState(value: unknown): string {
  const allowed = new Set(["open", "restricted", "hazardous", "temporarily_closed", "unreviewed"]);
  return typeof value === "string" && allowed.has(value) ? value : "unreviewed";
}

export interface DashboardWaypoint {
  id: number;
  routeOrder: number;
  name: string;
  description: string;
  zoneState: string;
  exactUrl: string | null;
}

export function normalizeDashboardWaypoints(value: unknown): DashboardWaypoint[] {
  if (!Array.isArray(value)) return [];
  const byId = new Map<number, DashboardWaypoint>();
  for (const raw of value) {
    if (!isRecord(raw)) continue;
    const id = waypointId(raw.id);
    const order = routeOrder(raw.routeOrder);
    const name = text(raw.name, "").trim();
    if (id === null || order === null || !name || byId.has(id)) continue;
    byId.set(id, {
      id,
      routeOrder: order,
      name,
      description: text(raw.description, "No additional description is available."),
      zoneState: zoneState(raw.zoneState),
      exactUrl: safeHttpsUrl(raw.exactUrl)?.toString() ?? null,
    });
  }
  return [...byId.values()].sort(
    (left, right) => left.routeOrder - right.routeOrder || left.id - right.id,
  );
}

export function dashboardRecordWaypointLabel(value: unknown): string {
  if (!isRecord(value)) return "Waypoint not specified";
  const stableId = waypointId(value.waypointId);
  const order = routeOrder(value.waypointRouteOrder);
  const name = text(value.waypointName, "").trim();
  if (stableId !== null && order !== null && name) return `Waypoint ${order} — ${name}`;
  return stableId === null ? "Waypoint not specified" : "Waypoint details unavailable";
}

function renderWaypoints(waypoints: unknown, status: unknown): void {
  const list = document.querySelector<HTMLOListElement>("[data-dashboard-waypoints]");
  if (!list) return;
  list.replaceChildren();
  const normalized = normalizeDashboardWaypoints(waypoints);
  if (normalized.length === 0) {
    const item = document.createElement("li");
    item.textContent = "No approved member waypoints are available.";
    list.appendChild(item);
    return;
  }

  const caseOpen = isRecord(status) && status.state === "open";
  for (const raw of normalized) {
    const item = document.createElement("li");
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    const description = document.createElement("p");
    const state = zoneState(raw.zoneState);
    const badge = document.createElement("span");
    heading.textContent = `Waypoint ${raw.routeOrder} — ${raw.name}`;
    description.textContent = raw.description;
    badge.className = "zone-state";
    badge.dataset.zone = state;
    badge.textContent = state.replaceAll("_", " ");
    copy.appendChild(heading);
    copy.appendChild(description);

    const exactUrl = safeHttpsUrl(raw.exactUrl);
    if (caseOpen && state === "open" && exactUrl) {
      const link = document.createElement("a");
      link.href = exactUrl.toString();
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open approved directions";
      copy.appendChild(document.createElement("br"));
      copy.appendChild(link);
    } else {
      const locked = document.createElement("span");
      locked.className = "field-hint";
      locked.textContent = "Exact directions locked by current case or access state.";
      copy.appendChild(locked);
    }
    item.appendChild(copy);
    item.appendChild(badge);
    list.appendChild(item);
  }
}

function renderLatestUpdate(value: unknown): void {
  const root = document.querySelector<HTMLElement>("[data-dashboard-latest-update]");
  if (!root || !isRecord(value)) return;
  const title = document.createElement("h2");
  const body = document.createElement("p");
  const provenance = document.createElement("p");
  title.textContent = text(value.title, "Official update");
  body.textContent = text(value.body, "No update details were supplied.");
  provenance.className = "provenance";
  provenance.textContent = `${text(value.publisherName, "A representative from SebaHub")} · ${text(value.publishedAt, "Time unavailable")}`;
  root.replaceChildren();
  root.appendChild(title);
  root.appendChild(provenance);
  root.appendChild(body);
}

function renderRecords(selector: string, values: unknown, empty: string): void {
  const list = document.querySelector<HTMLUListElement>(selector);
  if (!list) return;
  list.replaceChildren();
  if (!Array.isArray(values) || values.length === 0) {
    const item = document.createElement("li");
    item.textContent = empty;
    list.appendChild(item);
    return;
  }
  for (const raw of values) {
    if (!isRecord(raw)) continue;
    const item = document.createElement("li");
    const copy = document.createElement("div");
    const heading = document.createElement("h3");
    const detail = document.createElement("p");
    const state = document.createElement("span");
    heading.textContent = Object.hasOwn(raw, "waypointId")
      ? dashboardRecordWaypointLabel(raw)
      : text(raw.title, text(raw.type, "Record"));
    detail.textContent = text(raw.createdAt, "Date unavailable");
    state.className = "record-state";
    state.textContent = text(raw.status, "Pending");
    copy.appendChild(heading);
    copy.appendChild(detail);
    item.appendChild(copy);
    item.appendChild(state);
    list.appendChild(item);
  }
}

function renderDashboard(data: Record<string, unknown>): void {
  const gate = document.querySelector<HTMLElement>("[data-dashboard-state]");
  const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
  if (gate) gate.hidden = true;
  if (content) content.hidden = false;
  renderProfile(data.profile);
  renderLatestUpdate(data.latestUpdate);
  renderWaypoints(data.waypoints, data.status);
  renderRecords("[data-dashboard-reports]", data.reports, "No private reports yet.");
  renderRecords("[data-dashboard-notes]", data.notes, "No Case Notes yet.");
  const waiverPanel = document.querySelector<HTMLElement>("[data-waiver-panel]");
  if (waiverPanel) waiverPanel.hidden = !isRecord(data.profile) || data.privacyMediaRequired === true;
  message(
    isRecord(data.profile) ? "success" : "info",
    isRecord(data.profile)
      ? "Your private Hunter Dashboard is up to date."
      : "You are signed in. Complete the private profile to unlock approved exact directions and community tools.",
  );
}

function profileInput<T extends HTMLInputElement | HTMLSelectElement>(
  form: HTMLFormElement,
  selector: string,
): T | null {
  return form.querySelector<T>(selector);
}

function updateParticipationControls(form: HTMLFormElement): void {
  const basis = form.querySelector<HTMLInputElement>('input[name="participationBasis"]:checked')?.value ?? "";
  const row = form.querySelector<HTMLElement>("[data-guardian-permission]");
  const input = form.querySelector<HTMLInputElement>('input[name="guardianPermissionAttested"]');
  const minor = basis === "minor_guardian_permission";
  if (row) row.hidden = !minor;
  if (input) {
    input.required = minor;
    if (!minor) input.checked = false;
  }
  const dependantControls = supervisedDependantsState(basis);
  const supervisedMinors = document.querySelector<HTMLElement>("[data-minors-fieldset]");
  if (supervisedMinors) {
    supervisedMinors.hidden = dependantControls.hidden;
    for (const control of supervisedMinors.querySelectorAll<HTMLInputElement | HTMLButtonElement>("input, button")) {
      control.disabled = dependantControls.disabled;
    }
  }
  if (dependantControls.clearRows) {
    for (const dependantRow of document.querySelectorAll<HTMLElement>("[data-minor-row]")) {
      dependantRow.remove();
    }
    const guardianInput = document.querySelector<HTMLInputElement>('input[name="guardianAttested"]');
    if (guardianInput) guardianInput.checked = false;
  }
  updateMinorControls();
}

function setupParticipationBasis(form: HTMLFormElement): void {
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="participationBasis"]')) {
    input.addEventListener("change", () => updateParticipationControls(form));
  }
  updateParticipationControls(form);
}

function fillProfileForm(
  form: HTMLFormElement,
  profile: unknown,
  privacyMediaRequired = false,
): void {
  if (!isRecord(profile)) return;
  const setValue = (name: string, value: unknown): void => {
    const input = profileInput<HTMLInputElement | HTMLSelectElement>(form, `[name="${name}"]`);
    if (input) input.value = typeof value === "string" ? value : "";
  };
  setValue("fullName", profile.fullName);
  setValue("publicDisplayName", profile.publicDisplayName);
  setValue("townArea", profile.townArea);
  setValue("discoverySource", profile.discoverySource);

  const interests = new Set(
    Array.isArray(profile.interests)
      ? profile.interests.filter((item): item is string => typeof item === "string")
      : [],
  );
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="interests"]')) {
    input.checked = interests.has(input.value);
  }

  const consents = isRecord(profile.consents) ? profile.consents : {};
  for (const name of ["huntEmail", "marketing"] as const) {
    const input = profileInput<HTMLInputElement>(form, `input[name="${name}"]`);
    if (input) input.checked = consents[name] === true;
  }
  const participationBasis = profile.participationBasis === "minor_guardian_permission"
    ? "minor_guardian_permission"
    : "adult";
  for (const input of form.querySelectorAll<HTMLInputElement>('input[name="participationBasis"]')) {
    input.checked = input.value === participationBasis;
  }
  const guardianPermission = profileInput<HTMLInputElement>(form, 'input[name="guardianPermissionAttested"]');
  if (guardianPermission) guardianPermission.checked = Boolean(profile.guardianPermissionAttestedAt);
  updateParticipationControls(form);
  const privacy = profileInput<HTMLInputElement>(form, 'input[name="privacyMediaAccepted"]');
  if (privacy) privacy.checked = !privacyMediaRequired;
}

function readProfileDraft(form: HTMLFormElement): HunterProfileDraft {
  const value = (name: string): string =>
    profileInput<HTMLInputElement | HTMLSelectElement>(form, `[name="${name}"]`)?.value ?? "";
  const checked = (name: string): boolean =>
    profileInput<HTMLInputElement>(form, `input[name="${name}"]`)?.checked ?? false;
  return {
    fullName: value("fullName"),
    publicDisplayName: value("publicDisplayName"),
    townArea: value("townArea"),
    interests: [...form.querySelectorAll<HTMLInputElement>('input[name="interests"]:checked')].map(
      (input) => input.value,
    ),
    discoverySource: value("discoverySource"),
    participationBasis: (form.querySelector<HTMLInputElement>('input[name="participationBasis"]:checked')?.value ?? "") as HunterProfileDraft["participationBasis"],
    guardianPermissionAttested: checked("guardianPermissionAttested"),
    privacyMediaAccepted: checked("privacyMediaAccepted"),
    huntEmail: checked("huntEmail"),
    marketing: checked("marketing"),
  };
}

function showProfileErrors(errors: ProfileErrors): void {
  const summary = document.querySelector<HTMLElement>("[data-profile-errors]");
  for (const element of document.querySelectorAll<HTMLElement>("[data-profile-error-for]")) {
    element.textContent = "";
  }
  for (const [field, copy] of Object.entries(errors)) {
    const error = document.querySelector<HTMLElement>(`[data-profile-error-for="${field}"]`);
    if (error) error.textContent = copy;
    const control = document.querySelector<HTMLElement>(`[name="${field}"]`);
    control?.setAttribute("aria-invalid", "true");
  }
  if (!summary) return;
  const messages = Object.values(errors);
  summary.hidden = messages.length === 0;
  summary.innerHTML = messages.length
    ? `<strong>Please fix this:</strong><ul>${messages.map((copy) => `<li>${copy}</li>`).join("")}</ul>`
    : "";
  if (messages.length) summary.focus();
}

function setProfileResult(copy: string, kind: "success" | "error"): void {
  const result = document.querySelector<HTMLElement>("[data-profile-result]");
  if (!result) return;
  result.dataset.kind = kind;
  result.textContent = copy;
  result.hidden = false;
  result.focus();
}

function profileErrorMessage(payload: unknown, fallback: string): string {
  if (!isRecord(payload)) return fallback;
  const error = isRecord(payload.error) ? payload.error : payload;
  return typeof error.message === "string" && error.message.trim() ? error.message : fallback;
}

async function fetchDashboard(auth: HunterAuthHook | null, signal?: AbortSignal): Promise<Response> {
  return await protectedFetch("/api/v1/me/dashboard", {
    headers: await authHeaders(auth),
    cache: "no-store",
    credentials: "same-origin",
    signal: requestSignal(10_000, signal),
  }, signal);
}

async function initializeProfileForm(
  auth: HunterAuthHook | null,
  profile: unknown,
  privacyMediaRequired: boolean,
): Promise<void> {
  const form = document.querySelector<HTMLFormElement>("[data-profile-form]");
  const submit = document.querySelector<HTMLButtonElement>("[data-profile-submit]");
  if (!form || !submit) return;
  setupParticipationBasis(form);
  fillProfileForm(form, profile, privacyMediaRequired);
  let currentProfile = isRecord(profile) ? profile : null;

  form.addEventListener("input", () => {
    for (const control of form.querySelectorAll<HTMLElement>('[aria-invalid="true"]')) {
      control.removeAttribute("aria-invalid");
    }
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const draft = readProfileDraft(form);
    const errors = validateProfileDraft(draft);
    showProfileErrors(errors);
    if (Object.keys(errors).length > 0) return;

    submit.disabled = true;
    try {
      const headers = await authHeaders(auth);
      headers.set("Content-Type", "application/json");
      const response = await protectedFetch("/api/v1/me/profile", {
        method: "PATCH",
        headers,
        credentials: "same-origin",
        body: JSON.stringify(buildProfilePayload(draft)),
        signal: AbortSignal.timeout(12_000),
      });
      const payload: unknown = await response.json().catch(() => null);
      if (!response.ok) throw new ProtectedAccountRequestError(response.status, waiverErrorCode(payload));
      const saved = isRecord(payload) && isRecord(payload.data) ? payload.data : null;
      if (saved) {
        if (profileMutationInvalidatesWaiver(currentProfile, saved)) {
          resetWaiverExperienceAfterProfileMutation();
        }
        currentProfile = saved;
        renderProfile(saved);
        fillProfileForm(form, saved, saved.privacyMediaRequired === true);
      }

      const dashboardResponse = await fetchDashboard(auth);
      const dashboardPayload: unknown = await dashboardResponse.json().catch(() => null);
      if (!dashboardResponse.ok) {
        throw new ProtectedAccountRequestError(dashboardResponse.status, waiverErrorCode(dashboardPayload));
      }
      if (dashboardResponse.ok) {
        if (isRecord(dashboardPayload) && isRecord(dashboardPayload.data)) {
          const refreshedProfile = isRecord(dashboardPayload.data.profile)
            ? dashboardPayload.data.profile
            : null;
          if (profileMutationInvalidatesWaiver(currentProfile, refreshedProfile)) {
            resetWaiverExperienceAfterProfileMutation();
          }
          currentProfile = refreshedProfile;
          renderDashboard(dashboardPayload.data);
          fillProfileForm(
            form,
            dashboardPayload.data.profile,
            dashboardPayload.data.privacyMediaRequired === true,
          );
          await initializeWaiverExperience(
            auth,
            isRecord(dashboardPayload.data.profile) && dashboardPayload.data.privacyMediaRequired !== true,
          );
        }
      }
      showProfileErrors({});
      setProfileResult(
        currentWaiverAcceptance
          ? "Profile saved. Your current waiver acceptance remains stored."
          : "Profile saved. Review and accept the separate participation waiver to unlock approved directions.",
        "success",
      );
    } catch (error) {
      setProfileResult(error instanceof Error ? error.message : "Your profile could not be saved.", "error");
    } finally {
      submit.disabled = false;
    }
  });
}

async function fetchDashboardData(auth: HunterAuthHook | null, signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetchDashboard(auth, signal);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ProtectedAccountRequestError(response.status, waiverErrorCode(payload));
  if (!isRecord(payload) || !isRecord(payload.data)) throw new Error("Your dashboard could not be refreshed.");
  return payload.data;
}

let activeWaiverDocument: Record<string, unknown> | null = null;
let waiverReviewEventId = "";
let retainedWaiverIdempotencyKey: string | null = null;
let currentWaiverAcceptance: Record<string, unknown> | null = null;
let acceptedWaiverDocument: Record<string, unknown> | null = null;
let minorRowSequence = 0;

function resetWaiverExperienceAfterProfileMutation(): void {
  activeWaiverDocument = null;
  acceptedWaiverDocument = null;
  currentWaiverAcceptance = null;
  waiverReviewEventId = "";
  retainedWaiverIdempotencyKey = null;
  const form = document.querySelector<HTMLFormElement>("[data-waiver-form]");
  const receipt = document.querySelector<HTMLElement>("[data-waiver-receipt]");
  const details = document.querySelector<HTMLElement>("[data-waiver-acceptance-details]");
  const participants = document.querySelector<HTMLElement>("[data-waiver-participants]");
  const legalBody = document.querySelector<HTMLElement>("[data-waiver-legal-body]");
  const acceptanceInput = document.querySelector<HTMLInputElement>("#waiver-accepted");
  const acceptanceCopy = document.querySelector<HTMLElement>("[data-waiver-acceptance-statement]");
  const result = document.querySelector<HTMLElement>("[data-waiver-result]");
  if (form) form.hidden = false;
  if (receipt) receipt.hidden = true;
  details?.replaceChildren();
  participants?.replaceChildren();
  if (legalBody) legalBody.hidden = true;
  if (acceptanceInput) {
    acceptanceInput.checked = false;
    acceptanceInput.disabled = true;
  }
  if (acceptanceCopy) {
    acceptanceCopy.textContent = "Open and review the current waiver before accepting it.";
  }
  if (result) {
    result.textContent = "";
    result.hidden = true;
  }
}

function envelopeData(value: unknown): unknown {
  return isRecord(value) && "data" in value ? value.data : value;
}

function nestedRecord(value: unknown, keys: string[]): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  for (const key of keys) {
    if (isRecord(value[key])) return value[key];
  }
  return value;
}

function waiverDocumentFrom(value: unknown): Record<string, unknown> | null {
  const data = envelopeData(value);
  const candidate = nestedRecord(data, ["waiver", "document"]);
  if (!candidate) return null;
  return typeof candidate.version === "string" &&
    typeof candidate.hash === "string" &&
    /^[a-f0-9]{64}$/i.test(candidate.hash) &&
    typeof candidate.title === "string" &&
    Array.isArray(candidate.sections)
    ? candidate
    : null;
}

function appendLegalBlock(parent: HTMLElement, block: unknown): void {
  if (!isRecord(block)) return;
  if (block.kind === "list" && Array.isArray(block.items)) {
    const list = document.createElement("ul");
    for (const item of block.items) {
      if (typeof item !== "string") continue;
      const listItem = document.createElement("li");
      listItem.textContent = item;
      list.appendChild(listItem);
    }
    parent.appendChild(list);
    return;
  }
  if (block.kind === "paragraph" && typeof block.text === "string") {
    const paragraph = document.createElement("p");
    paragraph.textContent = block.text;
    parent.appendChild(paragraph);
  }
}

function renderWaiverDocument(documentValue: Record<string, unknown>): void {
  const root = document.querySelector<HTMLElement>("[data-waiver-legal-body]");
  if (!root) return;
  const fragment = document.createDocumentFragment();
  const title = document.createElement("h3");
  const version = document.createElement("p");
  title.textContent = text(documentValue.title, "Participation waiver");
  version.className = "legal-updated";
  version.textContent = `Version ${text(documentValue.version, "unavailable")} · Effective ${text(documentValue.effectiveDateLabel, text(documentValue.effectiveDate, "date unavailable"))}`;
  fragment.append(title, version);

  if (typeof documentValue.intro === "string") {
    const intro = document.createElement("p");
    intro.textContent = documentValue.intro;
    fragment.appendChild(intro);
  }
  for (const rawSection of documentValue.sections as unknown[]) {
    if (!isRecord(rawSection)) continue;
    const section = document.createElement("section");
    const heading = document.createElement("h4");
    section.className = "waiver-legal-section";
    heading.textContent = `${typeof rawSection.number === "number" ? `${rawSection.number}. ` : ""}${text(rawSection.title, "Waiver section")}`;
    section.appendChild(heading);
    if (Array.isArray(rawSection.blocks)) {
      for (const block of rawSection.blocks) appendLegalBlock(section, block);
    }
    fragment.appendChild(section);
  }
  root.replaceChildren(fragment);
}

async function fetchCurrentWaiverDocument(signal?: AbortSignal): Promise<Record<string, unknown>> {
  const response = await fetch("/api/v1/legal/waiver", {
    headers: { Accept: "application/json" },
    cache: "no-store",
    credentials: "same-origin",
    signal: requestSignal(10_000, signal),
  });
  const payload: unknown = await response.json().catch(() => null);
  const documentValue = waiverDocumentFrom(payload);
  if (!response.ok || !documentValue) {
    throw new Error(profileErrorMessage(payload, "The current participation waiver could not be loaded."));
  }
  return documentValue;
}

function reviewIdFrom(value: unknown): string {
  const data = envelopeData(value);
  const candidate = nestedRecord(data, ["review"]);
  if (!candidate) return "";
  for (const key of ["reviewEventId", "id"] as const) {
    if (typeof candidate[key] === "string" && candidate[key].trim()) return candidate[key].trim();
  }
  return "";
}

function waiverErrorCode(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const error = isRecord(payload.error) ? payload.error : payload;
  return typeof error.code === "string" && error.code.trim() ? error.code.trim() : null;
}

export async function waiverWrite(
  auth: HunterAuthHook | null,
  route: string,
  body?: Record<string, unknown>,
  idempotencyKey?: string,
  signal?: AbortSignal,
): Promise<unknown> {
  const headers = await authHeaders(auth);
  headers.set("Content-Type", "application/json");
  if (idempotencyKey) headers.set("Idempotency-Key", idempotencyKey);
  const response = await protectedFetch(route, {
    method: "POST",
    headers,
    credentials: "same-origin",
    body: JSON.stringify(body ?? {}),
    signal: requestSignal(12_000, signal),
  }, signal);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    throw new WaiverRequestError(
      response.status,
      waiverErrorCode(payload),
      profileErrorMessage(payload, "The waiver request could not be completed."),
    );
  }
  return payload;
}

function setWaiverResult(copy: string, kind: "success" | "error", focus = false): void {
  const result = document.querySelector<HTMLElement>("[data-waiver-result]");
  if (!result) return;
  result.textContent = copy;
  result.dataset.kind = kind;
  result.hidden = false;
  if (focus) result.focus();
}

function minorRows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[data-minor-row]")];
}

function updateMinorControls(): void {
  const rows = minorRows();
  const add = document.querySelector<HTMLButtonElement>("[data-add-minor]");
  const fieldset = document.querySelector<HTMLElement>("[data-minors-fieldset]");
  const guardian = document.querySelector<HTMLElement>("[data-guardian-confirmation]");
  const guardianInput = document.querySelector<HTMLInputElement>('input[name="guardianAttested"]');
  if (add) {
    add.disabled = rows.length >= 10;
    if (fieldset?.hidden === true) add.disabled = true;
  }
  if (guardian) guardian.hidden = rows.length === 0;
  if (rows.length === 0 && guardianInput) guardianInput.checked = false;
  rows.forEach((row, index) => {
    const nameLabel = row.querySelector<HTMLLabelElement>("[data-minor-name-label]");
    const yearLabel = row.querySelector<HTMLLabelElement>("[data-minor-year-label]");
    if (nameLabel) nameLabel.firstChild!.textContent = `Minor ${index + 1} full name `;
    if (yearLabel) yearLabel.firstChild!.textContent = `Minor ${index + 1} birth year `;
  });
}

function createMinorRow(): void {
  const rowsRoot = document.querySelector<HTMLElement>("[data-minor-rows]");
  const add = document.querySelector<HTMLButtonElement>("[data-add-minor]");
  if (!rowsRoot || minorRows().length >= 10) return;
  minorRowSequence += 1;
  const rowId = `waiver-minor-${minorRowSequence}`;
  const row = document.createElement("div");
  const nameField = document.createElement("div");
  const nameLabel = document.createElement("label");
  const nameInput = document.createElement("input");
  const yearField = document.createElement("div");
  const yearLabel = document.createElement("label");
  const yearInput = document.createElement("input");
  const remove = document.createElement("button");

  row.className = "minor-row";
  row.dataset.minorRow = "";
  nameField.className = "form-field";
  yearField.className = "form-field";
  nameLabel.dataset.minorNameLabel = "";
  yearLabel.dataset.minorYearLabel = "";
  nameLabel.append("Minor full name ");
  yearLabel.append("Minor birth year ");
  nameLabel.htmlFor = `${rowId}-name`;
  yearLabel.htmlFor = `${rowId}-year`;
  nameInput.id = `${rowId}-name`;
  nameInput.name = "minorFullName";
  nameInput.type = "text";
  nameInput.maxLength = 100;
  nameInput.autocomplete = "off";
  nameInput.value = "";
  yearInput.id = `${rowId}-year`;
  yearInput.name = "minorBirthYear";
  yearInput.type = "text";
  yearInput.inputMode = "numeric";
  yearInput.pattern = "[0-9]{4}";
  yearInput.maxLength = 4;
  yearInput.autocomplete = "off";
  remove.className = "minor-remove";
  remove.type = "button";
  remove.textContent = "Remove minor";
  remove.addEventListener("click", () => {
    row.remove();
    updateMinorControls();
    add?.focus();
  });
  nameLabel.appendChild(nameInput);
  yearLabel.appendChild(yearInput);
  nameField.appendChild(nameLabel);
  yearField.appendChild(yearLabel);
  row.append(nameField, yearField, remove);
  rowsRoot.appendChild(row);
  updateMinorControls();
  nameInput.focus();
}

function readWaiverDraft(): WaiverDraft {
  const participationBasis = document.querySelector<HTMLInputElement>(
    '[data-profile-form] input[name="participationBasis"]:checked',
  )?.value ?? "";
  const minors = waiverMinorsForParticipationBasis(participationBasis, minorRows().map((row) => ({
    fullName: row.querySelector<HTMLInputElement>('input[name="minorFullName"]')?.value ?? "",
    birthYear: row.querySelector<HTMLInputElement>('input[name="minorBirthYear"]')?.value ?? "",
  })));
  return {
    reviewEventId: waiverReviewEventId,
    version: typeof activeWaiverDocument?.version === "string" ? activeWaiverDocument.version : "",
    hash: typeof activeWaiverDocument?.hash === "string" ? activeWaiverDocument.hash : "",
    waiverAccepted: document.querySelector<HTMLInputElement>("#waiver-accepted")?.checked ?? false,
    guardianAttested: document.querySelector<HTMLInputElement>('input[name="guardianAttested"]')?.checked ?? false,
    minors,
  };
}

function showWaiverErrors(errors: WaiverErrors): void {
  const summary = document.querySelector<HTMLElement>("[data-waiver-errors]");
  for (const control of document.querySelectorAll<HTMLElement>("[data-waiver-form] [aria-invalid]")) {
    control.removeAttribute("aria-invalid");
  }
  const targets: Record<keyof WaiverErrors, string> = {
    review: "[data-waiver-review-link]",
    waiverAccepted: "#waiver-accepted",
    guardianAttested: 'input[name="guardianAttested"]',
    minors: "[data-minors-fieldset]",
  };
  let firstTarget: HTMLElement | null = null;
  for (const field of Object.keys(errors) as (keyof WaiverErrors)[]) {
    const target = document.querySelector<HTMLElement>(targets[field]);
    target?.setAttribute("aria-invalid", "true");
    firstTarget ??= target;
  }
  if (!summary) return;
  summary.replaceChildren();
  const messages = Object.values(errors);
  summary.hidden = messages.length === 0;
  if (!messages.length) return;
  const heading = document.createElement("strong");
  const list = document.createElement("ul");
  heading.textContent = "Please fix this:";
  for (const copy of messages) {
    const item = document.createElement("li");
    item.textContent = copy;
    list.appendChild(item);
  }
  summary.append(heading, list);
  summary.focus();
  firstTarget?.scrollIntoView({ block: "center" });
}

function acceptanceRecordFrom(value: unknown): Record<string, unknown> | null {
  const data = envelopeData(value);
  if (!isRecord(data)) return null;
  const candidate = nestedRecord(data, ["acceptance", "waiver"]);
  if (!candidate) return null;
  return typeof candidate.acceptedAt === "string" ||
    typeof candidate.referenceCode === "string" ||
    isRecord(candidate.receipt)
    ? candidate
    : null;
}

export function parseWaiverAcceptanceProjection(value: unknown): WaiverAcceptanceProjection | null {
  const data = envelopeData(value);
  if (!isRecord(data)) return null;
  const acceptance = acceptanceRecordFrom(data.acceptance);
  const documentValue = waiverDocumentFrom(data.document);
  if (!acceptance || !documentValue || !exactAcceptedWaiverDocument(acceptance, documentValue)) return null;
  return { acceptance, document: documentValue };
}

function acceptanceVersion(acceptance: Record<string, unknown>): string {
  return text(acceptance.documentVersion ?? acceptance.version, "Unavailable");
}

function waiverDocumentMatchesAcceptance(documentValue: Record<string, unknown>, acceptance: Record<string, unknown>): boolean {
  return documentValue.version === (acceptance.documentVersion ?? acceptance.version) &&
    documentValue.hash === (acceptance.documentHash ?? acceptance.hash);
}

function appendAcceptanceDetail(root: HTMLDListElement, label: string, value: string): void {
  const term = document.createElement("dt");
  const description = document.createElement("dd");
  term.textContent = label;
  description.textContent = value;
  root.append(term, description);
}

export function waiverReceiptPresentation(receipt: unknown): {
  status: string;
  message: string;
  resendDisabled: boolean;
} {
  const state = isRecord(receipt) && typeof receipt.status === "string" ? receipt.status : "pending";
  if (state === "sent") {
    return {
      status: state,
      message: "Receipt sent to your verified account email.",
      resendDisabled: false,
    };
  }
  if (state === "uncertain") {
    return {
      status: state,
      message: "Your email provider may have accepted this receipt, but the confirmation response was interrupted. To prevent duplicates, another copy is temporarily blocked while the case team checks the configured sender mailbox Sent Items or the provider delivery log.",
      resendDisabled: true,
    };
  }
  if (state === "failed") {
    return {
      status: state,
      message: "Your acceptance is stored, but the receipt email could not be delivered. You can try again.",
      resendDisabled: false,
    };
  }
  return {
    status: "pending",
    message: "Your acceptance is stored. The receipt email is pending.",
    resendDisabled: false,
  };
}

function renderReceiptStatus(receipt: unknown): void {
  const status = document.querySelector<HTMLElement>("[data-waiver-receipt-status]");
  if (!status) return;
  const presentation = waiverReceiptPresentation(receipt);
  status.dataset.receiptStatus = presentation.status;
  status.textContent = presentation.message;
  const resend = document.querySelector<HTMLButtonElement>("[data-resend-waiver-receipt]");
  if (resend) resend.disabled = presentation.resendDisabled;
}

function renderStoredAcceptance(acceptance: Record<string, unknown>): void {
  currentWaiverAcceptance = acceptance;
  const form = document.querySelector<HTMLFormElement>("[data-waiver-form]");
  const receiptPanel = document.querySelector<HTMLElement>("[data-waiver-receipt]");
  const details = document.querySelector<HTMLDListElement>("[data-waiver-acceptance-details]");
  const participantsRoot = document.querySelector<HTMLElement>("[data-waiver-participants]");
  if (form) form.hidden = true;
  if (receiptPanel) receiptPanel.hidden = false;
  if (details) {
    details.replaceChildren();
    appendAcceptanceDetail(details, "Waiver version", acceptanceVersion(acceptance));
    appendAcceptanceDetail(details, "Accepted", text(acceptance.acceptedAt, "Time unavailable"));
    appendAcceptanceDetail(details, "Confirmation reference", text(acceptance.referenceCode, "Unavailable"));
  }
  if (participantsRoot) {
    participantsRoot.replaceChildren();
    const heading = document.createElement("h4");
    const list = document.createElement("ul");
    heading.textContent = "Covered participants";
    const participants = Array.isArray(acceptance.participants) ? acceptance.participants : [];
    for (const participant of participants) {
      if (!isRecord(participant)) continue;
      const item = document.createElement("li");
      const participantName = text(participant.fullName, "Participant");
      item.textContent = typeof participant.birthYear === "number"
        ? `${participantName} (birth year ${participant.birthYear})`
        : participantName;
      list.appendChild(item);
    }
    participantsRoot.append(heading, list);
  }
  renderReceiptStatus(acceptance.receipt);
  const print = document.querySelector<HTMLButtonElement>("[data-print-waiver]");
  const legalBody = document.querySelector<HTMLElement>("[data-waiver-legal-body]");
  if (print) {
    print.disabled = !(acceptedWaiverDocument && legalBody && !legalBody.hidden &&
      waiverDocumentMatchesAcceptance(acceptedWaiverDocument, acceptance));
  }
}

function renderWaiverAcceptanceProjection(projection: WaiverAcceptanceProjection): void {
  currentWaiverAcceptance = projection.acceptance;
  acceptedWaiverDocument = projection.document;
  renderStoredAcceptance(projection.acceptance);
}

async function fetchWaiverAcceptanceProjection(
  auth: HunterAuthHook | null,
  signal?: AbortSignal,
): Promise<WaiverAcceptanceProjection | null> {
  const response = await protectedFetch("/api/v1/me/waiver", {
    headers: await authHeaders(auth),
    cache: "no-store",
    credentials: "same-origin",
    signal: requestSignal(10_000, signal),
  }, signal);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ProtectedAccountRequestError(response.status, waiverErrorCode(payload));
  return parseWaiverAcceptanceProjection(payload);
}

async function loadCurrentWaiverAcceptance(
  auth: HunterAuthHook | null,
  signal?: AbortSignal,
): Promise<WaiverAcceptanceProjection | null> {
  const projection = await fetchWaiverAcceptanceProjection(auth, signal);
  throwIfAborted(signal);
  if (projection) renderWaiverAcceptanceProjection(projection);
  return projection;
}

function resetOutdatedWaiverState(): void {
  activeWaiverDocument = null;
  waiverReviewEventId = "";
  retainedWaiverIdempotencyKey = null;
  const acceptanceInput = document.querySelector<HTMLInputElement>("#waiver-accepted");
  const acceptanceCopy = document.querySelector<HTMLElement>("[data-waiver-acceptance-statement]");
  if (acceptanceInput) {
    acceptanceInput.checked = false;
    acceptanceInput.disabled = true;
  }
  if (acceptanceCopy) {
    acceptanceCopy.textContent = "The waiver changed. Open and review the current document before accepting it.";
  }
}

async function initializeWaiverExperience(
  auth: HunterAuthHook | null,
  profileComplete: boolean,
  signal?: AbortSignal,
): Promise<void> {
  const panel = document.querySelector<HTMLElement>("[data-waiver-panel]");
  if (!panel) return;
  panel.hidden = !profileComplete;

  if (panel.dataset.waiverInitialized !== "true") {
    panel.dataset.waiverInitialized = "true";
    const reviewLink = document.querySelector<HTMLAnchorElement>("[data-waiver-review-link]");
    const acceptanceInput = document.querySelector<HTMLInputElement>("#waiver-accepted");
    const acceptanceCopy = document.querySelector<HTMLElement>("[data-waiver-acceptance-statement]");
    const legalBody = document.querySelector<HTMLElement>("[data-waiver-legal-body]");
    const addMinor = document.querySelector<HTMLButtonElement>("[data-add-minor]");
    const waiverForm = document.querySelector<HTMLFormElement>("[data-waiver-form]");

    addMinor?.addEventListener("click", createMinorRow);
    updateMinorControls();

    const activateWaiverReview = reviewLink
      ? createSerializedWaiverReviewActivation(async () => {
        reviewLink.setAttribute("aria-busy", "true");
        try {
          const reviewed = await performWaiverReview({
            fetchDocument: fetchCurrentWaiverDocument,
            renderAndReveal: (documentValue) => {
              activeWaiverDocument = documentValue;
              waiverReviewEventId = "";
              renderWaiverDocument(documentValue);
              if (legalBody) legalBody.hidden = false;
              reviewLink.setAttribute("aria-expanded", "true");
              if (acceptanceCopy && typeof documentValue.acceptanceStatement === "string") {
                acceptanceCopy.textContent = documentValue.acceptanceStatement;
              }
            },
            recordReview: async (documentValue) => {
              const reviewPayload = await waiverWrite(auth, "/api/v1/me/waiver/review", {
                version: documentValue.version,
                hash: documentValue.hash,
              });
              return reviewIdFrom(reviewPayload);
            },
            setAcceptanceEnabled: (enabled) => {
              if (!acceptanceInput) return;
              acceptanceInput.disabled = !enabled;
              if (!enabled) acceptanceInput.checked = false;
            },
          });
          activeWaiverDocument = reviewed.document;
          waiverReviewEventId = reviewed.reviewEventId;
          showWaiverErrors({});
          setWaiverResult("The current waiver review is recorded. You may now accept it.", "success");
        } catch (error) {
          setWaiverResult(error instanceof Error ? error.message : "The waiver review could not be recorded.", "error", true);
        } finally {
          reviewLink.removeAttribute("aria-busy");
        }
      })
      : null;

    reviewLink?.addEventListener("click", (event) => {
      event.preventDefault();
      if (waiverReviewEventId && activeWaiverDocument && legalBody) {
        legalBody.hidden = !legalBody.hidden;
        reviewLink.setAttribute("aria-expanded", String(!legalBody.hidden));
        return;
      }
      void activateWaiverReview?.();
    });

    waiverForm?.addEventListener("submit", async (event) => {
      event.preventDefault();
      const draft = readWaiverDraft();
      const errors = validateWaiverDraft(draft);
      showWaiverErrors(errors);
      if (Object.keys(errors).length) return;
      const submit = document.querySelector<HTMLButtonElement>("[data-waiver-submit]");
      if (submit) submit.disabled = true;
      retainedWaiverIdempotencyKey ??= crypto.randomUUID();
      let acceptanceStored = false;
      try {
        const outcome = await performWaiverAcceptance({
          accept: async () => {
            await waiverWrite(
              auth,
              "/api/v1/me/waiver/accept",
              buildWaiverPayload(draft),
              retainedWaiverIdempotencyKey ?? undefined,
            );
            acceptanceStored = true;
            retainedWaiverIdempotencyKey = null;
          },
          loadProjection: async () => {
            const projection = await fetchWaiverAcceptanceProjection(auth);
            if (!projection) {
              throw new Error("Your acceptance was stored, but its confirmation could not be loaded. Refresh to retrieve it.");
            }
            return projection;
          },
          fetchDashboard: () => fetchDashboardData(auth),
          renderDashboard,
          renderProjection: renderWaiverAcceptanceProjection,
          resetOutdatedState: resetOutdatedWaiverState,
        });
        setWaiverResult(
          waiverAcceptanceResultMessage(outcome.dashboardRefreshed),
          "success",
        );
      } catch (error) {
        setWaiverResult(error instanceof Error ? error.message : "The waiver could not be accepted.", "error", true);
      } finally {
        if (submit && !acceptanceStored && !currentWaiverAcceptance) submit.disabled = false;
      }
    });

    document.querySelector<HTMLButtonElement>("[data-view-accepted-waiver]")?.addEventListener("click", async () => {
      if (!currentWaiverAcceptance) return;
      try {
        await performAcceptedWaiverView(acceptedWaiverDocument, (documentValue) => {
          renderWaiverDocument(documentValue);
          if (legalBody) legalBody.hidden = false;
          reviewLink?.setAttribute("aria-expanded", "true");
          const print = document.querySelector<HTMLButtonElement>("[data-print-waiver]");
          if (print) print.disabled = false;
        });
      } catch (error) {
        setWaiverResult(error instanceof Error ? error.message : "The accepted waiver could not be loaded.", "error", true);
      }
    });

    document.querySelector<HTMLButtonElement>("[data-print-waiver]")?.addEventListener("click", () => {
      window.print();
    });

    document.querySelector<HTMLButtonElement>("[data-resend-waiver-receipt]")?.addEventListener("click", async (event) => {
      const button = event.currentTarget;
      if (!(button instanceof HTMLButtonElement)) return;
      button.disabled = true;
      const status = document.querySelector<HTMLElement>("[data-waiver-receipt-status]");
      if (status) status.textContent = "Requesting another receipt email…";
      try {
        await waiverWrite(auth, "/api/v1/me/waiver/receipt");
        if (status) status.textContent = "Receipt resend queued for your verified account email.";
      } catch (error) {
        if (status) status.textContent = error instanceof Error ? error.message : "The receipt could not be queued.";
      } finally {
        button.disabled = status?.dataset.receiptStatus === "uncertain";
      }
    });
  }

  if (profileComplete && !currentWaiverAcceptance) {
    try {
      await loadCurrentWaiverAcceptance(auth, signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      setWaiverResult(error instanceof Error ? error.message : "Your waiver status could not be loaded.", "error");
      throw error;
    }
  }
}

function authMessage(copy: string, kind: "info" | "error" | "success" = "info"): void {
  const element = document.querySelector<HTMLElement>("[data-auth-message]");
  if (!element) return;
  element.dataset.kind = kind;
  element.textContent = copy;
}

function identityError(error: unknown, fallback: string): string {
  if (!isRecord(error)) return fallback;
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const first = errors.find(isRecord);
  const candidate = first && (first.longMessage ?? first.message);
  return typeof candidate === "string" && candidate.trim() ? candidate : fallback;
}

function identityDiagnostic(error: unknown): { code: string | null; status: number | null } {
  if (!isRecord(error)) return { code: null, status: null };
  const errors = Array.isArray(error.errors) ? error.errors : [];
  const first = errors.find(isRecord);
  const rawCode = first?.code ?? error.code;
  return {
    code: typeof rawCode === "string" && /^[a-z0-9_-]{1,80}$/i.test(rawCode) ? rawCode : null,
    status: typeof error.status === "number" && Number.isInteger(error.status) ? error.status : null,
  };
}

function showAuthForm(id: string): void {
  for (const form of document.querySelectorAll<HTMLElement>(".auth-form")) {
    form.hidden = form.id !== id;
  }
  document.getElementById(id)?.querySelector<HTMLElement>("input, select, textarea, button")?.focus();
}

function setSignupVerificationStatus(copy: string, kind: "info" | "error" | "success" = "info"): void {
  const status = document.querySelector<HTMLElement>("[data-signup-verification-status]");
  if (!status) return;
  status.dataset.kind = kind;
  status.textContent = copy;
}

function showSignupVerification(resume: HunterSignupResumeRecord, status: string): void {
  const maskedEmail = document.querySelector<HTMLElement>("[data-signup-masked-email]");
  if (maskedEmail) maskedEmail.textContent = resume.maskedEmail;
  showAuthForm("hunter-verify-form");
  setSignupVerificationStatus(status);
}

function showLostSignupAttempt(copy: string): void {
  showAuthForm("hunter-signup-lost-state");
  const detail = document.querySelector<HTMLElement>("[data-signup-lost-detail]");
  if (detail) detail.textContent = copy;
  const heading = document.querySelector<HTMLElement>("#hunter-signup-lost-state h3");
  heading?.setAttribute("tabindex", "-1");
  heading?.focus();
}

function showSignupFinishing(
  copy: string,
  options: { retryAvailable?: boolean; kind?: "info" | "error" | "success" } = {},
): void {
  const finishing = document.querySelector<HTMLElement>("#hunter-signup-finishing-state");
  const shouldFocusHeading = finishing?.hidden !== false;
  const gate = document.querySelector<HTMLElement>("[data-dashboard-state]");
  const content = document.querySelector<HTMLElement>("[data-dashboard-content]");
  if (gate) {
    gate.hidden = false;
    gate.dataset.dashboardState = "finishing";
  }
  if (content) content.hidden = true;
  showAuthForm("hunter-signup-finishing-state");
  const status = document.querySelector<HTMLElement>("[data-signup-finishing-status]");
  if (status) {
    status.dataset.kind = options.kind ?? "info";
    status.textContent = copy;
  }
  const retry = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
  if (retry) retry.hidden = options.retryAvailable !== true;
  if (shouldFocusHeading) document.querySelector<HTMLElement>("#hunter-signup-finishing-title")?.focus();
}

function showProvisioningProgress(_elapsedMilliseconds: number, nextAttempt: number, totalAttempts: number): void {
  showSignupFinishing(
    `Your email is verified. Secure account setup is still synchronizing. Check ${nextAttempt} of ${totalAttempts} will run automatically; this can take about 30 seconds.`,
  );
}

function browserSignupResumeStore(config: PublicConfig): HunterSignupResumeStore {
  const storage = (kind: "sessionStorage" | "localStorage"): Storage | null => {
    try {
      return window[kind];
    } catch {
      return null;
    }
  };
  return createHunterSignupResumeStore({
    sessionStorage: storage("sessionStorage"),
    localStorage: storage("localStorage"),
    namespace: `${window.location.origin}:${config.deploymentEnvironment ?? "unknown"}`,
  });
}

export async function waitForActiveSession(
  sessionId: string,
  readSession: () => { id: string; getToken: () => Promise<string | null> } | null | undefined,
  delay: (milliseconds: number) => Promise<void>,
  attempts = 10,
): Promise<boolean> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const session = readSession();
    if (session?.id === sessionId) {
      try {
        if (await session.getToken()) return true;
      } catch {
        // Clerk can briefly reject token reads while the new session propagates.
      }
    }
    await delay(150 * (attempt + 1));
  }
  return false;
}

async function activateSession(sessionId: string | null | undefined): Promise<boolean> {
  if (!hunterClerk || !sessionId) return false;
  await hunterClerk.setActive({ session: sessionId });
  return waitForActiveSession(
    sessionId,
    () => hunterClerk?.session,
    (milliseconds) => new Promise<void>((resolve) => window.setTimeout(resolve, milliseconds)),
  );
}

export const PLAYER_BOOTSTRAP_RETRY_DELAYS_MS = [1_000, 4_000, 10_000, 15_000] as const;

export type PlayerBootstrapFailureClassification = "retryable" | "terminal";

export function classifyPlayerBootstrapFailure(status: number): PlayerBootstrapFailureClassification {
  return status === 0 || status === 408 || status === 409 || status === 425 || status === 429 || status >= 500
    ? "retryable"
    : "terminal";
}

export function provisioningFailureMessage(classification: PlayerBootstrapFailureClassification): string {
  return classification === "retryable"
    ? "Your email is verified. Account setup is still syncing, so automatic checks have paused. Try again now or refresh later."
    : "Your email is verified, but this session cannot continue account setup. Sign out, then sign in again. Contact support if this continues.";
}

export class PlayerBootstrapError extends Error {
  constructor(
    readonly classification: PlayerBootstrapFailureClassification,
    readonly automaticRetriesExhausted: boolean,
  ) {
    super(provisioningFailureMessage(classification));
    this.name = "PlayerBootstrapError";
  }
}

export class ProtectedAccountRequestError extends PlayerBootstrapError {
  constructor(
    readonly status: number,
    readonly code: string | null,
  ) {
    super(classifyPlayerBootstrapFailure(status), false);
    this.name = "ProtectedAccountRequestError";
  }
}

function provisioningRequestClassification(error: unknown): PlayerBootstrapFailureClassification {
  if (error instanceof PlayerBootstrapError) return error.classification;
  if (error instanceof WaiverRequestError) return classifyPlayerBootstrapFailure(error.status);
  return "retryable";
}

export async function signOutVerifiedAccount(
  providerSignOut: () => Promise<void>,
  clearLocalResume: () => void,
): Promise<void> {
  await providerSignOut();
  clearLocalResume();
}

type HunterSignOutHandler = (button: HTMLButtonElement) => Promise<void>;

const hunterSignOutHandlers = new WeakMap<HTMLButtonElement, HunterSignOutHandler>();

function bindHunterSignOutControls(handler: HunterSignOutHandler): void {
  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-hunter-sign-out]")) {
    hunterSignOutHandlers.set(button, handler);
    if (button.dataset.accountSignOutBound === "true") continue;
    button.dataset.accountSignOutBound = "true";
    button.addEventListener("click", () => {
      const current = hunterSignOutHandlers.get(button);
      if (current) void current(button);
    });
  }
}

function disableFinishingRetry(): void {
  const retry = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
  if (!retry) return;
  retry.hidden = true;
  retry.disabled = true;
}

function verifiedSignOutHandler(
  invalidateOperations: () => void,
  clearLocalResume: () => void,
): HunterSignOutHandler {
  return async (button) => {
    button.disabled = true;
    invalidateOperations();
    disableFinishingRetry();
    try {
      await signOutVerifiedAccount(
        async () => { await hunterClerk?.signOut(); },
        clearLocalResume,
      );
      window.location.reload();
    } catch {
      showSignupFinishing(
        "Your verified session is still active because sign out could not finish. Try again, refresh later, or contact support.",
        { retryAvailable: false, kind: "error" },
      );
      disableFinishingRetry();
      button.disabled = false;
    }
  };
}

interface PlayerBootstrapResponse {
  ok: boolean;
  status: number;
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DOMException("The account operation was cancelled.", "AbortError");
}

function requestSignal(timeoutMilliseconds: number, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(timeoutMilliseconds);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}

async function protectedFetch(
  input: RequestInfo | URL,
  init: RequestInit,
  operationSignal?: AbortSignal,
): Promise<Response> {
  try {
    return await fetch(input, init);
  } catch {
    throwIfAborted(operationSignal);
    throw new ProtectedAccountRequestError(0, null);
  }
}

export interface AbortableDelayTimers {
  setTimeout: (callback: () => void, milliseconds: number) => number;
  clearTimeout: (handle: number) => void;
}

export function abortableDelay(
  milliseconds: number,
  signal?: AbortSignal,
  timers?: AbortableDelayTimers,
): Promise<void> {
  const schedule = timers?.setTimeout ?? ((callback, delay) => window.setTimeout(callback, delay));
  const clear = timers?.clearTimeout ?? ((handle) => window.clearTimeout(handle));
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("The account operation was cancelled.", "AbortError"));
      return;
    }
    let settled = false;
    let timer: number | null = null;
    const cleanup = (): void => {
      if (timer !== null) {
        clear(timer);
        timer = null;
      }
      signal?.removeEventListener("abort", abort);
    };
    const abort = (): void => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new DOMException("The account operation was cancelled.", "AbortError"));
    };
    signal?.addEventListener("abort", abort, { once: true });
    timer = schedule(() => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve();
    }, milliseconds);
  });
}

async function waitForAbortableDelay(
  pending: Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  if (!signal) return pending;
  throwIfAborted(signal);
  let removeAbortListener = (): void => {};
  const cancelled = new Promise<never>((_resolve, reject) => {
    const abort = (): void => reject(new DOMException("The account operation was cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    removeAbortListener = () => signal.removeEventListener("abort", abort);
  });
  try {
    await Promise.race([pending, cancelled]);
  } finally {
    removeAbortListener();
  }
}

export async function retryPlayerBootstrap(
  attemptBootstrap: () => Promise<PlayerBootstrapResponse>,
  delay: (milliseconds: number, signal?: AbortSignal) => Promise<void>,
  onProgress?: (elapsedMilliseconds: number, nextAttempt: number, totalAttempts: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  let elapsedMilliseconds = 0;
  const totalAttempts = PLAYER_BOOTSTRAP_RETRY_DELAYS_MS.length + 1;
  for (let attempt = 0; attempt < totalAttempts; attempt += 1) {
    throwIfAborted(signal);
    let response: PlayerBootstrapResponse;
    try {
      response = await attemptBootstrap();
    } catch {
      throwIfAborted(signal);
      if (attempt === totalAttempts - 1) throw new PlayerBootstrapError("retryable", true);
      const wait = PLAYER_BOOTSTRAP_RETRY_DELAYS_MS[attempt] ?? 0;
      onProgress?.(elapsedMilliseconds, attempt + 2, totalAttempts);
      await waitForAbortableDelay(delay(wait, signal), signal);
      elapsedMilliseconds += wait;
      continue;
    }
    throwIfAborted(signal);
    if (response.ok) return;
    const classification = classifyPlayerBootstrapFailure(response.status);
    if (classification === "terminal") throw new PlayerBootstrapError(classification, false);
    if (attempt === totalAttempts - 1) throw new PlayerBootstrapError(classification, true);
    const wait = PLAYER_BOOTSTRAP_RETRY_DELAYS_MS[attempt] ?? 0;
    onProgress?.(elapsedMilliseconds, attempt + 2, totalAttempts);
    await waitForAbortableDelay(delay(wait, signal), signal);
    elapsedMilliseconds += wait;
  }
}

async function bootstrapPlayer(
  auth: HunterAuthHook,
  onProgress?: (elapsedMilliseconds: number, nextAttempt: number, totalAttempts: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  await retryPlayerBootstrap(async () => {
    const headers = await authHeaders(auth);
    headers.set("Content-Type", "application/json");
    return await fetch("/api/v1/me/bootstrap", {
      method: "POST",
      headers,
      credentials: "same-origin",
      body: "{}",
      signal: requestSignal(8_000, signal),
    });
  }, abortableDelay, onProgress, signal);
}

async function loadSignedInDashboard(auth: HunterAuthHook, signal?: AbortSignal): Promise<void> {
  await bootstrapPlayer(auth, showProvisioningProgress, signal);
  const response = await fetchDashboard(auth, signal);
  const envelope: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ProtectedAccountRequestError(response.status, waiverErrorCode(envelope));
  if (!isRecord(envelope) || !isRecord(envelope.data)) throw new Error("Your dashboard could not be loaded.");
  renderDashboard(envelope.data);
  await initializeProfileForm(
    auth,
    envelope.data.profile,
    envelope.data.privacyMediaRequired === true,
  );
  await initializeWaiverExperience(
    auth,
    isRecord(envelope.data.profile) && envelope.data.privacyMediaRequired !== true,
    signal,
  );
}

function readHunterSignupDraft(form: HTMLFormElement): HunterSignupDraft {
  const data = new FormData(form);
  const reviewedIdentity = (prefix: "privacyMedia" | "waiver"): LegalDocumentIdentity | null => {
    const value = {
      version: form.dataset[`${prefix}Version`],
      hash: form.dataset[`${prefix}Hash`],
    };
    return isLegalDocumentIdentity(value) ? value : null;
  };
  return {
    fullName: String(data.get("fullName") ?? ""),
    emailAddress: String(data.get("email") ?? "").trim().toLowerCase(),
    password: String(data.get("password") ?? ""),
    confirmation: String(data.get("confirmPassword") ?? ""),
    participationBasis: String(data.get("participationBasis") ?? "") as HunterSignupDraft["participationBasis"],
    guardianPermissionAttested: data.get("guardianPermissionAttested") === "on",
    privacyMediaReviewed: form.dataset.privacyMediaReviewed === "true",
    privacyMediaAccepted: data.get("privacyMediaAccepted") === "on",
    privacyMediaDocument: reviewedIdentity("privacyMedia"),
    waiverReviewed: form.dataset.waiverReviewed === "true",
    waiverAccepted: data.get("waiverAccepted") === "on",
    waiverDocument: reviewedIdentity("waiver"),
  };
}

function showHunterSignupErrors(form: HTMLFormElement, errors: HunterSignupErrors): void {
  const summary = form.querySelector<HTMLElement>("[data-signup-errors]");
  if (!summary) return;
  const messages = Object.values(errors);
  summary.textContent = messages.join(" ");
  summary.hidden = messages.length === 0;
  if (messages.length) summary.focus();
}

function reloadSignupLegalViewer(
  url: string,
  kind: SignupLegalDocumentKind,
  load: SignupLegalViewerLoadLease,
  loads: SignupLegalViewerLoadCoordinator,
): Promise<void> {
  const signal = load.signal;
  if (signal.aborted) return Promise.reject(new DOMException("The legal document load was cancelled.", "AbortError"));
  const viewer = loads.prepareFrame(load);
  if (!viewer) return Promise.reject(new Error("The legal document viewer is unavailable."));
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const timeout = window.setTimeout(() => {
      finish(() => reject(new Error("The embedded legal document could not be displayed. Use the full-page link below.")));
    }, 12_000);
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timeout);
      window.removeEventListener("message", handleReadyMessage);
      signal.removeEventListener("abort", handleAbort);
      callback();
    };
    const handleReadyMessage = (event: MessageEvent): void => {
      if (event.origin !== window.location.origin) return;
      if (event.source !== viewer.contentWindow) return;
      if (!isRecord(event.data) || event.data.type !== "tim-lost:legal-embed-ready" ||
          event.data.embed !== "signup") return;
      const expectedRoute = kind === "privacy-media" ? "privacy" : "waiver";
      if (event.data.route !== expectedRoute) return;
      finish(resolve);
    };
    const handleAbort = (): void => {
      finish(() => reject(new DOMException("The legal document load was cancelled.", "AbortError")));
    };
    window.addEventListener("message", handleReadyMessage);
    signal.addEventListener("abort", handleAbort, { once: true });
    viewer.addEventListener(
      "error",
      () => finish(() => reject(new Error("The embedded legal document could not be displayed. Use the full-page link below."))),
      { once: true },
    );
    viewer.src = url;
  });
}

function storeSignupLegalIdentity(
  form: HTMLFormElement,
  kind: SignupLegalDocumentKind,
  identity: LegalDocumentIdentity | null,
): void {
  if (!identity) return;
  const prefix = kind === "privacy-media" ? "privacyMedia" : "waiver";
  const previousValue = {
    version: form.dataset[`${prefix}Version`],
    hash: form.dataset[`${prefix}Hash`],
  };
  const previous = isLegalDocumentIdentity(previousValue) ? previousValue : null;
  const acceptanceName = kind === "privacy-media" ? "privacyMediaAccepted" : "waiverAccepted";
  const acceptance = form.querySelector<HTMLInputElement>(`[name="${acceptanceName}"]`);
  if (acceptance) {
    acceptance.checked = signupLegalAcceptanceAfterIdentityLoad(previous, identity, acceptance.checked);
  }
  form.dataset[`${prefix}Version`] = identity.version;
  form.dataset[`${prefix}Hash`] = identity.hash;
}

function setupSignupLegalReview(form: HTMLFormElement, config: PublicConfig): void {
  storeSignupLegalIdentity(form, "privacy-media", config.privacyMedia);
  storeSignupLegalIdentity(form, "waiver", config.waiver);

  const restoreFocus = new Map<HTMLDialogElement, HTMLButtonElement>();
  const viewerLoads = new Map<HTMLDialogElement, SignupLegalViewerLoadCoordinator>();
  for (const dialog of document.querySelectorAll<HTMLDialogElement>("[data-signup-dialog]")) {
    const loads = createSignupLegalViewerLoadCoordinator(dialog);
    viewerLoads.set(dialog, loads);
    installSignupLegalDialogBackdropDismissal(dialog);
    for (const close of dialog.querySelectorAll<HTMLButtonElement>("[data-signup-dialog-close]")) {
      close.addEventListener("click", () => dialog.close());
    }
    dialog.addEventListener("cancel", () => {
      dialog.dataset.signupDialogCloseReason = "escape";
    });
    dialog.addEventListener("close", () => {
      loads.invalidate();
      delete dialog.dataset.signupDialogCloseReason;
      const trigger = restoreFocus.get(dialog);
      restoreFocus.delete(dialog);
      if (trigger?.isConnected) trigger.focus();
    });
  }

  for (const button of form.querySelectorAll<HTMLButtonElement>("[data-signup-review]")) {
    button.addEventListener("click", () => { void (async () => {
      const kind = button.dataset.signupReview;
      if (kind !== "privacy-media" && kind !== "waiver") return;
      const dialog = document.querySelector<HTMLDialogElement>(`[data-signup-dialog="${kind}"]`);
      if (!dialog) return;
      const loads = viewerLoads.get(dialog);
      if (!loads) return;
      const load = loads.begin();
      const status = dialog.querySelector<HTMLElement>("[data-signup-dialog-status]");
      restoreFocus.set(dialog, button);
      if (status) {
        status.textContent = "Loading the current legal document…";
        status.hidden = false;
      }
      if (!dialog.open) dialog.showModal();
      dialog.querySelector<HTMLButtonElement>("[data-signup-dialog-close]")?.focus();
      try {
        const currentConfig = await loadPublicConfig();
        if (!loads.isCurrent(load)) return;
        const identity = kind === "privacy-media" ? currentConfig.privacyMedia : currentConfig.waiver;
        if (!isLegalDocumentIdentity(identity)) {
          throw new Error("The current legal document identity is unavailable.");
        }
        await prepareSignupLegalReview({
          kind,
          identity,
          loadViewer: (url) => reloadSignupLegalViewer(url, kind, load, loads),
        });
        loads.apply(load, () => {
          storeSignupLegalIdentity(form, kind, identity);
          const currentViewer = dialog.querySelector<HTMLIFrameElement>("iframe");
          if (currentViewer) currentViewer.hidden = false;
          if (status) status.hidden = true;
        });
      } catch (error) {
        loads.apply(load, () => {
          const currentViewer = dialog.querySelector<HTMLIFrameElement>("iframe");
          if (currentViewer) {
            currentViewer.hidden = true;
            currentViewer.removeAttribute("src");
          }
          if (status) {
            const message = error instanceof Error
              ? error.message
              : "The embedded legal document could not be displayed. Use the full-page link below.";
            status.textContent = /full-page link/i.test(message)
              ? message
              : `${message} Use the full-page link below.`;
            status.hidden = false;
          }
        });
      }
    })(); });
  }
}

async function saveSignupProfileAndPrivacy(
  auth: HunterAuthHook,
  draft: HunterSignupDraft,
  signal?: AbortSignal,
): Promise<void> {
  throwIfAborted(signal);
  const headers = await authHeaders(auth);
  headers.set("Content-Type", "application/json");
  const response = await protectedFetch("/api/v1/me/profile", {
    method: "PATCH",
    headers,
    credentials: "same-origin",
    body: JSON.stringify({
      ...buildProfilePayload({
      fullName: draft.fullName,
      publicDisplayName: "",
      townArea: "",
      interests: [],
      discoverySource: "",
      participationBasis: draft.participationBasis,
      guardianPermissionAttested: draft.guardianPermissionAttested,
      privacyMediaAccepted: draft.privacyMediaAccepted,
      huntEmail: false,
      marketing: false,
      }),
      privacyMediaVersion: draft.privacyMediaDocument?.version,
    }),
    signal: requestSignal(12_000, signal),
  }, signal);
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new ProtectedAccountRequestError(response.status, waiverErrorCode(payload));
}

async function finalizeVerifiedSignup(
  auth: HunterAuthHook,
  draft: HunterSignupDraft,
  signal?: AbortSignal,
): Promise<void> {
  let currentDocuments: Promise<{
    privacyMedia: LegalDocumentIdentity | null;
    waiver: Record<string, unknown>;
    waiverIdentity: LegalDocumentIdentity | null;
  }> | null = null;
  const loadCurrentDocuments = (): Promise<{
    privacyMedia: LegalDocumentIdentity | null;
    waiver: Record<string, unknown>;
    waiverIdentity: LegalDocumentIdentity | null;
  }> => {
    currentDocuments ??= Promise.all([loadPublicConfig(signal), fetchCurrentWaiverDocument(signal)]).then(([config, waiver]) => ({
      privacyMedia: config.privacyMedia,
      waiver,
      waiverIdentity: isLegalDocumentIdentity(waiver) ? waiver : null,
    }));
    return currentDocuments;
  };
  await completeHunterRegistration({
    bootstrap: () => bootstrapPlayer(auth, showProvisioningProgress, signal),
    loadState: async () => {
      const [dashboard, waiverAcceptance] = await Promise.all([
        fetchDashboardData(auth, signal),
        fetchWaiverAcceptanceProjection(auth, signal),
      ]);
      return {
        profileAndPrivacyComplete: isRecord(dashboard.profile) && dashboard.privacyMediaRequired !== true,
        waiverAcceptance: waiverAcceptance?.acceptance ?? null,
      };
    },
    saveProfileAndPrivacy: () => saveSignupProfileAndPrivacy(auth, draft, signal),
    fetchWaiverDocument: async () => (await loadCurrentDocuments()).waiver,
    validateMissingDocuments: async (state) => {
      const current = await loadCurrentDocuments();
      assertMissingSignupDocumentsCurrent(draft, {
        privacyMedia: current.privacyMedia,
        waiver: current.waiverIdentity,
      }, state);
    },
    recordWaiverReview: async (documentValue) => {
      throwIfAborted(signal);
      const payload = await waiverWrite(auth, "/api/v1/me/waiver/review", {
        version: documentValue.version,
        hash: documentValue.hash,
      }, undefined, signal);
      return reviewIdFrom(payload);
    },
    acceptWaiver: async (documentValue, reviewEventId) => {
      throwIfAborted(signal);
      await waiverWrite(
        auth,
        "/api/v1/me/waiver/accept",
        buildWaiverPayload({
          reviewEventId,
          version: text(documentValue.version, ""),
          hash: text(documentValue.hash, ""),
          waiverAccepted: true,
          guardianAttested: false,
          minors: [],
        }),
        draft.finalizationIdempotencyKey ?? crypto.randomUUID(),
        signal,
      );
    },
    refreshDashboard: () => loadSignedInDashboard(auth, signal),
    ensureActive: () => throwIfAborted(signal),
  });
}

type SignupRecoveryPresentation = "none" | "verification" | "lost_attempt" | "unsupported" | "finishing";

interface SignupAccountFormDependencies {
  activateSignupSession?: (sessionId: string) => Promise<boolean>;
  finalizeSignup?: (draft: HunterSignupDraft, signal?: AbortSignal) => Promise<void>;
  loadSignedInAccount?: (signal?: AbortSignal) => Promise<void>;
  resendCooldownMs?: number;
  completedFinishingMessage?: string;
  completedFinishingClassification?: PlayerBootstrapFailureClassification;
}

function setupAccountForms(
  auth: HunterAuthHook,
  config: PublicConfig,
  resumeStore: HunterSignupResumeStore,
  dependencies: SignupAccountFormDependencies = {},
): SignupRecoveryPresentation {
  const activateSignupSession = dependencies.activateSignupSession ?? activateSession;
  const finalizeSignup = dependencies.finalizeSignup ?? ((draft, signal) => finalizeVerifiedSignup(auth, draft, signal));
  const loadSignedInAccount = dependencies.loadSignedInAccount ?? ((signal) => loadSignedInDashboard(auth, signal));
  const resendCooldownMs = dependencies.resendCooldownMs ?? 30_000;
  let resendCooldownTimer: number | null = null;
  let currentSignupResume = resumeStore.read();
  let signupOperationGeneration = 0;
  let signupOperationController: AbortController | null = null;
  const beginSignupOperation = (): number => {
    signupOperationController?.abort();
    signupOperationController = new AbortController();
    return ++signupOperationGeneration;
  };
  const signupOperationSignal = (generation: number): AbortSignal | undefined =>
    generation === signupOperationGeneration ? signupOperationController?.signal : undefined;
  const signupOperationIsCurrent = (generation: number): boolean =>
    generation === signupOperationGeneration;
  const resetSignupOperationControls = (): void => {
    const create = document.querySelector<HTMLButtonElement>('#hunter-sign-up-form button[type="submit"]');
    const retry = document.querySelector<HTMLButtonElement>("[data-signup-retry]");
    const resend = document.querySelector<HTMLButtonElement>("[data-signup-resend]");
    const finishingRetry = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
    if (create) { create.disabled = false; create.textContent = "Create account"; }
    if (retry) { retry.disabled = false; retry.textContent = "Retry sending the code"; }
    if (resend) { resend.disabled = false; resend.textContent = "Resend code"; }
    if (finishingRetry) finishingRetry.disabled = false;
    setSignupVerificationStatus("Enter the code from your email.");
  };
  const invalidateSignupOperations = (): void => {
    signupOperationController?.abort();
    signupOperationController = null;
    signupOperationGeneration += 1;
    if (resendCooldownTimer !== null) window.clearInterval(resendCooldownTimer);
    resendCooldownTimer = null;
    resetSignupOperationControls();
  };
  const clearSignupResume = (): void => {
    invalidateSignupOperations();
    resumeStore.clear();
    currentSignupResume = null;
    signUpAttempt = null;
  };
  const runSignedInAccountLoad = createSerializedSubmission(async () => {
    const operationGeneration = beginSignupOperation();
    const signal = signupOperationSignal(operationGeneration);
    const retry = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
    if (retry) {
      retry.disabled = true;
      retry.hidden = true;
    }
    showSignupFinishing("Your email is verified. Checking the remaining account setup now…");
    try {
      await loadSignedInAccount(signal);
      if (!signupOperationIsCurrent(operationGeneration)) return;
      clearSignupResume();
    } catch (error) {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      const classification = provisioningRequestClassification(error);
      showSignupFinishing(provisioningFailureMessage(classification), {
        retryAvailable: classification === "retryable",
        kind: classification === "terminal" ? "error" : "info",
      });
    } finally {
      if (signupOperationIsCurrent(operationGeneration) && retry) retry.disabled = false;
    }
  });

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-show-auth]")) {
    button.addEventListener("click", () => {
      const destination = button.dataset.showAuth ?? "hunter-sign-in-form";
      if (destination === "hunter-recovery-form" || destination === "hunter-sign-in-form") {
        clearSignupResume();
      } else {
        invalidateSignupOperations();
      }
      showAuthForm(destination);
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-signup-restart]")) {
    button.addEventListener("click", () => {
      clearSignupResume();
      document.querySelector<HTMLFormElement>("#hunter-sign-up-form")?.reset();
      showAuthForm("hunter-sign-up-form");
      authMessage("Start account setup again with the email you want to verify.");
    });
  }

  for (const button of document.querySelectorAll<HTMLButtonElement>("[data-signup-back-to-sign-in]")) {
    button.addEventListener("click", () => {
      clearSignupResume();
      showAuthForm("hunter-sign-in-form");
      authMessage("Secure account access is ready.");
    });
  }

  const signIn = document.querySelector<HTMLFormElement>("#hunter-sign-in-form");
  signIn?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(signIn);
    const identifier = String(form.get("email") ?? "").trim().toLowerCase();
    const password = String(form.get("password") ?? "");
    if (!hunterClerk?.client || !identifier || password.length < 12) {
      authMessage("Enter your email and a password of at least 12 characters.", "error");
      return;
    }
    try {
      signInAttempt = await hunterClerk.client.signIn.create({ strategy: "password", identifier, password });
      const createdSessionId = signInAttempt.createdSessionId;
      if (signInAttempt.status !== "complete" || !createdSessionId || !await activateSignupSession(createdSessionId)) {
        throw new Error("Additional account verification is required.");
      }
      clearSignupResume();
      await runSignedInAccountLoad();
    } catch (error) {
      console.error("Hunter password sign-in failed.", identityDiagnostic(error));
      authMessage(identityError(error, "Sign-in failed. Check your email and password."), "error");
    }
  });

  const signUp = document.querySelector<HTMLFormElement>("#hunter-sign-up-form");
  if (signUp) {
    setupSignupLegalReview(signUp, config);
    setupParticipationBasis(signUp);
  }
  let pendingLegalRefresh: {
    changed: SignupLegalDocumentKind[];
    privacyMedia: LegalDocumentIdentity;
    waiver: LegalDocumentIdentity;
  } | null = null;
  let pendingLegalRefreshError: SignupLegalDocumentsChangedError | null = null;
  const persistenceWarning = (): void => {
    setSignupVerificationStatus(
      "Keep this page open. Browser storage is unavailable, so leaving or reloading cannot recover this setup.",
      "error",
    );
  };
  const persistSignupResume = (record: HunterSignupResumeRecord): boolean => {
    currentSignupResume = record;
    const result = resumeStore.write(record);
    if (!result.persisted) persistenceWarning();
    return result.persisted;
  };
  const showSignupLegalRefresh = async (error: SignupLegalDocumentsChangedError): Promise<void> => {
    const finishForm = document.querySelector<HTMLFormElement>("#hunter-signup-finish-form");
    const privacyRow = finishForm?.querySelector<HTMLElement>("[data-signup-finish-privacy]");
    const waiverRow = finishForm?.querySelector<HTMLElement>("[data-signup-finish-waiver]");
    const status = finishForm?.querySelector<HTMLElement>("[data-signup-finish-status]");
    const submit = finishForm?.querySelector<HTMLButtonElement>('button[type="submit"]');
    const retry = finishForm?.querySelector<HTMLButtonElement>("[data-signup-finish-retry]");
    const privacyInput = privacyRow?.querySelector<HTMLInputElement>('input[name="privacyMediaAccepted"]');
    const waiverInput = waiverRow?.querySelector<HTMLInputElement>('input[name="waiverAccepted"]');
    pendingLegalRefreshError = error;
    showAuthForm("hunter-signup-finish-form");
    try {
      const [latestConfig, latestWaiver] = await Promise.all([loadPublicConfig(), fetchCurrentWaiverDocument()]);
      if (!latestConfig.privacyMedia || !isLegalDocumentIdentity(latestWaiver)) throw error;
      if (!pendingLegalRefresh || !legalDocumentIdentitiesMatch(pendingLegalRefresh.privacyMedia, latestConfig.privacyMedia)) {
        if (privacyInput) privacyInput.checked = false;
      }
      if (!pendingLegalRefresh || !legalDocumentIdentitiesMatch(pendingLegalRefresh.waiver, latestWaiver)) {
        if (waiverInput) waiverInput.checked = false;
      }
      pendingLegalRefresh = { changed: error.changed, privacyMedia: latestConfig.privacyMedia, waiver: latestWaiver };
      pendingLegalRefreshError = null;
      if (privacyRow) privacyRow.hidden = !error.changed.includes("privacy-media");
      if (waiverRow) waiverRow.hidden = !error.changed.includes("waiver");
      if (status) status.textContent = "";
      if (submit) submit.disabled = false;
      if (retry) retry.hidden = true;
      authMessage("");
      finishForm?.querySelector<HTMLElement>("h3")?.focus();
    } catch {
      pendingLegalRefresh = null;
      if (privacyRow) privacyRow.hidden = true;
      if (waiverRow) waiverRow.hidden = true;
      if (submit) submit.disabled = true;
      if (retry) retry.hidden = false;
      if (status) status.textContent = "Updated legal documents are temporarily unavailable. Try again to continue without losing this verified setup.";
      retry?.focus();
    }
  };
  const runSignupFinishing = createSerializedSubmission(async () => {
    const resume = currentSignupResume ?? resumeStore.read();
    const providerAttempt = signUpAttempt ?? hunterClerk?.client?.signUp;
    if (!resume || !providerAttempt) {
      showLostSignupAttempt("The verified account details are no longer available. Sign in or restart account setup.");
      return;
    }
    const reconciliation = reconcileHunterSignupResume(resume, providerAttempt);
    if (reconciliation.state !== "complete") {
      showLostSignupAttempt("The completed secure sign-up attempt is no longer available. Sign in or restart account setup.");
      return;
    }
    const operationGeneration = beginSignupOperation();
    const signal = signupOperationSignal(operationGeneration);
    const retry = document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]");
    signUpAttempt = providerAttempt;
    if (retry) {
      retry.disabled = true;
      retry.hidden = true;
    }
    showSignupFinishing("Connecting your verified session and finishing the remaining account steps…");
    try {
      const activated = await activateSignupSession(reconciliation.createdSessionId);
      if (!signupOperationIsCurrent(operationGeneration)) return;
      if (!activated) {
        throw new Error("Your verified session is still starting.");
      }
      await finalizeSignup(hunterSignupDraftFromResume(resume), signal);
      if (!signupOperationIsCurrent(operationGeneration)) return;
      clearSignupResume();
    } catch (error) {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      if (error instanceof SignupLegalDocumentsChangedError) {
        await showSignupLegalRefresh(error);
        return;
      }
      const classification = provisioningRequestClassification(error);
      showSignupFinishing(provisioningFailureMessage(classification), {
        retryAvailable: classification === "retryable",
        kind: classification === "retryable" ? "info" : "error",
      });
    } finally {
      if (signupOperationIsCurrent(operationGeneration) && currentSignupResume && retry) {
        retry.disabled = false;
      }
    }
  });
  document.querySelector<HTMLButtonElement>("[data-signup-finishing-retry]")?.addEventListener("click", () => {
    const resume = currentSignupResume ?? resumeStore.read();
    const providerAttempt = signUpAttempt ?? hunterClerk?.client?.signUp;
    if (resume && providerAttempt && reconcileHunterSignupResume(resume, providerAttempt).state === "complete") {
      void runSignupFinishing();
      return;
    }
    void runSignedInAccountLoad();
  });
  const startSignupResendCooldown = (availableAt = Date.now() + resendCooldownMs): void => {
    const resend = document.querySelector<HTMLButtonElement>("[data-signup-resend]");
    const retry = document.querySelector<HTMLButtonElement>("[data-signup-retry]");
    if (!resend && !retry) return;
    const update = (): void => {
      const remaining = Math.max(0, Math.ceil((availableAt - Date.now()) / 1_000));
      if (resend) {
        resend.disabled = remaining > 0;
        resend.textContent = remaining > 0 ? `Resend code in ${remaining}s` : "Resend code";
      }
      if (retry) {
        retry.disabled = remaining > 0;
        retry.textContent = remaining > 0 ? `Retry sending code in ${remaining}s` : "Retry sending the code";
      }
      if (remaining === 0 && resendCooldownTimer !== null) {
        window.clearInterval(resendCooldownTimer);
        resendCooldownTimer = null;
      }
    };
    if (resendCooldownTimer !== null) window.clearInterval(resendCooldownTimer);
    update();
    resendCooldownTimer = window.setInterval(update, 1_000);
  };
  const runSignUp = signUp ? createSerializedSubmission(async () => {
    const draft = readHunterSignupDraft(signUp);
    const errors = validateHunterSignupDraft(draft);
    showHunterSignupErrors(signUp, errors);
    if (!hunterClerk?.client || Object.keys(errors).length) return;
    const submit = signUp.querySelector<HTMLButtonElement>('button[type="submit"]');
    const label = submit?.textContent ?? "Create account";
    const operationGeneration = beginSignupOperation();
    if (submit) { submit.disabled = true; submit.textContent = "Sending code…"; }
    try {
      const resume = createHunterSignupResume(draft);
      let persisted = persistSignupResume(resume);
      signUpAttempt = null;
      const createdAttempt = await hunterClerk.client.signUp.create({ emailAddress: draft.emailAddress, password: draft.password });
      if (!signupOperationIsCurrent(operationGeneration)) return;
      signUpAttempt = createdAttempt;
      currentSignupResume = updateHunterSignupResume(resume, { providerAttemptId: signUpAttempt.id ?? null });
      persisted = persistSignupResume(currentSignupResume) && persisted;
      const preparedAttempt = await signUpAttempt.prepareEmailAddressVerification({ strategy: "email_code" });
      if (!signupOperationIsCurrent(operationGeneration)) return;
      signUpAttempt = preparedAttempt;
      if (reconcileHunterSignupResume(currentSignupResume, signUpAttempt).state !== "verification") {
        throw new Error("Email-code verification could not be prepared.");
      }
      currentSignupResume = updateHunterSignupResume(currentSignupResume, {
        resendAvailableAt: nextHunterSignupResendAvailableAt(currentSignupResume, resendCooldownMs),
      });
      persisted = persistSignupResume(currentSignupResume) && persisted;
      showSignupVerification(
        currentSignupResume,
        persisted
          ? "Enter the code from your email. Your safe progress is saved on this device."
          : "Enter the code from your email. Keep this page open; leaving or reloading cannot recover this setup.",
      );
      startSignupResendCooldown(currentSignupResume.resendAvailableAt ?? undefined);
      authMessage("Check your email for one verification code.", "success");
    } catch (error) {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      const copy = identityError(
        error,
        error instanceof Error ? error.message : "Your account could not be created.",
      );
      const recovery = currentSignupResume && signUpAttempt
        ? reconcileHunterSignupResume(currentSignupResume, signUpAttempt)
        : null;
      if (currentSignupResume && recovery?.state === "verification") {
        showSignupVerification(currentSignupResume, `${copy} The prepared verification is still available; enter the emailed code or retry sending it.`);
      } else {
        showLostSignupAttempt(`${copy} Your safe details are retained. Retry, restart account setup, or sign in to an existing account.`);
      }
      authMessage(copy, "error");
    } finally {
      if (signupOperationIsCurrent(operationGeneration) && submit) {
        submit.disabled = false;
        submit.textContent = label;
      }
    }
  }) : null;
  signUp?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runSignUp?.();
  });

  document.querySelector<HTMLButtonElement>("[data-signup-retry]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled || !currentSignupResume || !hunterClerk?.client) return;
    const providerCandidate = signUpAttempt ?? hunterClerk.client.signUp;
    if (reconcileHunterSignupResume(currentSignupResume, providerCandidate).state === "complete") {
      signUpAttempt = providerCandidate;
      void runSignupFinishing();
      return;
    }
    if (currentSignupResume.resendAvailableAt && currentSignupResume.resendAvailableAt > Date.now()) {
      startSignupResendCooldown(currentSignupResume.resendAvailableAt);
      return;
    }
    const operationGeneration = beginSignupOperation();
    button.disabled = true;
    let correlationValidated = false;
    try {
      if (!currentSignupResume.providerAttemptId || !providerCandidate?.id ||
          providerCandidate.id !== currentSignupResume.providerAttemptId ||
          providerCandidate.emailAddress?.trim().toLowerCase() !== currentSignupResume.emailAddress) {
        throw new Error("This secure sign-up attempt cannot be retried safely. Restart account setup or sign in to an existing account.");
      }
      correlationValidated = true;
      const preparedAttempt = await providerCandidate.prepareEmailAddressVerification({ strategy: "email_code" });
      if (!signupOperationIsCurrent(operationGeneration)) return;
      signUpAttempt = preparedAttempt;
      if (reconcileHunterSignupResume(currentSignupResume, signUpAttempt).state !== "verification") {
        throw new Error("Email-code verification could not be prepared.");
      }
      currentSignupResume = updateHunterSignupResume(currentSignupResume, {
        resendAvailableAt: nextHunterSignupResendAvailableAt(currentSignupResume, resendCooldownMs),
      });
      persistSignupResume(currentSignupResume);
      showSignupVerification(currentSignupResume, "A new verification code was requested. Enter it below.");
      startSignupResendCooldown(currentSignupResume.resendAvailableAt ?? undefined);
    } catch (error) {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      if (correlationValidated && currentSignupResume) {
        currentSignupResume = updateHunterSignupResume(currentSignupResume, {
          resendAvailableAt: nextHunterSignupResendAvailableAt(currentSignupResume, resendCooldownMs, Date.now(), error),
        });
        persistSignupResume(currentSignupResume);
      }
      showLostSignupAttempt(identityError(
        error,
        error instanceof Error ? error.message : "The verification code could not be requested.",
      ));
      if (currentSignupResume?.resendAvailableAt) {
        startSignupResendCooldown(currentSignupResume.resendAvailableAt);
      }
    } finally {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      if (currentSignupResume?.resendAvailableAt && currentSignupResume.resendAvailableAt > Date.now()) {
        startSignupResendCooldown(currentSignupResume.resendAvailableAt);
      } else {
        button.disabled = false;
        button.textContent = "Retry sending the code";
      }
    }
  });

  const verify = document.querySelector<HTMLFormElement>("#hunter-verify-form");
  const runVerification = verify ? createSerializedSubmission(async () => {
    const code = String(new FormData(verify).get("code") ?? "").trim();
    const resume = currentSignupResume ?? resumeStore.read();
    if (!signUpAttempt || !resume || !code) {
      setSignupVerificationStatus("Enter the code from your email, or restart account setup.", "error");
      return;
    }
    const verificationActions = [...verify.querySelectorAll<HTMLButtonElement>("button")];
    const operationGeneration = beginSignupOperation();
    const signal = signupOperationSignal(operationGeneration);
    verificationActions.forEach((button) => { button.disabled = true; });
    setSignupVerificationStatus("Checking that code…");
    try {
      await completeSignupEmailVerification({
        code,
        resume,
        attemptVerification: async (verificationCode) => {
          if (!signUpAttempt) return { status: null, createdSessionId: null };
          if (signUpAttempt.status === "complete" && signUpAttempt.createdSessionId) return signUpAttempt;
          signUpAttempt = await signUpAttempt.attemptEmailAddressVerification({ code: verificationCode });
          if (signUpAttempt.status === "complete" && signUpAttempt.createdSessionId) {
            showSignupFinishing("Email verified. Checking the remaining account setup now…");
          }
          return signUpAttempt;
        },
        activateSession: activateSignupSession,
        finalize: finalizeSignup,
        ...(signal ? { signal } : {}),
        clearResume: clearSignupResume,
      });
      signUpAttempt = null;
      setSignupVerificationStatus("Email verified. Your Hunter Dashboard is ready.", "success");
    } catch (error) {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      if (error instanceof SignupLegalDocumentsChangedError) {
        await showSignupLegalRefresh(error);
        return;
      }
      const currentResume = currentSignupResume ?? resumeStore.read();
      const recovery = currentResume && signUpAttempt
        ? reconcileHunterSignupResume(currentResume, signUpAttempt)
        : null;
      if (recovery?.state === "unsupported") {
        showLostSignupAttempt("Your email is verified, but the identity provider requires another account step this page cannot complete. Sign in if your account is ready, or restart account setup.");
        return;
      }
      if (currentResume && recovery?.state === "lost_attempt") {
        showLostSignupAttempt("The identity provider no longer has the matching secure sign-up attempt. Restart account setup or sign in to an existing account.");
        return;
      }
      if (currentResume && recovery?.state === "complete") {
        const classification = provisioningRequestClassification(error);
        showSignupFinishing(provisioningFailureMessage(classification), {
          retryAvailable: classification === "retryable",
          kind: classification === "retryable" ? "info" : "error",
        });
        return;
      }
      const copy = error instanceof SignupLegalDocumentsChangedError
        ? error.message
        : identityError(
            error,
            error instanceof Error ? error.message : "The verification code could not be accepted.",
          );
      setSignupVerificationStatus(copy, "error");
      authMessage(copy, "error");
    } finally {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      verificationActions.forEach((button) => { button.disabled = false; });
      if (currentSignupResume?.resendAvailableAt && currentSignupResume.resendAvailableAt > Date.now()) {
        startSignupResendCooldown(currentSignupResume.resendAvailableAt);
      }
    }
  }) : null;
  verify?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runVerification?.();
  });

  const finish = document.querySelector<HTMLFormElement>("#hunter-signup-finish-form");
  const runFinish = finish ? createSerializedSubmission(async () => {
    const resume = currentSignupResume;
    if (!resume || !pendingLegalRefresh) return;
    const data = new FormData(finish);
    if ((pendingLegalRefresh.changed.includes("privacy-media") && data.get("privacyMediaAccepted") !== "on") ||
        (pendingLegalRefresh.changed.includes("waiver") && data.get("waiverAccepted") !== "on")) {
      const status = finish.querySelector<HTMLElement>("[data-signup-finish-status]");
      if (status) status.textContent = "Accept each updated document to finish.";
      return;
    }
    const submit = finish.querySelector<HTMLButtonElement>('button[type="submit"]');
    const operationGeneration = beginSignupOperation();
    const signal = signupOperationSignal(operationGeneration);
    if (submit) submit.disabled = true;
    try {
      currentSignupResume = updateHunterSignupResume(resume, {
        privacyMediaDocument: pendingLegalRefresh.changed.includes("privacy-media")
          ? pendingLegalRefresh.privacyMedia : resume.privacyMediaDocument,
        waiverDocument: pendingLegalRefresh.changed.includes("waiver")
          ? pendingLegalRefresh.waiver : resume.waiverDocument,
      });
      persistSignupResume(currentSignupResume);
      await finalizeSignup(hunterSignupDraftFromResume(currentSignupResume), signal);
      clearSignupResume();
      const status = finish.querySelector<HTMLElement>("[data-signup-finish-status]");
      if (status) status.textContent = "Account setup complete.";
    } catch (error) {
      if (error instanceof SignupLegalDocumentsChangedError) {
        await showSignupLegalRefresh(error);
        return;
      }
      const status = finish.querySelector<HTMLElement>("[data-signup-finish-status]");
      if (status) status.textContent = error instanceof Error ? error.message : "Account setup could not be completed.";
    } finally {
      if (signupOperationIsCurrent(operationGeneration) && submit) submit.disabled = pendingLegalRefresh === null;
    }
  }) : null;
  finish?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runFinish?.();
  });

  finish?.querySelector<HTMLButtonElement>("[data-signup-finish-retry]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled || !pendingLegalRefreshError) return;
    button.disabled = true;
    const status = finish.querySelector<HTMLElement>("[data-signup-finish-status]");
    if (status) status.textContent = "Checking for the updated legal documents…";
    try {
      await showSignupLegalRefresh(pendingLegalRefreshError);
    } finally {
      button.disabled = false;
    }
  });

  document.querySelector<HTMLButtonElement>("[data-signup-resend]")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    if (!(button instanceof HTMLButtonElement) || button.disabled) return;
    const resume = currentSignupResume ?? resumeStore.read();
    if (!signUpAttempt || !resume) {
      showLostSignupAttempt("The secure sign-up attempt is no longer available. Restart account setup or sign in to an existing account.");
      return;
    }
    if (reconcileHunterSignupResume(resume, signUpAttempt).state === "complete") {
      showSignupFinishing("Your email is already verified. Use Try again to continue the remaining account steps.", { retryAvailable: true });
      return;
    }
    if (resume.resendAvailableAt && resume.resendAvailableAt > Date.now()) {
      startSignupResendCooldown(resume.resendAvailableAt);
      return;
    }
    const operationGeneration = beginSignupOperation();
    button.disabled = true;
    setSignupVerificationStatus("Requesting another code…");
    try {
      const preparedAttempt = await signUpAttempt.prepareEmailAddressVerification({ strategy: "email_code" });
      if (!signupOperationIsCurrent(operationGeneration)) return;
      signUpAttempt = preparedAttempt;
      if (reconcileHunterSignupResume(resume, signUpAttempt).state !== "verification") {
        throw new Error("A new email-code verification attempt could not be prepared.");
      }
      currentSignupResume = updateHunterSignupResume(resume, {
        resendAvailableAt: nextHunterSignupResendAvailableAt(resume, resendCooldownMs),
      });
      const persisted = persistSignupResume(currentSignupResume);
      startSignupResendCooldown(currentSignupResume.resendAvailableAt ?? undefined);
      if (persisted) setSignupVerificationStatus(`A new code was sent to ${resume.maskedEmail}.`, "success");
    } catch (error) {
      if (!signupOperationIsCurrent(operationGeneration)) return;
      currentSignupResume = updateHunterSignupResume(resume, {
        resendAvailableAt: nextHunterSignupResendAvailableAt(resume, resendCooldownMs, Date.now(), error),
      });
      persistSignupResume(currentSignupResume);
      startSignupResendCooldown(currentSignupResume.resendAvailableAt ?? undefined);
      const recovery = reconcileHunterSignupResume(currentSignupResume, signUpAttempt);
      if (recovery.state !== "verification") {
        showLostSignupAttempt(
          error instanceof Error
            ? `${error.message} Restart account setup or sign in to an existing account.`
            : "Email verification cannot continue. Restart account setup or sign in to an existing account.",
        );
        return;
      }
      setSignupVerificationStatus(
        identityError(error, "Another code could not be sent yet. Wait for the resend timer, then try again."),
        "error",
      );
    }
  });

  const recovery = document.querySelector<HTMLFormElement>("#hunter-recovery-form");
  const runRecovery = recovery ? createSerializedSubmission(async () => {
    const identifier = String(new FormData(recovery).get("email") ?? "").trim().toLowerCase();
    if (!hunterClerk?.client || !identifier) return authMessage("Enter your account email.", "error");
    const submit = recovery.querySelector<HTMLButtonElement>('button[type="submit"]');
    const label = submit?.textContent ?? "Email recovery code";
    if (submit) { submit.disabled = true; submit.textContent = "Sending code…"; }
    try {
      signInAttempt = await hunterClerk.client.signIn.create({ strategy: "reset_password_email_code", identifier });
      const factor = signInAttempt.supportedFirstFactors?.find((item) => item.strategy === "reset_password_email_code");
      if (!factor || factor.strategy !== "reset_password_email_code") throw new Error("Email recovery is unavailable.");
      signInAttempt = await signInAttempt.prepareFirstFactor({ strategy: "reset_password_email_code", emailAddressId: factor.emailAddressId });
      showAuthForm("hunter-reset-form");
      authMessage("If that account exists, a recovery code has been emailed.", "success");
    } catch (error) {
      authMessage(identityError(error, "Password recovery could not be started."), "error");
    } finally {
      if (submit) { submit.disabled = false; submit.textContent = label; }
    }
  }) : null;
  recovery?.addEventListener("submit", (event) => {
    event.preventDefault();
    void runRecovery?.();
  });

  const reset = document.querySelector<HTMLFormElement>("#hunter-reset-form");
  reset?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(reset);
    const code = String(form.get("code") ?? "").trim();
    const password = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    if (!signInAttempt || !code || password.length < 12 || password !== confirmation) {
      authMessage("Enter the emailed code and matching passwords of at least 12 characters.", "error");
      return;
    }
    try {
      signInAttempt = await signInAttempt.attemptFirstFactor({ strategy: "reset_password_email_code", code });
      if (signInAttempt.status === "needs_new_password") {
        signInAttempt = await signInAttempt.resetPassword({ password, signOutOfOtherSessions: true });
      }
      const createdSessionId = signInAttempt.createdSessionId;
      if (signInAttempt.status !== "complete" || !createdSessionId || !await activateSignupSession(createdSessionId)) {
        throw new Error("Password recovery is not complete.");
      }
      clearSignupResume();
      await runSignedInAccountLoad();
    } catch (error) {
      authMessage(identityError(error, "Password recovery failed."), "error");
    }
  });

  const changePassword = document.querySelector<HTMLFormElement>("#hunter-change-password-form");
  changePassword?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = new FormData(changePassword);
    const currentPassword = String(form.get("currentPassword") ?? "");
    const newPassword = String(form.get("newPassword") ?? "");
    const confirmation = String(form.get("confirmPassword") ?? "");
    const result = document.querySelector<HTMLElement>("[data-password-result]");
    if (!hunterClerk?.user || currentPassword.length < 12 || newPassword.length < 12 || newPassword !== confirmation) {
      if (result) result.textContent = "Enter your current password and matching new passwords of at least 12 characters.";
      return;
    }
    try {
      await hunterClerk.user.updatePassword({ currentPassword, newPassword, signOutOfOtherSessions: true });
      changePassword.reset();
      if (result) result.textContent = "Password changed. Other sessions have been revoked.";
    } catch (error) {
      if (result) result.textContent = identityError(error, "Your password could not be changed.");
    }
  });

  bindHunterSignOutControls(verifiedSignOutHandler(invalidateSignupOperations, clearSignupResume));

  const resume = currentSignupResume;
  if (!resume || !hunterClerk?.client) return "none";
  const providerAttempt = hunterClerk.client.signUp;
  const reconciliation = reconcileHunterSignupResume(resume, providerAttempt);
  if (reconciliation.state === "verification") {
    signUpAttempt = providerAttempt;
    showSignupVerification(resume, "Verification is still waiting. Enter the code from your email or request a new one.");
    if (resume.resendAvailableAt) startSignupResendCooldown(resume.resendAvailableAt);
    return "verification";
  }
  if (reconciliation.state === "lost_attempt") {
    showLostSignupAttempt("This browser kept your safe account details, but the identity provider no longer has the matching secure sign-up attempt.");
    if (resume.resendAvailableAt) startSignupResendCooldown(resume.resendAvailableAt);
    return "lost_attempt";
  }
  if (reconciliation.state === "unsupported") {
    showLostSignupAttempt("The identity provider needs an account step this page cannot continue. Restart account setup or sign in to an existing account.");
    if (resume.resendAvailableAt) startSignupResendCooldown(resume.resendAvailableAt);
    return "unsupported";
  }

  signUpAttempt = providerAttempt;
  if (dependencies.completedFinishingMessage) {
    showSignupFinishing(dependencies.completedFinishingMessage, {
      retryAvailable: dependencies.completedFinishingClassification !== "terminal",
      kind: dependencies.completedFinishingClassification === "terminal" ? "error" : "info",
    });
    return "finishing";
  }
  void runSignupFinishing();
  return "finishing";
}

type AccountStatePresentation = SignupRecoveryPresentation | "dashboard";

interface AccountStateDependencies extends SignupAccountFormDependencies {
  loadDashboard?: (signal?: AbortSignal) => Promise<void>;
  signupNeedsFinishing?: (
    resume: HunterSignupResumeRecord,
    signal?: AbortSignal,
  ) => Promise<boolean | null | undefined>;
}

async function signupNeedsAuthoritativeFinishing(
  auth: HunterAuthHook,
  _resume: HunterSignupResumeRecord,
  signal?: AbortSignal,
): Promise<boolean> {
  await bootstrapPlayer(auth, showProvisioningProgress, signal);
  const [dashboard, waiverAcceptance] = await Promise.all([
    fetchDashboardData(auth, signal),
    fetchWaiverAcceptanceProjection(auth, signal),
  ]);
  const profileAndPrivacyComplete = isRecord(dashboard.profile) && dashboard.privacyMediaRequired !== true;
  return !profileAndPrivacyComplete || !waiverAcceptance?.acceptance;
}

async function initializeAccountState(
  auth: HunterAuthHook,
  config: PublicConfig,
  resumeStore: HunterSignupResumeStore,
  dependencies: AccountStateDependencies = {},
): Promise<AccountStatePresentation> {
  const resume = resumeStore.read();
  const accountFormDependencies: SignupAccountFormDependencies = {
    ...dependencies,
    ...(dependencies.loadDashboard ? { loadSignedInAccount: dependencies.loadDashboard } : {}),
  };
  if (hunterClerk?.user) {
    const preflightController = new AbortController();
    let preflightGeneration = 1;
    const activePreflightGeneration = preflightGeneration;
    const preflightIsCurrent = (): boolean =>
      preflightGeneration === activePreflightGeneration && !preflightController.signal.aborted;
    const invalidatePreflight = (): void => {
      preflightGeneration += 1;
      preflightController.abort();
    };
    bindHunterSignOutControls(verifiedSignOutHandler(invalidatePreflight, () => resumeStore.clear()));
    showSignupFinishing("Your email is verified. Checking your secure account setup…");
    const activeEmail = hunterClerk.user.primaryEmailAddress?.emailAddress?.trim().toLowerCase() ?? "";
    const providerAttempt = hunterClerk.client?.signUp;
    const reconciliation = resume && providerAttempt
      ? reconcileHunterSignupResume(resume, providerAttempt)
      : null;
    let needsFinishing = false;
    if (reconciliation?.state === "complete" && activeEmail === resume?.emailAddress) {
      const deferIndeterminateFinishing = (error?: unknown): SignupRecoveryPresentation => {
        const classification = error === undefined ? null : provisioningRequestClassification(error);
        return setupAccountForms(auth, config, resumeStore, {
          ...dependencies,
          completedFinishingMessage: classification
            ? provisioningFailureMessage(classification)
            : "We could not confirm whether the remaining account steps are complete. Your verified progress is retained. Try again.",
          ...(classification ? { completedFinishingClassification: classification } : {}),
        });
      };
      try {
        const decision = await (
          dependencies.signupNeedsFinishing
          ?? ((record, signal) => signupNeedsAuthoritativeFinishing(auth, record, signal))
        )(resume, preflightController.signal);
        if (!preflightIsCurrent()) return "finishing";
        if (typeof decision !== "boolean") return deferIndeterminateFinishing();
        needsFinishing = decision;
      } catch (error) {
        if (!preflightIsCurrent()) return "finishing";
        return deferIndeterminateFinishing(error);
      }
    }
    if (needsFinishing) {
      return setupAccountForms(auth, config, resumeStore, accountFormDependencies);
    }
    resumeStore.clear();
    setupAccountForms(auth, config, resumeStore, accountFormDependencies);
    bindHunterSignOutControls(verifiedSignOutHandler(invalidatePreflight, () => resumeStore.clear()));
    try {
      await (dependencies.loadDashboard ?? ((signal) => loadSignedInDashboard(auth, signal)))(preflightController.signal);
      if (!preflightIsCurrent()) return "finishing";
      return "dashboard";
    } catch (error) {
      if (!preflightIsCurrent()) return "finishing";
      const classification = provisioningRequestClassification(error);
      showSignupFinishing(provisioningFailureMessage(classification), {
        retryAvailable: classification === "retryable",
        kind: classification === "terminal" ? "error" : "info",
      });
      return "finishing";
    }
  }
  showSignedOut("signed-out");
  return setupAccountForms(auth, config, resumeStore, dependencies);
}

async function initializeDashboard(): Promise<void> {
  const config = await loadPublicConfig();
  const auth = await initializeManagedAuth(config);
  if (!auth || !hunterClerk) {
    showSignedOut("unavailable");
    authMessage("Hunter identity is not configured in this build. No password is accepted locally.", "error");
    return;
  }
  const resumeStore = browserSignupResumeStore(config);
  try {
    const presentation = await initializeAccountState(auth, config, resumeStore);
    if (presentation === "none") authMessage("Secure account access is ready.");
  } catch {
    if (hunterClerk.user) {
      showSignupFinishing(provisioningFailureMessage("retryable"), { retryAvailable: true });
      return;
    }
    showSignedOut("unavailable");
  }
}

export function setupAccountFormsForTest(options: {
  clerk: unknown;
  config: PublicConfig;
  auth: HunterAuthHook;
  activateSession: (sessionId: string) => Promise<boolean>;
  finalizeSignup?: (draft: HunterSignupDraft, signal?: AbortSignal) => Promise<void>;
  loadSignedInAccount?: (signal?: AbortSignal) => Promise<void>;
  resendCooldownMs?: number;
}): SignupRecoveryPresentation {
  hunterClerk = options.clerk as Clerk;
  return setupAccountForms(
    options.auth,
    options.config,
    browserSignupResumeStore(options.config),
    {
      activateSignupSession: options.activateSession,
      ...(options.finalizeSignup ? { finalizeSignup: options.finalizeSignup } : {}),
      ...(options.loadSignedInAccount ? { loadSignedInAccount: options.loadSignedInAccount } : {}),
      resendCooldownMs: options.resendCooldownMs ?? 30_000,
    },
  );
}

export async function initializeAccountStateForTest(options: {
  clerk: unknown;
  config: PublicConfig;
  auth: HunterAuthHook;
  loadDashboard?: (signal?: AbortSignal) => Promise<void>;
  activateSession?: (sessionId: string) => Promise<boolean>;
  finalizeSignup?: (draft: HunterSignupDraft) => Promise<void>;
  signupNeedsFinishing?: (
    resume: HunterSignupResumeRecord,
    signal?: AbortSignal,
  ) => Promise<boolean | null | undefined>;
}): Promise<AccountStatePresentation> {
  hunterClerk = options.clerk as Clerk;
  return initializeAccountState(
    options.auth,
    options.config,
    browserSignupResumeStore(options.config),
    {
      ...(options.loadDashboard ? { loadDashboard: options.loadDashboard } : {}),
      ...(options.activateSession ? { activateSignupSession: options.activateSession } : {}),
      ...(options.finalizeSignup ? { finalizeSignup: options.finalizeSignup } : {}),
      ...(options.signupNeedsFinishing ? { signupNeedsFinishing: options.signupNeedsFinishing } : {}),
    },
  );
}

if (typeof document !== "undefined" &&
    (window as unknown as { __timLostDisableAutoInitialize?: boolean }).__timLostDisableAutoInitialize !== true) {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeDashboard(), { once: true });
  } else {
    void initializeDashboard();
  }
}

export {};
import type { Clerk } from "@clerk/clerk-js";
import type { SignInResource, SignUpResource } from "@clerk/shared/types";
import { createSerializedSubmission } from "./identity-submission";
