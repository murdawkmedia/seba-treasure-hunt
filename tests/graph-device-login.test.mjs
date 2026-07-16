import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
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
const deviceUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/devicecode`;
const tokenUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;

async function allFiles(root) {
  const entries = await readdir(root, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(root, entry.name);
    return entry.isDirectory() ? allFiles(target) : [target];
  }));
  return nested.flat();
}

function manualTimers() {
  const pending = [];
  return {
    setTimeoutImpl(callback, milliseconds) {
      const handle = { callback, milliseconds, cleared: false };
      pending.push(handle);
      return handle;
    },
    clearTimeoutImpl(handle) {
      handle.cleared = true;
    },
    fireNext() {
      const handle = pending.find((candidate) => !candidate.cleared);
      assert.ok(handle, "a timer must be pending");
      handle.cleared = true;
      handle.callback();
      return handle.milliseconds;
    },
    pendingCount() {
      return pending.filter((handle) => !handle.cleared).length;
    }
  };
}

function fakeClipboardChild({ end, kill } = {}) {
  const child = new EventEmitter();
  const stdin = new EventEmitter();
  const events = [];
  stdin.end = (value) => {
    events.push({ type: "stdin.end", value });
    end?.({ child, stdin, events });
  };
  stdin.destroy = () => {
    events.push({ type: "stdin.destroy" });
  };
  child.stdin = stdin;
  child.kill = (signal) => {
    events.push({ type: "kill", signal });
    kill?.({ child, stdin, events });
    return true;
  };
  return { child, stdin, events };
}

const clipboardOptions = (spawnImpl, timers) => ({
  spawnImpl,
  timeoutMs: 50,
  cleanupGraceMs: 25,
  setTimeoutImpl: timers.setTimeoutImpl,
  clearTimeoutImpl: timers.clearTimeoutImpl
});

test("device authorization pins both OAuth calls to the validated tenant and transfers the token once", async () => {
  const requests = [];
  const cwd = await mkdtemp(path.join(tmpdir(), "graph-device-login-"));
  const clipboardValues = [];
  let stdout = "";
  let stderr = "";
  try {
    const childCode = `
      import { runGraphDeviceLogin } from ${JSON.stringify(helperUrl)};
      let polls = 0;
      await runGraphDeviceLogin({
        clientId: process.env.TEST_CLIENT_ID,
        tenantId: process.env.TEST_TENANT_ID,
        deviceCodeEndpoint: "https://attacker.invalid/device",
        tokenEndpoint: "https://other-attacker.invalid/token",
        fetchImpl: async (url, init) => {
          process.send({
            type: "request",
            url: String(url),
            method: init.method,
            redirect: init.redirect,
            contentType: new Headers(init.headers).get("content-type"),
            body: String(init.body)
          });
          if (String(url).endsWith("/devicecode")) {
            return new Response(JSON.stringify({
              device_code: process.env.TEST_DEVICE_CODE,
              user_code: "ABCD-EFGH",
              verification_uri: "https://microsoft.com/devicelogin",
              expires_in: 60,
              interval: 1
            }), { headers: { "content-type": "application/json" } });
          }
          polls += 1;
          if (polls === 1) {
            return new Response(JSON.stringify({ error: "authorization_pending" }), {
              status: 400,
              headers: { "content-type": "application/json" }
            });
          }
          return new Response(JSON.stringify({
            token_type: "Bearer",
            access_token: process.env.TEST_ACCESS_TOKEN,
            refresh_token: process.env.TEST_REFRESH_TOKEN,
            expires_in: 3600
          }), { headers: { "content-type": "application/json" } });
        },
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
        TEST_DEVICE_CODE: deviceCode,
        TEST_ACCESS_TOKEN: accessToken,
        TEST_REFRESH_TOKEN: refreshToken
      },
      stdio: ["ignore", "pipe", "pipe", "ipc"]
    });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("message", (message) => {
      if (message?.type === "clipboard") clipboardValues.push(message.value);
      if (message?.type === "request") requests.push(message);
    });
    const exitCode = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", resolve);
    });

    assert.equal(exitCode, 0, stderr);
    assert.deepEqual(clipboardValues, [refreshToken]);
    assert.deepEqual(requests.map((request) => request.url), [deviceUrl, tokenUrl, tokenUrl]);
    assert.ok(requests.every((request) => request.method === "POST"));
    assert.ok(requests.every((request) => request.redirect === "manual"));
    assert.ok(requests.every((request) => request.contentType === "application/x-www-form-urlencoded"));
    assert.equal(requests.some((request) => request.url.includes("attacker.invalid")), false);
    assert.match(stdout, /Verification URL: https:\/\/microsoft\.com\/devicelogin/);
    assert.match(stdout, /User code: ABCD-EFGH/);
    assert.match(stdout, /Status: Waiting for Microsoft authorization\./);
    assert.match(stdout, /Status: Refresh token copied to the Windows clipboard\./);
    assert.match(stdout, /Status: Paste it into the Cloudflare Pages Preview secret GRAPH_REFRESH_TOKEN_BOOTSTRAP\./);
    for (const privateValue of [refreshToken, accessToken, deviceCode]) {
      assert.equal(stdout.includes(privateValue), false);
      assert.equal(stderr.includes(privateValue), false);
      assert.equal(child.spawnargs.some((argument) => argument.includes(privateValue)), false);
    }

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
    await rm(cwd, { recursive: true, force: true });
  }
});

test("the Windows clipboard writer sends the token through child stdin, never argv", async () => {
  const { writeWindowsClipboard } = await import(helperUrl);
  const timers = manualTimers();
  const fake = fakeClipboardChild({
    end: ({ child }) => queueMicrotask(() => child.emit("close", 0))
  });
  const spawnCalls = [];
  const spawnImpl = (command, args, options) => {
    spawnCalls.push({ command, args, options });
    return fake.child;
  };

  await writeWindowsClipboard(refreshToken, clipboardOptions(spawnImpl, timers));

  assert.equal(spawnCalls.length, 1);
  assert.equal(JSON.stringify(spawnCalls[0].args).includes(refreshToken), false);
  assert.equal(spawnCalls[0].options.stdio[0], "pipe");
  assert.deepEqual(fake.events.filter((event) => event.type === "stdin.end"), [
    { type: "stdin.end", value: refreshToken }
  ]);
  assert.equal(fake.events.some((event) => event.type === "stdin.destroy"), false);
  assert.equal(timers.pendingCount(), 0);
});

for (const scenario of ["spawn-event", "stdin-error", "nonzero-close"]) {
  test(`clipboard ${scenario} failure destroys stdin, terminates the child, and fails safely`, async () => {
    const { writeWindowsClipboard } = await import(helperUrl);
    const timers = manualTimers();
    const fake = fakeClipboardChild({
      end: ({ child, stdin }) => queueMicrotask(() => {
        if (scenario === "spawn-event") child.emit("error", new Error(refreshToken));
        if (scenario === "stdin-error") stdin.emit("error", new Error(refreshToken));
        if (scenario === "nonzero-close") child.emit("close", 7);
      }),
      kill: ({ child }) => queueMicrotask(() => child.emit("close", null))
    });
    const spawnImpl = () => fake.child;

    await assert.rejects(
      writeWindowsClipboard(refreshToken, clipboardOptions(spawnImpl, timers)),
      (error) => error.message === "Microsoft device authorization could not be completed."
    );

    assert.equal(fake.events.filter((event) => event.type === "stdin.destroy").length, 1);
    assert.deepEqual(fake.events.filter((event) => event.type === "kill"), [
      { type: "kill", signal: "SIGKILL" }
    ]);
    assert.equal(timers.pendingCount(), 0);
  });
}

test("clipboard timeout terminates the child and waits for close", async () => {
  const { writeWindowsClipboard } = await import(helperUrl);
  const timers = manualTimers();
  const fake = fakeClipboardChild({
    kill: ({ child }) => queueMicrotask(() => child.emit("close", null))
  });
  const pending = writeWindowsClipboard(
    refreshToken,
    clipboardOptions(() => fake.child, timers)
  );

  assert.equal(timers.fireNext(), 50);
  await assert.rejects(pending, /Microsoft device authorization could not be completed\./);
  assert.equal(fake.events.filter((event) => event.type === "stdin.destroy").length, 1);
  assert.deepEqual(fake.events.filter((event) => event.type === "kill"), [
    { type: "kill", signal: "SIGKILL" }
  ]);
  assert.equal(timers.pendingCount(), 0);
});

test("clipboard cleanup has a bounded grace period when a terminated child never closes", async () => {
  const { writeWindowsClipboard } = await import(helperUrl);
  const timers = manualTimers();
  const fake = fakeClipboardChild();
  const pending = writeWindowsClipboard(
    refreshToken,
    clipboardOptions(() => fake.child, timers)
  );

  assert.equal(timers.fireNext(), 50);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(timers.fireNext(), 25);
  await assert.rejects(pending, /Microsoft device authorization could not be completed\./);
  assert.equal(fake.events.filter((event) => event.type === "stdin.destroy").length, 1);
  assert.equal(fake.events.filter((event) => event.type === "kill").length, 1);
  assert.equal(timers.pendingCount(), 0);
});

test("a synchronous clipboard spawn failure is fixed and contains no token", async () => {
  const { writeWindowsClipboard } = await import(helperUrl);
  const timers = manualTimers();
  await assert.rejects(
    writeWindowsClipboard(refreshToken, clipboardOptions(() => { throw new Error(refreshToken); }, timers)),
    (error) =>
      error.message === "Microsoft device authorization could not be completed." &&
      !error.message.includes(refreshToken)
  );
});

test("an ambiguous clipboard failure emits only a fixed clear-before-retry warning", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  let stdout = "";
  let now = 0;
  let requests = 0;
  await assert.rejects(
    runGraphDeviceLogin({
      clientId,
      tenantId,
      fetchImpl: async () => {
        requests += 1;
        if (requests === 1) {
          return new Response(JSON.stringify({
            device_code: deviceCode,
            user_code: "ABCD-EFGH",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 60,
            interval: 1
          }));
        }
        return new Response(JSON.stringify({
          token_type: "Bearer",
          access_token: accessToken,
          refresh_token: refreshToken
        }));
      },
      now: () => now,
      sleep: async (milliseconds) => { now += milliseconds; },
      stdout: { write(value) { stdout += value; } },
      writeClipboard: async () => { throw new Error(refreshToken); }
    }),
    (error) =>
      error.message === "Microsoft device authorization could not be completed." &&
      !error.message.includes(refreshToken)
  );

  assert.match(stdout, /Status: Clipboard copy could not be confirmed\. Clear the Windows clipboard before retrying\./);
  assert.doesNotMatch(stdout, /Refresh token copied/);
  assert.equal(stdout.includes(refreshToken), false);
});

test("unsafe Microsoft instructions are rejected before anything is printed or copied", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  let stdout = "";
  let clipboardCalls = 0;

  await assert.rejects(
    runGraphDeviceLogin({
      clientId,
      tenantId,
      fetchImpl: async () => new Response(JSON.stringify({
        device_code: deviceCode,
        user_code: "ABCD-EFGH",
        verification_uri: `https://microsoft.com/devicelogin\n${refreshToken}`,
        expires_in: 60,
        interval: 1
      })),
      stdout: { write(value) { stdout += value; } },
      writeClipboard: async () => { clipboardCalls += 1; }
    }),
    /Microsoft device authorization could not be completed\./
  );

  assert.equal(stdout, "");
  assert.equal(clipboardCalls, 0);
});

for (const [label, device] of [
  ["oversized expiry", { expires_in: Number.MAX_SAFE_INTEGER, interval: 5 }],
  ["oversized poll interval", { expires_in: 60, interval: 31 }]
]) {
  test(`rejects an ${label} before printing or polling`, async () => {
    const { runGraphDeviceLogin } = await import(helperUrl);
    let calls = 0;
    let stdout = "";
    await assert.rejects(
      runGraphDeviceLogin({
        clientId,
        tenantId,
        fetchImpl: async () => {
          calls += 1;
          return new Response(JSON.stringify({
            device_code: deviceCode,
            user_code: "ABCD-EFGH",
            verification_uri: "https://microsoft.com/devicelogin",
            ...device
          }));
        },
        stdout: { write(value) { stdout += value; } }
      }),
      /Microsoft device authorization could not be completed\./
    );
    assert.equal(calls, 1);
    assert.equal(stdout, "");
  });
}

test("slow_down increases the poll interval only to the bounded maximum", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  let now = 0;
  let calls = 0;
  const sleeps = [];
  let copied = null;
  await runGraphDeviceLogin({
    clientId,
    tenantId,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) {
        return new Response(JSON.stringify({
          device_code: deviceCode,
          user_code: "ABCD-EFGH",
          verification_uri: "https://microsoft.com/devicelogin",
          expires_in: 120,
          interval: 28
        }));
      }
      if (calls === 2) {
        return new Response(JSON.stringify({ error: "slow_down" }), { status: 400 });
      }
      return new Response(JSON.stringify({
        token_type: "Bearer",
        access_token: accessToken,
        refresh_token: refreshToken
      }));
    },
    now: () => now,
    sleep: async (milliseconds) => {
      sleeps.push(milliseconds);
      now += milliseconds;
    },
    stdout: { write() {} },
    writeClipboard: async (value) => { copied = value; }
  });

  assert.deepEqual(sleeps, [28_000, 30_000]);
  assert.equal(copied, refreshToken);
});

test("expiry reached during sleep prevents a token request", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  let now = 0;
  let calls = 0;
  const sleeps = [];
  await assert.rejects(
    runGraphDeviceLogin({
      clientId,
      tenantId,
      fetchImpl: async () => {
        calls += 1;
        return new Response(JSON.stringify({
          device_code: deviceCode,
          user_code: "ABCD-EFGH",
          verification_uri: "https://microsoft.com/devicelogin",
          expires_in: 60,
          interval: 30
        }));
      },
      now: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now = 60_000;
      },
      stdout: { write() {} }
    }),
    /Microsoft device authorization could not be completed\./
  );

  assert.deepEqual(sleeps, [30_000]);
  assert.equal(calls, 1);
});

test("a clock value that would overflow the deadline is rejected before instructions print", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  let calls = 0;
  let stdout = "";
  await assert.rejects(
    runGraphDeviceLogin({
      clientId,
      tenantId,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({
            device_code: deviceCode,
            user_code: "ABCD-EFGH",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 60,
            interval: 1
          }));
        }
        return new Response(JSON.stringify({
          token_type: "Bearer",
          refresh_token: refreshToken
        }));
      },
      now: () => Number.MAX_VALUE,
      sleep: async () => {},
      stdout: { write(value) { stdout += value; } },
      writeClipboard: async () => {}
    }),
    /Microsoft device authorization could not be completed\./
  );

  assert.equal(calls, 1);
  assert.equal(stdout, "");
});

test("a backwards clock after sleep fails before polling", async () => {
  const { runGraphDeviceLogin } = await import(helperUrl);
  const clock = [1_000, 1_000, 999];
  let calls = 0;
  let clipboardCalls = 0;
  await assert.rejects(
    runGraphDeviceLogin({
      clientId,
      tenantId,
      fetchImpl: async () => {
        calls += 1;
        if (calls === 1) {
          return new Response(JSON.stringify({
            device_code: deviceCode,
            user_code: "ABCD-EFGH",
            verification_uri: "https://microsoft.com/devicelogin",
            expires_in: 60,
            interval: 1
          }));
        }
        return new Response(JSON.stringify({
          token_type: "Bearer",
          refresh_token: refreshToken
        }));
      },
      now: () => clock.shift() ?? 999,
      sleep: async () => {},
      stdout: { write() {} },
      writeClipboard: async () => { clipboardCalls += 1; }
    }),
    /Microsoft device authorization could not be completed\./
  );

  assert.equal(calls, 1);
  assert.equal(clipboardCalls, 0);
});
