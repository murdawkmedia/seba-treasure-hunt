import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const helperPath = path.resolve("scripts", "graph-device-login.mjs");
const helperUrl = pathToFileURL(helperPath).href;
const clientId = "11111111-1111-4111-8111-111111111111";
const tenantId = "22222222-2222-4222-8222-222222222222";
const refreshToken = "refresh-token-that-must-remain-private";
const accessToken = "access-token-that-must-remain-private";
const deviceCode = "device-code-that-must-remain-private";

async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  return `http://127.0.0.1:${address.port}`;
}

async function close(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function allFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  }));
  return nested.flat();
}

test("device authorization prints only safe instructions and transfers the refresh token once", async () => {
  const requests = [];
  let polls = 0;
  const server = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk;
    requests.push({ url: request.url, body });
    response.setHeader("content-type", "application/json");
    if (request.url === "/device") {
      response.end(JSON.stringify({
        device_code: deviceCode,
        user_code: "ABCD-EFGH",
        verification_uri: "https://microsoft.com/devicelogin",
        expires_in: 60,
        interval: 0
      }));
      return;
    }
    polls += 1;
    if (polls === 1) {
      response.statusCode = 400;
      response.end(JSON.stringify({ error: "authorization_pending" }));
      return;
    }
    response.end(JSON.stringify({
      token_type: "Bearer",
      access_token: accessToken,
      refresh_token: refreshToken,
      expires_in: 3600
    }));
  });
  const baseUrl = await listen(server);
  const cwd = await mkdtemp(path.join(tmpdir(), "graph-device-login-"));
  const clipboardValues = [];
  let stdout = "";
  let stderr = "";
  try {
    const childCode = `
      import { runGraphDeviceLogin } from ${JSON.stringify(helperUrl)};
      await runGraphDeviceLogin({
        clientId: process.env.TEST_CLIENT_ID,
        tenantId: process.env.TEST_TENANT_ID,
        deviceCodeEndpoint: process.env.TEST_DEVICE_ENDPOINT,
        tokenEndpoint: process.env.TEST_TOKEN_ENDPOINT,
        fetchImpl: fetch,
        sleep: async () => {},
        stdout: process.stdout,
        writeClipboard: async (value) => process.send({ type: "clipboard", value })
      });
    `;
    const child = spawn(process.execPath, ["--input-type=module", "--eval", childCode], {
      cwd,
      env: {
        ...process.env,
        TEST_CLIENT_ID: clientId,
        TEST_TENANT_ID: tenantId,
        TEST_DEVICE_ENDPOINT: `${baseUrl}/device`,
        TEST_TOKEN_ENDPOINT: `${baseUrl}/token`
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("message", (message) => {
      if (message?.type === "clipboard") clipboardValues.push(message.value);
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });

    assert.equal(exitCode, 0, stderr);
    assert.deepEqual(clipboardValues, [refreshToken]);
    assert.match(stdout, /Verification URL: https:\/\/microsoft\.com\/devicelogin/);
    assert.match(stdout, /User code: ABCD-EFGH/);
    assert.match(stdout, /Status: Waiting for Microsoft authorization\./);
    assert.match(stdout, /Status: Refresh token copied to the Windows clipboard\./);
    assert.match(stdout, /Status: Paste it into the Cloudflare Pages Preview secret GRAPH_REFRESH_TOKEN_BOOTSTRAP\./);
    for (const privateValue of [refreshToken, accessToken, deviceCode]) {
      assert.equal(stdout.includes(privateValue), false);
      assert.equal(stderr.includes(privateValue), false);
    }

    assert.equal(requests.length, 3);
    const deviceForm = new URLSearchParams(requests[0].body);
    assert.equal(deviceForm.get("client_id"), clientId);
    assert.equal(deviceForm.get("scope"), "offline_access https://graph.microsoft.com/Mail.Send");
    const tokenForm = new URLSearchParams(requests[1].body);
    assert.equal(tokenForm.get("grant_type"), "urn:ietf:params:oauth:grant-type:device_code");
    assert.equal(tokenForm.get("client_id"), clientId);
    assert.equal(tokenForm.get("device_code"), deviceCode);
    assert.equal(tokenForm.get("scope"), "offline_access https://graph.microsoft.com/Mail.Send");

    const files = await allFiles(cwd);
    for (const file of files) {
      assert.equal((await readFile(file, "utf8")).includes(refreshToken), false);
    }
  } finally {
    await close(server);
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the Windows clipboard writer sends the token through child stdin, never argv", async () => {
  const { writeWindowsClipboard } = await import(helperUrl);
  const calls = [];
  const spawnImpl = (command, args, options) => {
    const child = new EventEmitter();
    child.stdin = {
      end(value) {
        calls.push({ type: "stdin", value });
        queueMicrotask(() => child.emit("close", 0));
      }
    };
    calls.push({ type: "spawn", command, args, options });
    return child;
  };

  await writeWindowsClipboard(refreshToken, spawnImpl);

  const spawnCall = calls.find((call) => call.type === "spawn");
  assert.ok(spawnCall);
  assert.equal(JSON.stringify(spawnCall.args).includes(refreshToken), false);
  assert.equal(spawnCall.options.stdio[0], "pipe");
  assert.deepEqual(calls.filter((call) => call.type === "stdin"), [
    { type: "stdin", value: refreshToken }
  ]);
});

test("unsafe Microsoft instructions are rejected before anything is printed or copied", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  let stdout = "";
  let clipboardCalls = 0;
  let requests = 0;

  await assert.rejects(
    runGraphDeviceLogin({
      clientId,
      tenantId,
      deviceCodeEndpoint: "https://login.microsoftonline.test/device",
      tokenEndpoint: "https://login.microsoftonline.test/token",
      fetchImpl: async () => {
        requests += 1;
        if (requests === 1) {
          return new Response(JSON.stringify({
            device_code: deviceCode,
            user_code: "ABCD-EFGH",
            verification_uri: `https://microsoft.com/devicelogin\n${refreshToken}`,
            expires_in: 60,
            interval: 1
          }), { headers: { "content-type": "application/json" } });
        }
        return new Response(JSON.stringify({ error: "authorization_declined" }), {
          status: 400,
          headers: { "content-type": "application/json" }
        });
      },
      sleep: async () => {},
      stdout: { write(value) { stdout += value; } },
      writeClipboard: async () => { clipboardCalls += 1; }
    }),
    /Microsoft device authorization could not be completed\./
  );

  assert.equal(stdout, "");
  assert.equal(clipboardCalls, 0);
});
