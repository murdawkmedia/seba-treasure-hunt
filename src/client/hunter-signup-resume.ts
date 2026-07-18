export const SIGNUP_RESUME_VERSION = 2 as const;
export const SIGNUP_RESUME_TTL_MS = 30 * 60 * 1_000;

type ParticipationBasis = "adult" | "minor_guardian_permission";

export interface SignupResumeLegalDocument {
  version: string;
  hash: string;
}

export interface HunterSignupResumeRecord {
  version: typeof SIGNUP_RESUME_VERSION;
  createdAt: number;
  stage: "awaiting_email_verification";
  emailAddress: string;
  maskedEmail: string;
  fullName: string;
  participationBasis: ParticipationBasis;
  guardianPermissionAttested: boolean;
  privacyMediaDocument: SignupResumeLegalDocument;
  waiverDocument: SignupResumeLegalDocument;
  providerAttemptId: string | null;
  resendAvailableAt: number | null;
  finalizationIdempotencyKey: string;
}

export interface SignupResumeStorage {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  removeItem: (key: string) => void;
}

interface SignupResumeStoreOptions {
  sessionStorage: SignupResumeStorage | null;
  localStorage: SignupResumeStorage | null;
  namespace: string;
  now?: () => number;
}

export interface HunterSignupResumeStore {
  key: string;
  read: () => HunterSignupResumeRecord | null;
  write: (record: HunterSignupResumeRecord) => SignupResumePersistence;
  clear: () => void;
}

export interface SignupResumePersistence {
  session: boolean;
  local: boolean;
  persisted: boolean;
}

export interface SignupProviderAttemptSnapshot {
  id?: string | undefined;
  status?: string | null;
  emailAddress?: string | null;
  createdSessionId?: string | null;
  unverifiedFields?: readonly string[];
  missingFields?: readonly string[];
  verifications?: {
    emailAddress?: {
      status?: string | null;
      strategy?: string | null;
    } | null;
  } | null;
}

export type HunterSignupResumeReconciliation =
  | { state: "verification"; resume: HunterSignupResumeRecord }
  | { state: "complete"; resume: HunterSignupResumeRecord; createdSessionId: string }
  | { state: "lost_attempt"; resume: HunterSignupResumeRecord }
  | { state: "unsupported"; resume: HunterSignupResumeRecord };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const normalizedEmail = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";

const isEmail = (value: string): boolean =>
  value.length <= 254 && /^\S+@\S+\.\S+$/.test(value);

const providerAttemptId = (value: unknown): string | null =>
  value === null || value === undefined ? null :
    typeof value === "string" && /^[a-z0-9_-]{1,128}$/i.test(value) ? value : "";

const idempotencyKey = (value: unknown): string =>
  typeof value === "string" && /^[a-z0-9_-]{16,128}$/i.test(value) ? value : "";

const legalDocument = (value: unknown): SignupResumeLegalDocument | null => {
  if (!isRecord(value) || typeof value.version !== "string" || !value.version.trim() ||
      typeof value.hash !== "string" || !/^[a-f0-9]{64}$/i.test(value.hash)) return null;
  return { version: value.version.trim(), hash: value.hash.toLowerCase() };
};

export function maskSignupEmail(value: string): string {
  const email = normalizedEmail(value);
  const separator = email.lastIndexOf("@");
  if (separator <= 0) return "your email";
  const local = email.slice(0, separator);
  const domain = email.slice(separator + 1);
  const dot = domain.lastIndexOf(".");
  if (!local || dot <= 0 || dot === domain.length - 1) return "your email";
  return `${local[0]}***@${domain[0]}***${domain.slice(dot)}`;
}

function normalizeResume(value: unknown): HunterSignupResumeRecord | null {
  if (!isRecord(value) || value.version !== SIGNUP_RESUME_VERSION ||
      value.stage !== "awaiting_email_verification" ||
      typeof value.createdAt !== "number" || !Number.isSafeInteger(value.createdAt) || value.createdAt < 0) return null;

  const emailAddress = normalizedEmail(value.emailAddress);
  const fullName = typeof value.fullName === "string" ? value.fullName.trim() : "";
  const participationBasis = value.participationBasis;
  const guardianPermissionAttested = value.guardianPermissionAttested;
  const privacyMediaDocument = legalDocument(value.privacyMediaDocument);
  const waiverDocument = legalDocument(value.waiverDocument);
  const attemptId = providerAttemptId(value.providerAttemptId);
  const finalizationId = idempotencyKey(value.finalizationIdempotencyKey);
  const resendAvailableAt = value.resendAvailableAt === null || value.resendAvailableAt === undefined
    ? null
    : typeof value.resendAvailableAt === "number" && Number.isSafeInteger(value.resendAvailableAt) &&
      value.resendAvailableAt >= value.createdAt && value.resendAvailableAt <= value.createdAt + SIGNUP_RESUME_TTL_MS
      ? value.resendAvailableAt
      : -1;
  if (!isEmail(emailAddress) || typeof value.maskedEmail !== "string" ||
      value.maskedEmail !== maskSignupEmail(emailAddress) || !fullName || fullName.length > 100 ||
      (participationBasis !== "adult" && participationBasis !== "minor_guardian_permission") ||
      typeof guardianPermissionAttested !== "boolean" ||
      (participationBasis === "adult" && guardianPermissionAttested) ||
      (participationBasis === "minor_guardian_permission" && !guardianPermissionAttested) ||
      !privacyMediaDocument || !waiverDocument || attemptId === "" || !finalizationId || resendAvailableAt === -1) return null;

  return {
    version: SIGNUP_RESUME_VERSION,
    createdAt: value.createdAt,
    stage: "awaiting_email_verification",
    emailAddress,
    maskedEmail: maskSignupEmail(emailAddress),
    fullName,
    participationBasis,
    guardianPermissionAttested,
    privacyMediaDocument,
    waiverDocument,
    providerAttemptId: attemptId,
    resendAvailableAt,
    finalizationIdempotencyKey: finalizationId,
  };
}

export function createHunterSignupResume(
  value: unknown,
  createdAt = Date.now(),
  finalizationIdempotencyKey = crypto.randomUUID(),
): HunterSignupResumeRecord {
  if (!isRecord(value)) throw new Error("The account setup details cannot be resumed.");
  const candidate = normalizeResume({
    version: SIGNUP_RESUME_VERSION,
    createdAt,
    stage: "awaiting_email_verification",
    emailAddress: value.emailAddress,
    maskedEmail: maskSignupEmail(normalizedEmail(value.emailAddress)),
    fullName: value.fullName,
    participationBasis: value.participationBasis,
    guardianPermissionAttested: value.guardianPermissionAttested,
    privacyMediaDocument: value.privacyMediaDocument,
    waiverDocument: value.waiverDocument,
    providerAttemptId: null,
    resendAvailableAt: null,
    finalizationIdempotencyKey,
  });
  if (!candidate) throw new Error("The account setup details cannot be resumed.");
  return candidate;
}

export function updateHunterSignupResume(
  record: HunterSignupResumeRecord,
  update: Partial<Pick<HunterSignupResumeRecord, "providerAttemptId" | "resendAvailableAt" |
    "privacyMediaDocument" | "waiverDocument">>,
): HunterSignupResumeRecord {
  const updated = normalizeResume({ ...record, ...update });
  if (!updated) throw new Error("The account setup details cannot be resumed.");
  return updated;
}

export function serializeHunterSignupResume(value: unknown): string {
  const record = normalizeResume(value);
  if (!record) throw new Error("The account setup details cannot be resumed.");
  return JSON.stringify(record);
}

export function parseHunterSignupResume(
  serialized: string | null,
  now = Date.now(),
): HunterSignupResumeRecord | null {
  if (!serialized) return null;
  try {
    const record = normalizeResume(JSON.parse(serialized));
    if (!record || now < record.createdAt || now - record.createdAt >= SIGNUP_RESUME_TTL_MS) return null;
    return record;
  } catch {
    return null;
  }
}

const safeRemove = (storage: SignupResumeStorage | null, key: string): void => {
  try {
    storage?.removeItem(key);
  } catch {
    // Storage can be unavailable in privacy-restricted browser modes.
  }
};

const safeWrite = (storage: SignupResumeStorage | null, key: string, value: string): boolean => {
  try {
    if (!storage) return false;
    storage.setItem(key, value);
    return storage.getItem(key) === value;
  } catch {
    // The other bounded storage tier may still be available.
    return false;
  }
};

const safeRead = (storage: SignupResumeStorage | null, key: string): string | null => {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
};

export function createHunterSignupResumeStore(options: SignupResumeStoreOptions): HunterSignupResumeStore {
  const encodedNamespace = encodeURIComponent(options.namespace);
  const key = `tim-lost:hunter-signup-resume:${encodedNamespace}`;
  const legacyKeys = Array.from(
    { length: SIGNUP_RESUME_VERSION + 1 },
    (_value, version) => `tim-lost:hunter-signup-resume:v${version}:${encodedNamespace}`,
  );
  const allKeys = [key, ...legacyKeys];
  const now = options.now ?? Date.now;
  const clearTier = (storage: SignupResumeStorage | null): void => {
    for (const storageKey of allKeys) safeRemove(storage, storageKey);
  };
  const readTier = (storage: SignupResumeStorage | null): HunterSignupResumeRecord | null => {
    let newest: HunterSignupResumeRecord | null = null;
    for (const storageKey of allKeys) {
      const serialized = safeRead(storage, storageKey);
      const record = parseHunterSignupResume(serialized, now());
      if (serialized && !record) safeRemove(storage, storageKey);
      if (record && (!newest || record.createdAt > newest.createdAt)) newest = record;
    }
    return newest;
  };
  return {
    key,
    read: () => {
      const sessionRecord = readTier(options.sessionStorage);
      const localRecord = readTier(options.localStorage);
      const selected = sessionRecord ?? localRecord;
      if (!selected) return null;
      const serialized = serializeHunterSignupResume(selected);
      clearTier(options.sessionStorage);
      clearTier(options.localStorage);
      safeWrite(options.sessionStorage, key, serialized);
      safeWrite(options.localStorage, key, serialized);
      return selected;
    },
    write: (record) => {
      const serialized = serializeHunterSignupResume(record);
      clearTier(options.sessionStorage);
      clearTier(options.localStorage);
      const session = safeWrite(options.sessionStorage, key, serialized);
      const local = safeWrite(options.localStorage, key, serialized);
      return { session, local, persisted: session || local };
    },
    clear: () => {
      clearTier(options.sessionStorage);
      clearTier(options.localStorage);
    },
  };
}

export function reconcileHunterSignupResume(
  resume: HunterSignupResumeRecord,
  attempt: SignupProviderAttemptSnapshot | null | undefined,
): HunterSignupResumeReconciliation {
  if (!attempt || !resume.providerAttemptId || attempt.id !== resume.providerAttemptId ||
      normalizedEmail(attempt.emailAddress) !== resume.emailAddress) {
    return { state: "lost_attempt", resume };
  }
  if (attempt.status === "complete" && typeof attempt.createdSessionId === "string" && attempt.createdSessionId) {
    return { state: "complete", resume, createdSessionId: attempt.createdSessionId };
  }
  if (attempt.status !== "missing_requirements") return { state: "lost_attempt", resume };
  const verification = attempt.verifications?.emailAddress;
  const hasOnlyCompatibleMissingFields = (attempt.missingFields ?? [])
    .every((field) => field === "email_address");
  const hasOnlyExpectedUnverifiedField = attempt.unverifiedFields?.length === 1 &&
    attempt.unverifiedFields[0] === "email_address";
  if (hasOnlyExpectedUnverifiedField && hasOnlyCompatibleMissingFields &&
      verification?.status === "unverified" && verification.strategy === "email_code") {
    return { state: "verification", resume };
  }
  return { state: "unsupported", resume };
}
