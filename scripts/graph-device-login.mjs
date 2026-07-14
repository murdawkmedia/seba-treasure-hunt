import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const delegatedScope = "offline_access https://graph.microsoft.com/Mail.Send";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const canonicalGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const maxDeviceLifetimeSeconds = 30 * 60;
const maxPollIntervalSeconds = 30;
const defaultPollIntervalSeconds = 5;
const defaultClipboardTimeoutMs = 10_000;
const defaultClipboardCleanupGraceMs = 1_000;

function fixedError() {
  return new Error("Microsoft device authorization could not be completed.");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizedGuid(value) {
  if (!nonEmpty(value)) return null;
  const normalized = value.trim();
  return canonicalGuid.test(normalized) ? normalized : null;
}

function safeUserCode(value) {
  if (!nonEmpty(value)) return null;
  const normalized = value.trim();
  return /^[a-z0-9-]{4,32}$/i.test(normalized) ? normalized : null;
}

function safeVerificationUri(value) {
  if (!nonEmpty(value) || /[\u0000-\u001f\u007f]/.test(value)) return null;
  const normalized = value.trim();
  try {
    const parsed = new URL(normalized);
    const hostname = parsed.hostname.toLowerCase();
    const microsoftHost =
      hostname === "microsoft.com" ||
      hostname.endsWith(".microsoft.com") ||
      hostname === "microsoftonline.com" ||
      hostname.endsWith(".microsoftonline.com");
    if (
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      !microsoftHost
    ) {
      return null;
    }
    return normalized;
  } catch {
    return null;
  }
}

function record(value) {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? value : null;
}

async function decodedResponse(response) {
  try {
    return record(await response.json());
  } catch {
    throw fixedError();
  }
}

function boundedMilliseconds(value, fallback) {
  const selected = value ?? fallback;
  return Number.isInteger(selected) && selected >= 1 && selected <= 60_000
    ? selected
    : null;
}

export async function writeWindowsClipboard(value, options = {}) {
  const {
    spawnImpl = spawn,
    setTimeoutImpl = setTimeout,
    clearTimeoutImpl = clearTimeout
  } = options;
  const timeoutMs = boundedMilliseconds(options.timeoutMs, defaultClipboardTimeoutMs);
  const cleanupGraceMs = boundedMilliseconds(
    options.cleanupGraceMs,
    defaultClipboardCleanupGraceMs
  );
  if (
    !nonEmpty(value) ||
    typeof spawnImpl !== "function" ||
    typeof setTimeoutImpl !== "function" ||
    typeof clearTimeoutImpl !== "function" ||
    timeoutMs === null ||
    cleanupGraceMs === null
  ) {
    throw fixedError();
  }

  let child;
  try {
    child = spawnImpl(
      "powershell.exe",
      [
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        "$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value"
      ],
      { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] }
    );
  } catch {
    throw fixedError();
  }
  if (
    !child ||
    typeof child.once !== "function" ||
    typeof child.kill !== "function" ||
    !child.stdin ||
    typeof child.stdin.end !== "function" ||
    typeof child.stdin.destroy !== "function" ||
    typeof child.stdin.once !== "function"
  ) {
    try { child?.stdin?.destroy?.(); } catch {}
    try { child?.kill?.("SIGKILL"); } catch {}
    throw fixedError();
  }

  let closed = false;
  let closeCleanup;
  const closeObserved = new Promise((resolve) => {
    closeCleanup = resolve;
  });
  let outcomeResolved = false;
  let resolveOutcome;
  const outcome = new Promise((resolve) => {
    resolveOutcome = resolve;
  });
  const settle = (value) => {
    if (outcomeResolved) return;
    outcomeResolved = true;
    resolveOutcome(value);
  };
  child.once("close", (code) => {
    closed = true;
    closeCleanup();
    settle({ kind: "close", code });
  });
  child.once("error", () => settle({ kind: "spawn_error" }));
  child.stdin.once("error", () => settle({ kind: "stdin_error" }));

  const timeoutHandle = setTimeoutImpl(
    () => settle({ kind: "timeout" }),
    timeoutMs
  );
  try {
    child.stdin.end(value);
  } catch {
    settle({ kind: "stdin_error" });
  }

  const result = await outcome;
  clearTimeoutImpl(timeoutHandle);
  if (result.kind === "close" && result.code === 0) return;

  try { child.stdin.destroy(); } catch {}
  try { child.kill("SIGKILL"); } catch {}
  if (!closed) {
    let graceHandle;
    const graceExpired = new Promise((resolve) => {
      graceHandle = setTimeoutImpl(resolve, cleanupGraceMs);
    });
    await Promise.race([closeObserved, graceExpired]);
    clearTimeoutImpl(graceHandle);
  }
  throw fixedError();
}

export async function runGraphDeviceLogin(options) {
  const {
    clientId,
    tenantId,
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    now = () => performance.now(),
    stdout = process.stdout,
    writeClipboard = writeWindowsClipboard
  } = options;

  const normalizedClientId = normalizedGuid(clientId);
  const normalizedTenantId = normalizedGuid(tenantId);
  if (!normalizedClientId || !normalizedTenantId || typeof now !== "function") {
    throw fixedError();
  }
  const authority = `https://login.microsoftonline.com/${normalizedTenantId}/oauth2/v2.0`;
  const deviceCodeUrl = `${authority}/devicecode`;
  const tokenUrl = `${authority}/token`;

  let deviceResponse;
  try {
    deviceResponse = await fetchImpl(deviceCodeUrl, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: normalizedClientId, scope: delegatedScope })
    });
  } catch {
    throw fixedError();
  }
  if (!deviceResponse.ok) {
    try { await deviceResponse.body?.cancel(); } catch {}
    throw fixedError();
  }
  const device = await decodedResponse(deviceResponse);
  const verificationUri = safeVerificationUri(device?.verification_uri);
  const userCode = safeUserCode(device?.user_code);
  const expiresInSeconds = device?.expires_in;
  const configuredInterval = device?.interval;
  const intervalSeconds = configuredInterval === undefined
    ? defaultPollIntervalSeconds
    : configuredInterval;
  const startedAt = now();
  const expiresAt = startedAt + expiresInSeconds * 1000;
  if (
    !device ||
    !nonEmpty(device.device_code) ||
    device.device_code.length > 4096 ||
    !userCode ||
    !verificationUri ||
    !Number.isInteger(expiresInSeconds) ||
    expiresInSeconds < 1 ||
    expiresInSeconds > maxDeviceLifetimeSeconds ||
    !Number.isInteger(intervalSeconds) ||
    intervalSeconds < 1 ||
    intervalSeconds > maxPollIntervalSeconds ||
    !Number.isFinite(startedAt) ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= startedAt
  ) {
    throw fixedError();
  }

  stdout.write(`Verification URL: ${verificationUri}\n`);
  stdout.write(`User code: ${userCode}\n`);
  stdout.write("Status: Waiting for Microsoft authorization.\n");

  let currentIntervalSeconds = intervalSeconds;
  let lastObserved = startedAt;

  while (true) {
    const beforeSleep = now();
    if (!Number.isFinite(beforeSleep) || beforeSleep < lastObserved) throw fixedError();
    if (beforeSleep >= expiresAt) break;
    const remainingMs = expiresAt - beforeSleep;
    await sleep(Math.min(currentIntervalSeconds * 1000, remainingMs));
    const afterSleep = now();
    if (!Number.isFinite(afterSleep) || afterSleep < beforeSleep) throw fixedError();
    lastObserved = afterSleep;
    if (afterSleep >= expiresAt) break;
    let tokenResponse;
    try {
      tokenResponse = await fetchImpl(tokenUrl, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: deviceGrant,
          client_id: normalizedClientId,
          device_code: device.device_code,
          scope: delegatedScope
        })
      });
    } catch {
      throw fixedError();
    }
    const token = await decodedResponse(tokenResponse);
    if (token?.error === "authorization_pending") continue;
    if (token?.error === "slow_down") {
      currentIntervalSeconds = Math.min(
        maxPollIntervalSeconds,
        currentIntervalSeconds + 5
      );
      continue;
    }
    if (
      !tokenResponse.ok ||
      !token ||
      typeof token.token_type !== "string" ||
      token.token_type.trim().toLowerCase() !== "bearer" ||
      !nonEmpty(token.refresh_token)
    ) {
      throw fixedError();
    }

    let refreshToken = token.refresh_token.trim();
    token.refresh_token = null;
    token.access_token = null;
    try {
      try {
        await writeClipboard(refreshToken);
      } catch {
        stdout.write(
          "Status: Clipboard copy could not be confirmed. Clear the Windows clipboard before retrying.\n"
        );
        throw fixedError();
      }
    } finally {
      refreshToken = "";
    }
    stdout.write("Status: Refresh token copied to the Windows clipboard.\n");
    stdout.write("Status: Paste it into the Cloudflare Pages Preview secret GRAPH_REFRESH_TOKEN_BOOTSTRAP.\n");
    stdout.write("Status: Clear the clipboard after the secret is saved.\n");
    return;
  }

  throw fixedError();
}

async function main() {
  const clientId = process.env.GRAPH_CLIENT_ID;
  const tenantId = process.env.GRAPH_TENANT_ID;
  if (!canonicalGuid.test(clientId ?? "") || !canonicalGuid.test(tenantId ?? "")) {
    throw fixedError();
  }
  await runGraphDeviceLogin({
    clientId,
    tenantId
  });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry === import.meta.url) {
  main().catch(() => {
    process.stderr.write("Status: Microsoft device authorization could not be completed.\n");
    process.exitCode = 1;
  });
}
