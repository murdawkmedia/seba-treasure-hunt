import assert from "node:assert/strict";
import test from "node:test";

const boardModule = await import("../src/client/board") as Record<string, unknown>;

type DashboardOutcome = "ok" | "unauthorized" | "network-error";

class FakeElement {
  hidden = false;
  innerHTML = "";
  textContent = "";
  value = "";
  disabled = false;
  dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();

  addEventListener(): void {}
  remove(): void {}
  focus(): void {}

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value);
  }

  querySelector(_selector: string): FakeElement | null {
    return null;
  }

  querySelectorAll(): FakeElement[] {
    return [];
  }
}

class FakeButton extends FakeElement {}
class FakeTextArea extends FakeElement {}

class FakeInput extends FakeElement {
  files: FileList | null = null;
}

class FakeForm extends FakeElement {
  readonly fields = new Map<string, FakeElement>();
  readonly selectors = new Map<string, FakeElement>();
  readonly elements = {
    namedItem: (name: string): FakeElement | null => this.fields.get(name) ?? null,
  };

  override querySelector(selector: string): FakeElement | null {
    return this.selectors.get(selector) ?? null;
  }

  reset(): void {}
}

class FakeDialog extends FakeElement {
  open = false;

  close(): void {
    this.open = false;
  }

  showModal(): void {
    this.open = true;
  }
}

function jsonResponse(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function runBoardInitialization(outcome: DashboardOutcome) {
  const initialiseBoard = boardModule.initialiseBoard;
  assert.equal(typeof initialiseBoard, "function", "the real board initializer must be callable in tests");
  if (typeof initialiseBoard !== "function") throw new Error("initialiseBoard unavailable");

  const feed = new FakeElement();
  const boardStatus = new FakeElement();
  const filter = new FakeElement();
  filter.value = "all";
  const more = new FakeButton();
  const noteForm = new FakeForm();
  noteForm.hidden = true;
  const authPrompt = new FakeElement();
  const flagDialog = new FakeDialog();
  const flagForm = new FakeForm();
  const body = new FakeTextArea();
  const images = new FakeInput();
  const characterCount = new FakeElement();
  const fileList = new FakeElement();
  const closeFlag = new FakeButton();
  const noteTurnstile = new FakeElement();
  const noteTurnstileState = new FakeElement();
  const noteSubmit = new FakeButton();
  const flagTurnstile = new FakeElement();
  const flagTurnstileState = new FakeElement();
  const flagSubmit = new FakeButton();

  noteForm.fields.set("body", body);
  noteForm.fields.set("images", images);
  noteForm.selectors.set("[data-note-turnstile]", noteTurnstile);
  noteForm.selectors.set("[data-note-turnstile-state]", noteTurnstileState);
  noteForm.selectors.set('button[type="submit"]', noteSubmit);
  flagForm.selectors.set("[data-flag-turnstile]", flagTurnstile);
  flagForm.selectors.set("[data-flag-turnstile-state]", flagTurnstileState);
  flagForm.selectors.set('button[type="submit"]', flagSubmit);

  const documentElements = new Map<string, FakeElement>([
    ["#board-feed", feed],
    ["#board-status", boardStatus],
    ["#waypoint-filter", filter],
    ["#board-more", more],
    ["#field-note-form", noteForm],
    ["#board-auth-prompt", authPrompt],
    ["#board-flag-dialog", flagDialog],
    ["#board-flag-form", flagForm],
    ["#note-character-count", characterCount],
    ["#note-file-list", fileList],
    ["[data-close-flag]", closeFlag],
  ]);

  const requests: string[] = [];
  let authRequests = 0;
  let turnstileRenders = 0;
  const fetchMock = async (input: string | URL | Request): Promise<Response> => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    requests.push(url);
    if (url === "/api/v1/config") {
      return jsonResponse({ data: { turnstileSiteKey: "test-site-key" } });
    }
    if (url === "/api/v1/me/dashboard") {
      if (outcome === "network-error") throw new Error("dashboard network unavailable");
      return outcome === "ok"
        ? jsonResponse({ data: { profile: { id: "hunter-1" } } })
        : jsonResponse({ error: { message: "Sign in required" } }, 401);
    }
    if (url.startsWith("/api/v1/board?")) {
      return jsonResponse({
        data: {
          items: [{
            id: "note-1",
            waypointId: "wp-01",
            body: "A careful public observation.",
            authorHandle: "Hunter A1B2",
            createdAt: "2026-07-11T18:00:00.000Z",
            media: [],
            replies: [],
          }],
        },
        page: { nextCursor: null },
      });
    }
    throw new Error(`Unexpected request: ${url}`);
  };

  const fakeDocument = {
    querySelector: (selector: string) => documentElements.get(selector) ?? null,
  };
  const fakeWindow = {
    timLostAuth: {
      getToken: async () => {
        authRequests += 1;
        return "test-token";
      },
    },
    turnstile: {
      render: () => {
        turnstileRenders += 1;
        return `widget-${turnstileRenders}`;
      },
      reset: () => {},
    },
    location: { assign: () => {} },
    setTimeout: (callback: () => void) => {
      callback();
      return 0;
    },
  };

  const globals = [
    ["document", fakeDocument],
    ["window", fakeWindow],
    ["fetch", fetchMock],
    ["HTMLButtonElement", FakeButton],
    ["HTMLDialogElement", FakeDialog],
    ["HTMLFormElement", FakeForm],
    ["HTMLInputElement", FakeInput],
    ["HTMLTextAreaElement", FakeTextArea],
  ] as const;
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of globals) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }

  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", onUnhandled);
  let pageError: unknown;
  try {
    await (initialiseBoard as () => Promise<void>)().catch((error: unknown) => {
      pageError = error;
    });
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    process.off("unhandledRejection", onUnhandled);
    for (const [name] of globals) {
      const original = originals.get(name);
      if (original) Object.defineProperty(globalThis, name, original);
      else delete (globalThis as Record<string, unknown>)[name];
    }
  }

  assert.equal(pageError, undefined, "board initialization must not raise a page error");
  assert.deepEqual(unhandled, [], "board initialization must not create an unhandled rejection");
  assert.equal(requests.filter((url) => url === "/api/v1/me/dashboard").length, 1);
  assert.equal(requests.filter((url) => url === "/api/v1/status").length, 0);
  assert.equal(requests.filter((url) => url.startsWith("/api/v1/board?")).length, 1);
  assert.match(feed.innerHTML, /data-note-id="note-1"/);
  assert.equal(feed.attributes.get("aria-busy"), "false");
  assert.equal(boardStatus.textContent, "1 approved note");

  return { authPrompt, authRequests, feed, noteForm, turnstileRenders };
}

test("the real board initializer derives participation only from the dashboard session", async (t) => {
  await t.test("dashboard success enables notes and replies", async () => {
    const fixture = await runBoardInitialization("ok");
    assert.equal(fixture.noteForm.hidden, false);
    assert.equal(fixture.authPrompt.hidden, true);
    assert.match(fixture.feed.innerHTML, /class="reply-form"/);
    assert.equal(fixture.turnstileRenders, 1);
    assert.equal(fixture.authRequests, 2);
  });

  await t.test("dashboard non-OK response fails closed while the public board settles", async () => {
    const fixture = await runBoardInitialization("unauthorized");
    assert.equal(fixture.noteForm.hidden, true);
    assert.equal(fixture.authPrompt.hidden, false);
    assert.doesNotMatch(fixture.feed.innerHTML, /class="reply-form"/);
    assert.equal(fixture.turnstileRenders, 0);
  });

  await t.test("dashboard network failure fails closed while the public board settles", async () => {
    const fixture = await runBoardInitialization("network-error");
    assert.equal(fixture.noteForm.hidden, true);
    assert.equal(fixture.authPrompt.hidden, false);
    assert.doesNotMatch(fixture.feed.innerHTML, /class="reply-form"/);
    assert.equal(fixture.turnstileRenders, 0);
  });
});
