import assert from "node:assert/strict";
import test from "node:test";
import type {
  GraphRefreshTokenStore,
  StoredGraphRefreshToken
} from "../src/server/graph-token-store";
import {
  MicrosoftGraphTransactionalMailer,
  type MicrosoftGraphMailerConfig
} from "../src/server/microsoft-graph-mailer";
import {
  TransactionalMailError,
  type TransactionalMessage
} from "../src/server/transactional-mail";

const tenantId = "11111111-2222-3333-4444-555555555555";
const clientId = "graph-client-id";
const tokenUrl =
  `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`;
const sendUrl = "https://graph.microsoft.com/v1.0/me/sendMail";
const scope = "offline_access https://graph.microsoft.com/Mail.Send";
const acceptedAt = new Date("2026-07-14T20:15:30.000Z");

const message: TransactionalMessage = {
  to: "hunter@example.test",
  from: {
    name: "Tim Lost Something? by SebaHub",
    address: "tech@sebahub.com"
  },
  replyTo: "casey@sebahub.com",
  subject: "Your legal receipt",
  text: "Full legal plain-text receipt",
  html: "<main><h1>Full legal HTML receipt</h1></main>",
  correlationId: "delivery-correlation-123",
  sentAt: new Date("2026-07-14T20:00:00.000Z")
};

interface SaveAttempt {
  expectedVersion: number | null;
  refreshToken: string;
  won: boolean;
}

class MemoryGraphRefreshTokenStore implements GraphRefreshTokenStore {
  private state: StoredGraphRefreshToken | null;
  readonly saves: SaveAttempt[] = [];
  loadCount = 0;
  failLoad = false;
  failSave = false;

  constructor(initial: StoredGraphRefreshToken | null = null) {
    this.state = initial ? { ...initial } : null;
  }

  async load(): Promise<StoredGraphRefreshToken | null> {
    this.loadCount += 1;
    if (this.failLoad) throw new Error("sensitive D1 load detail");
    return this.state ? { ...this.state } : null;
  }

  async save(expectedVersion: number | null, refreshToken: string): Promise<boolean> {
    if (this.failSave) throw new Error("sensitive D1 save detail");

    const won =
      expectedVersion === null
        ? this.state === null
        : this.state?.stateVersion === expectedVersion;
    if (won) {
      this.state = {
        refreshToken,
        stateVersion: expectedVersion === null ? 1 : expectedVersion + 1
      };
    }
    this.saves.push({ expectedVersion, refreshToken, won });
    return won;
  }

  snapshot(): StoredGraphRefreshToken | null {
    return this.state ? { ...this.state } : null;
  }
}

interface CapturedRequest {
  url: string;
  method: string;
  headers: Headers;
  body: string;
}

type FetchResponder = (
  request: CapturedRequest,
  requestIndex: number
) => Response | Promise<Response>;

function capturingFetch(
  responder: FetchResponder
): { fetch: typeof globalThis.fetch; requests: CapturedRequest[] } {
  const requests: CapturedRequest[] = [];
  const fetch = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const captured = {
      url: request.url,
      method: request.method,
      headers: new Headers(request.headers),
      body: await request.text()
    };
    requests.push(captured);
    return responder(captured, requests.length - 1);
  };
  return { fetch: fetch as typeof globalThis.fetch, requests };
}

function tokenResponse(
  accessToken = "access-token-secret",
  refreshToken?: string
): Response {
  return Response.json({
    token_type: "Bearer",
    expires_in: 3600,
    scope,
    access_token: accessToken,
    ...(refreshToken === undefined ? {} : { refresh_token: refreshToken })
  });
}

function graphAccepted(requestId?: string): Response {
  return new Response(
    null,
    requestId === undefined
      ? { status: 202 }
      : { status: 202, headers: { "request-id": requestId } }
  );
}

function makeMailer(
  overrides: Partial<MicrosoftGraphMailerConfig> = {},
  responder: FetchResponder = (request) =>
    request.url === tokenUrl ? tokenResponse() : graphAccepted("graph-request-123")
): {
  mailer: MicrosoftGraphTransactionalMailer;
  store: MemoryGraphRefreshTokenStore;
  requests: CapturedRequest[];
} {
  const store =
    overrides.tokenStore instanceof MemoryGraphRefreshTokenStore
      ? overrides.tokenStore
      : new MemoryGraphRefreshTokenStore({
          refreshToken: "stored-refresh-secret",
          stateVersion: 7
        });
  const captured = capturingFetch(responder);
  return {
    mailer: new MicrosoftGraphTransactionalMailer({
      fetch: captured.fetch,
      clientId,
      tenantId,
      bootstrapRefreshToken: "bootstrap-refresh-secret",
      tokenStore: store,
      now: () => acceptedAt,
      ...overrides
    }),
    store,
    requests: captured.requests
  };
}

function decodeBase64(value: string): string {
  const bytes = Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

function base64Utf8(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function expectMailError(
  operation: () => Promise<unknown>,
  code:
    | "provider_unavailable"
    | "provider_rejected"
    | "provider_delivery_uncertain",
  forbidden: string[] = []
): Promise<void> {
  await assert.rejects(operation(), (error: unknown) => {
    assert.ok(error instanceof TransactionalMailError);
    assert.equal(error.code, code);
    assert.equal(error.message, code);
    const serialized = `${String(error)} ${JSON.stringify(error)}`;
    for (const secret of forbidden) assert.equal(serialized.includes(secret), false);
    return true;
  });
}

test("refreshes from stored state and sends the exact Graph MIME request", async () => {
  const accessToken = "access-token-secret";
  const rotatedRefreshToken = "rotated-refresh-secret";
  const bootstrapRefreshToken = "bootstrap-refresh-secret";
  const { mailer, store, requests } = makeMailer(
    { bootstrapRefreshToken },
    (request) =>
      request.url === tokenUrl
        ? tokenResponse(accessToken, rotatedRefreshToken)
        : graphAccepted("graph-request-123")
  );

  const result = await mailer.send(message);

  assert.equal(store.loadCount, 1);
  assert.deepEqual(store.saves, [
    { expectedVersion: 7, refreshToken: rotatedRefreshToken, won: true }
  ]);
  assert.deepEqual(store.snapshot(), {
    refreshToken: rotatedRefreshToken,
    stateVersion: 8
  });
  assert.equal(requests.length, 2);

  const tokenRequest = requests[0]!;
  assert.equal(tokenRequest.url, tokenUrl);
  assert.equal(tokenRequest.method, "POST");
  assert.equal(
    tokenRequest.headers.get("content-type")?.split(";", 1)[0],
    "application/x-www-form-urlencoded"
  );
  const tokenForm = new URLSearchParams(tokenRequest.body);
  assert.equal(tokenForm.get("grant_type"), "refresh_token");
  assert.equal(tokenForm.get("client_id"), clientId);
  assert.equal(tokenForm.get("scope"), scope);
  assert.equal(tokenForm.get("refresh_token"), "stored-refresh-secret");
  assert.notEqual(tokenForm.get("refresh_token"), bootstrapRefreshToken);
  assert.deepEqual([...tokenForm.keys()].sort(), [
    "client_id",
    "grant_type",
    "refresh_token",
    "scope"
  ]);

  const sendRequest = requests[1]!;
  assert.equal(sendRequest.url, sendUrl);
  assert.equal(sendRequest.method, "POST");
  assert.equal(sendRequest.headers.get("authorization"), `Bearer ${accessToken}`);
  assert.equal(sendRequest.headers.get("content-type"), "text/plain");
  assert.equal(sendRequest.headers.get("client-request-id"), message.correlationId);
  assert.equal(sendRequest.headers.get("return-client-request-id"), "true");
  assert.match(sendRequest.body, /^[A-Za-z0-9+/]+=*$/);
  const mime = decodeBase64(sendRequest.body);
  assert.match(mime, /^Reply-To: casey@sebahub\.com\r$/m);
  assert.match(mime, /Content-Type: multipart\/alternative/);
  assert.match(mime, /Content-Type: text\/plain; charset=UTF-8/);
  assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
  assert.ok(mime.includes(base64Utf8(message.text)));
  assert.ok(mime.includes(base64Utf8(message.html!)));

  assert.deepEqual(result, {
    provider: "microsoft_graph",
    providerReference: "graph-request-123",
    providerReferenceKind: "graph_request_id",
    acceptedAt: acceptedAt.toISOString()
  });
});

test("uses bootstrap state only when the store is empty", async () => {
  const store = new MemoryGraphRefreshTokenStore();
  const { mailer, requests } = makeMailer({ tokenStore: store });

  await mailer.send(message);

  assert.equal(new URLSearchParams(requests[0]!.body).get("refresh_token"), "bootstrap-refresh-secret");
  assert.deepEqual(store.saves, []);
  assert.equal(store.snapshot(), null);
});

test("persists an initial rotated refresh token with a null CAS version", async () => {
  const store = new MemoryGraphRefreshTokenStore();
  const { mailer } = makeMailer(
    { tokenStore: store },
    (request) =>
      request.url === tokenUrl
        ? tokenResponse("access-token", "first-rotated-refresh")
        : graphAccepted()
  );

  await mailer.send(message);

  assert.deepEqual(store.saves, [
    { expectedVersion: null, refreshToken: "first-rotated-refresh", won: true }
  ]);
  assert.deepEqual(store.snapshot(), {
    refreshToken: "first-rotated-refresh",
    stateVersion: 1
  });
});

test("does not persist a missing or whitespace-only rotated refresh token", async () => {
  for (const response of [tokenResponse("access-token"), tokenResponse("access-token", "   ")]) {
    const store = new MemoryGraphRefreshTokenStore({
      refreshToken: "stored-refresh",
      stateVersion: 2
    });
    const { mailer } = makeMailer(
      { tokenStore: store },
      (request) => (request.url === tokenUrl ? response : graphAccepted())
    );

    await mailer.send(message);
    assert.deepEqual(store.saves, []);
  }
});

test("two concurrent rotations have one CAS winner and both current sends continue", async () => {
  const store = new MemoryGraphRefreshTokenStore({
    refreshToken: "shared-refresh",
    stateVersion: 5
  });
  let tokenCount = 0;
  let sendCount = 0;
  const { mailer } = makeMailer({ tokenStore: store }, (request) => {
    if (request.url === tokenUrl) {
      tokenCount += 1;
      return tokenResponse(`access-${tokenCount}`, `rotated-${tokenCount}`);
    }
    sendCount += 1;
    return graphAccepted(`graph-request-${sendCount}`);
  });

  const results = await Promise.all([mailer.send(message), mailer.send(message)]);

  assert.equal(tokenCount, 2);
  assert.equal(sendCount, 2);
  assert.equal(results.length, 2);
  assert.equal(store.saves.length, 2);
  assert.deepEqual(store.saves.map((attempt) => attempt.expectedVersion), [5, 5]);
  assert.equal(store.saves.filter((attempt) => attempt.won).length, 1);
  assert.equal(store.saves.filter((attempt) => !attempt.won).length, 1);
  assert.equal(store.snapshot()?.stateVersion, 6);
});

test("missing configuration and token-store failures fail unavailable before network access", async () => {
  const missingCases: Array<Partial<MicrosoftGraphMailerConfig>> = [
    { clientId: null },
    { clientId: "" },
    { tenantId: null },
    { tenantId: "" },
    {
      tokenStore: new MemoryGraphRefreshTokenStore(),
      bootstrapRefreshToken: null
    },
    {
      tokenStore: new MemoryGraphRefreshTokenStore(),
      bootstrapRefreshToken: "   "
    }
  ];

  for (const overrides of missingCases) {
    const { mailer, requests } = makeMailer(overrides);
    await expectMailError(() => mailer.send(message), "provider_unavailable");
    assert.equal(requests.length, 0);
  }

  const failingStore = new MemoryGraphRefreshTokenStore();
  failingStore.failLoad = true;
  const { mailer, requests } = makeMailer({ tokenStore: failingStore });
  await expectMailError(
    () => mailer.send(message),
    "provider_unavailable",
    ["sensitive D1 load detail"]
  );
  assert.equal(requests.length, 0);
});

test("rejects tenant path and URL injection before making a request", async () => {
  for (const unsafeTenant of [
    "tenant/../attacker",
    "tenant\\attacker",
    "tenant%2Fattacker",
    "tenant?x=1",
    "tenant#fragment",
    "..",
    "tenant\r\nHost: attacker.test"
  ]) {
    const { mailer, requests } = makeMailer({ tenantId: unsafeTenant });
    await expectMailError(() => mailer.send(message), "provider_unavailable", [unsafeTenant]);
    assert.equal(requests.length, 0);
  }
});

test("maps every token endpoint failure to one private unavailable error", async () => {
  const tokenSecret = "stored-refresh-secret";
  const accessSecret = "access-token-from-bad-payload";
  const providerBodySecret = "provider-description-secret";
  const failures: Array<() => Response | Promise<Response>> = [
    async () => {
      throw new Error(`network failed with ${tokenSecret}`);
    },
    () => new Response(providerBodySecret, { status: 400 }),
    () => new Response(`not-json-${providerBodySecret}`, { status: 200 }),
    () =>
      Response.json({
        error: "invalid_grant",
        error_description: providerBodySecret,
        access_token: accessSecret
      }),
    () => Response.json({ token_type: "Bearer" }),
    () => Response.json({ access_token: "" }),
    () => Response.json({ access_token: "   " }),
    () => Response.json(null),
    () => Response.json([accessSecret])
  ];

  for (const failure of failures) {
    let tokenCalls = 0;
    let sendCalls = 0;
    const { mailer } = makeMailer({}, async (request) => {
      if (request.url === tokenUrl) {
        tokenCalls += 1;
        return failure();
      }
      sendCalls += 1;
      return graphAccepted();
    });

    await expectMailError(
      () => mailer.send(message),
      "provider_unavailable",
      [tokenSecret, accessSecret, providerBodySecret]
    );
    assert.equal(tokenCalls, 1);
    assert.equal(sendCalls, 0);
  }
});

test("never falls back to bootstrap after a stored refresh token fails", async () => {
  const { mailer, requests } = makeMailer(
    { bootstrapRefreshToken: "bootstrap-must-not-be-used" },
    () => Response.json({ error: "invalid_grant" }, { status: 400 })
  );

  await expectMailError(() => mailer.send(message), "provider_unavailable");

  assert.equal(requests.length, 1);
  assert.equal(
    new URLSearchParams(requests[0]!.body).get("refresh_token"),
    "stored-refresh-secret"
  );
  assert.equal(requests[0]!.body.includes("bootstrap-must-not-be-used"), false);
});

test("a rotated-token save exception fails closed before Graph submission", async () => {
  const store = new MemoryGraphRefreshTokenStore({
    refreshToken: "stored-refresh",
    stateVersion: 3
  });
  store.failSave = true;
  let sendCalls = 0;
  const { mailer } = makeMailer({ tokenStore: store }, (request) => {
    if (request.url === tokenUrl) return tokenResponse("access-secret", "rotated-secret");
    sendCalls += 1;
    return graphAccepted();
  });

  await expectMailError(
    () => mailer.send(message),
    "provider_unavailable",
    ["sensitive D1 save detail", "access-secret", "rotated-secret"]
  );
  assert.equal(sendCalls, 0);
});

test("202 without a safe provider request ID uses the client correlation reference", async () => {
  for (const unsafeReference of [undefined, "", "   ", "x".repeat(300), "request\u0000id", "a\r\nb"]) {
    const { mailer } = makeMailer({}, (request) => {
      if (request.url === tokenUrl) return tokenResponse();
      if (unsafeReference === undefined) return graphAccepted();
      const response = graphAccepted();
      Object.defineProperty(response, "headers", {
        value: {
          get(name: string): string | null {
            return name.toLowerCase() === "request-id" ? unsafeReference : null;
          }
        }
      });
      return response;
    });

    const result = await mailer.send(message);
    assert.deepEqual(result, {
      provider: "microsoft_graph",
      providerReference: message.correlationId,
      providerReferenceKind: "client_request_id",
      acceptedAt: acceptedAt.toISOString()
    });
  }
});

test("accepts a bounded single-line provider request ID after trimming it", async () => {
  const { mailer } = makeMailer({}, (request) =>
    request.url === tokenUrl ? tokenResponse() : graphAccepted("  graph-request-safe_123  ")
  );

  assert.deepEqual(await mailer.send(message), {
    provider: "microsoft_graph",
    providerReference: "graph-request-safe_123",
    providerReferenceKind: "graph_request_id",
    acceptedAt: acceptedAt.toISOString()
  });
});

test("only Graph status 202 is accepted and rejection bodies are never consumed", async () => {
  for (const status of [200, 201, 204, 400, 429, 500]) {
    const rejection = new Response(
      status === 204 ? null : "secret Graph response body was inspected",
      { status }
    );
    const { mailer } = makeMailer({}, (request) =>
      request.url === tokenUrl ? tokenResponse() : rejection
    );

    await expectMailError(
      () => mailer.send(message),
      "provider_rejected",
      ["secret Graph response body was inspected"]
    );
    assert.equal(rejection.bodyUsed, false);
  }
});

test("a thrown Graph send after token acquisition is delivery uncertain", async () => {
  const accessSecret = "access-token-secret";
  const { mailer } = makeMailer({}, async (request) => {
    if (request.url === tokenUrl) return tokenResponse(accessSecret);
    throw new Error(`socket closed after submission ${accessSecret}`);
  });

  await expectMailError(
    () => mailer.send(message),
    "provider_delivery_uncertain",
    [accessSecret, "socket closed after submission"]
  );
});

test("token values and provider response bodies never enter errors or console output", async () => {
  const secrets = [
    "privacy-refresh-secret",
    "privacy-access-secret",
    "privacy-provider-body-secret"
  ];
  const entries: unknown[][] = [];
  const original = {
    error: console.error,
    warn: console.warn,
    log: console.log,
    info: console.info
  };
  console.error = (...args: unknown[]) => entries.push(args);
  console.warn = (...args: unknown[]) => entries.push(args);
  console.log = (...args: unknown[]) => entries.push(args);
  console.info = (...args: unknown[]) => entries.push(args);

  try {
    const store = new MemoryGraphRefreshTokenStore({
      refreshToken: secrets[0]!,
      stateVersion: 1
    });
    const { mailer } = makeMailer({ tokenStore: store }, (request) =>
      request.url === tokenUrl
        ? tokenResponse(secrets[1]!)
        : new Response(secrets[2], { status: 400 })
    );
    await expectMailError(() => mailer.send(message), "provider_rejected", secrets);
    assert.deepEqual(entries, []);
    const serializedEntries = JSON.stringify(entries);
    for (const secret of secrets) assert.equal(serializedEntries.includes(secret), false);
  } finally {
    console.error = original.error;
    console.warn = original.warn;
    console.log = original.log;
    console.info = original.info;
  }
});
