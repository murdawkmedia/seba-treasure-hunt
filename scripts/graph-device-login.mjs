import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";

const delegatedScope = "offline_access https://graph.microsoft.com/Mail.Send";
const deviceGrant = "urn:ietf:params:oauth:grant-type:device_code";
const canonicalGuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function fixedError() {
  return new Error("Microsoft device authorization could not be completed.");
}

function nonEmpty(value) {
  return typeof value === "string" && value.trim().length > 0;
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

export async function writeWindowsClipboard(value, spawnImpl = spawn) {
  const child = spawnImpl(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "$value = [Console]::In.ReadToEnd(); Set-Clipboard -Value $value"
    ],
    { windowsHide: true, stdio: ["pipe", "ignore", "ignore"] }
  );

  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      callback(value);
    };
    child.once("error", () => finish(reject, fixedError()));
    child.once("close", (code) => {
      if (code === 0) finish(resolve);
      else finish(reject, fixedError());
    });
    child.stdin?.once?.("error", () => finish(reject, fixedError()));
    child.stdin.end(value);
  });
}

export async function runGraphDeviceLogin(options) {
  const {
    clientId,
    tenantId,
    deviceCodeEndpoint,
    tokenEndpoint,
    fetchImpl = fetch,
    sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
    stdout = process.stdout,
    writeClipboard = writeWindowsClipboard
  } = options;

  if (
    !canonicalGuid.test(clientId ?? "") ||
    !canonicalGuid.test(tenantId ?? "") ||
    !nonEmpty(deviceCodeEndpoint) ||
    !nonEmpty(tokenEndpoint)
  ) {
    throw fixedError();
  }

  let deviceResponse;
  try {
    deviceResponse = await fetchImpl(deviceCodeEndpoint, {
      method: "POST",
      redirect: "manual",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: clientId, scope: delegatedScope })
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
  if (
    !device ||
    !nonEmpty(device.device_code) ||
    !userCode ||
    !verificationUri ||
    !Number.isFinite(device.expires_in) ||
    device.expires_in <= 0
  ) {
    throw fixedError();
  }

  stdout.write(`Verification URL: ${verificationUri}\n`);
  stdout.write(`User code: ${userCode}\n`);
  stdout.write("Status: Waiting for Microsoft authorization.\n");

  const expiresAt = Date.now() + Math.floor(device.expires_in * 1000);
  let intervalSeconds = Number.isFinite(device.interval)
    ? Math.max(1, Math.floor(device.interval))
    : 5;

  while (Date.now() < expiresAt) {
    await sleep(intervalSeconds * 1000);
    let tokenResponse;
    try {
      tokenResponse = await fetchImpl(tokenEndpoint, {
        method: "POST",
        redirect: "manual",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: deviceGrant,
          client_id: clientId,
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
      intervalSeconds += 5;
      continue;
    }
    if (
      !tokenResponse.ok ||
      !token ||
      token.token_type?.trim().toLowerCase() !== "bearer" ||
      !nonEmpty(token.refresh_token)
    ) {
      throw fixedError();
    }

    let refreshToken = token.refresh_token.trim();
    token.refresh_token = null;
    token.access_token = null;
    try {
      await writeClipboard(refreshToken);
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
    tenantId,
    deviceCodeEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`,
    tokenEndpoint: `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`
  });
}

const entry = process.argv[1] ? pathToFileURL(process.argv[1]).href : null;
if (entry === import.meta.url) {
  main().catch(() => {
    process.stderr.write("Status: Microsoft device authorization could not be completed.\n");
    process.exitCode = 1;
  });
}
