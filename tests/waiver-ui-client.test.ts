import assert from "node:assert/strict";
import test from "node:test";

import {
  buildWaiverPayload,
  exactAcceptedWaiverDocument,
  parseWaiverAcceptanceProjection,
  performAcceptedWaiverView,
  performWaiverAcceptance,
  performWaiverReview,
  validateWaiverDraft,
  waiverWrite,
  WaiverRequestError,
  type WaiverDraft,
} from "../src/client/dashboard";

const validDraft: WaiverDraft = {
  reviewEventId: "review-1",
  version: "2026.1",
  hash: "a".repeat(64),
  waiverAccepted: true,
  guardianAttested: true,
  minors: [{ fullName: " Sam Hunter ", birthYear: "2014" }],
};

test("waiver draft validates a reviewed document and normalizes covered minors", () => {
  assert.deepEqual(validateWaiverDraft(validDraft), {});
  assert.deepEqual(buildWaiverPayload(validDraft), {
    reviewEventId: "review-1",
    version: "2026.1",
    hash: "a".repeat(64),
    waiverAccepted: true,
    guardianAttested: true,
    minors: [{ fullName: "Sam Hunter", birthYear: 2014 }],
  });
});

test("waiver acceptance stays locked until the current document review is recorded", () => {
  const errors = validateWaiverDraft({
    ...validDraft,
    reviewEventId: "",
    version: "",
    hash: "",
  });
  assert.equal(errors.review, "Open and review the current participation waiver before accepting it.");
});

test("waiver draft requires acceptance and validates minor names and birth years", () => {
  const currentYear = new Date().getFullYear();
  const errors = validateWaiverDraft({
    ...validDraft,
    waiverAccepted: false,
    minors: [
      { fullName: " ", birthYear: "2014" },
      { fullName: "A".repeat(101), birthYear: String(currentYear + 1) },
    ],
  });
  assert.equal(errors.waiverAccepted, "Accept the participation waiver to register.");
  assert.equal(errors.minors, "Enter each minor's full name (1–100 characters) and a valid minor birth year.");
});

test("guardian confirmation is required only when minors are listed", () => {
  assert.equal(
    validateWaiverDraft({ ...validDraft, guardianAttested: false }).guardianAttested,
    "Confirm that you are the parent or legal guardian of every listed minor.",
  );
  assert.deepEqual(
    validateWaiverDraft({ ...validDraft, guardianAttested: false, minors: [] }),
    {},
  );
});

test("one adult can cover no more than ten supervised minors", () => {
  const minors = Array.from({ length: 11 }, (_, index) => ({
    fullName: `Minor ${index + 1}`,
    birthYear: "2014",
  }));
  assert.equal(
    validateWaiverDraft({ ...validDraft, minors }).minors,
    "Add no more than 10 supervised minors.",
  );
});

const acceptedDocument = {
  type: "participation_waiver",
  version: "2026.1",
  hash: "b".repeat(64),
  title: "Approved waiver",
  sections: [],
};

const storedAcceptance = {
  id: "acceptance-1",
  documentVersion: "2026.1",
  documentHash: "b".repeat(64),
  acceptedAt: "2026-07-13T12:00:00.000Z",
  referenceCode: "TLS-W-ONE",
  participants: [],
  receipt: { status: "pending" },
};

test("waiver review reveals fetched legal text before recording and unlocks only after success", async () => {
  const events: string[] = [];
  let enabled = false;
  const result = await performWaiverReview({
    fetchDocument: async () => {
      events.push("fetch");
      return acceptedDocument;
    },
    renderAndReveal: (documentValue) => {
      assert.equal(documentValue, acceptedDocument);
      events.push("render");
    },
    recordReview: async () => {
      events.push("post");
      return "review-2";
    },
    setAcceptanceEnabled: (value) => {
      enabled = value;
      if (value) events.push("enable");
    },
  });

  assert.deepEqual(events, ["fetch", "render", "post", "enable"]);
  assert.equal(enabled, true);
  assert.equal(result.reviewEventId, "review-2");
});

test("failed review recording leaves fetched legal text visible and acceptance locked", async () => {
  let revealed = false;
  let enabled = true;
  await assert.rejects(
    performWaiverReview({
      fetchDocument: async () => acceptedDocument,
      renderAndReveal: () => {
        revealed = true;
      },
      recordReview: async () => {
        throw new Error("review unavailable");
      },
      setAcceptanceEnabled: (value) => {
        enabled = value;
      },
    }),
    /review unavailable/,
  );
  assert.equal(revealed, true);
  assert.equal(enabled, false);
});

test("waiver writes preserve API status and error code for stale recovery", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({
    error: { code: "waiver_document_outdated", message: "Review the new waiver." },
  }), {
    status: 409,
    headers: { "content-type": "application/json" },
  });
  try {
    await assert.rejects(
      waiverWrite(null, "/api/v1/me/waiver/accept", {}),
      (error: unknown) => error instanceof WaiverRequestError &&
        error.status === 409 &&
        error.code === "waiver_document_outdated" &&
        error.message === "Review the new waiver.",
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("stale acceptance resets review state and does not refresh unlocked dashboard", async () => {
  const events: string[] = [];
  const state = {
    activeDocument: acceptedDocument as Record<string, unknown> | null,
    reviewEventId: "review-old",
    idempotencyKey: "accept-old" as string | null,
    acceptanceChecked: true,
    acceptanceDisabled: false,
  };
  await assert.rejects(
    performWaiverAcceptance({
      accept: async () => {
        events.push("accept");
        throw new WaiverRequestError(409, "waiver_document_outdated", "Review the new waiver.");
      },
      loadProjection: async () => {
        events.push("projection");
        return { acceptance: storedAcceptance, document: acceptedDocument };
      },
      fetchDashboard: async () => {
        events.push("dashboard");
        return {};
      },
      renderDashboard: () => events.push("render-dashboard"),
      renderProjection: () => events.push("render-receipt"),
      resetOutdatedState: () => {
        state.activeDocument = null;
        state.reviewEventId = "";
        state.idempotencyKey = null;
        state.acceptanceChecked = false;
        state.acceptanceDisabled = true;
        events.push("reset-stale");
      },
    }),
    /Review the new waiver/,
  );
  assert.deepEqual(events, ["accept", "reset-stale"]);
  assert.deepEqual(state, {
    activeDocument: null,
    reviewEventId: "",
    idempotencyKey: null,
    acceptanceChecked: false,
    acceptanceDisabled: true,
  });

  const newDocument = { ...acceptedDocument, version: "2026.2", hash: "d".repeat(64) };
  const reviewed = await performWaiverReview({
    fetchDocument: async () => {
      events.push("fetch-new");
      return newDocument;
    },
    renderAndReveal: (documentValue) => {
      state.activeDocument = documentValue;
      events.push("render-new");
    },
    recordReview: async (documentValue) => {
      assert.equal(documentValue, newDocument);
      events.push("record-new");
      return "review-new";
    },
    setAcceptanceEnabled: (enabled) => {
      state.acceptanceDisabled = !enabled;
      state.acceptanceChecked = false;
    },
  });
  state.reviewEventId = reviewed.reviewEventId;
  assert.deepEqual(events.slice(-3), ["fetch-new", "render-new", "record-new"]);
  assert.equal(state.activeDocument, newDocument);
  assert.equal(state.reviewEventId, "review-new");
  assert.equal(state.acceptanceDisabled, false);
});

test("stored acceptance refreshes dashboard before restoring receipt projection", async () => {
  const events: string[] = [];
  const projection = { acceptance: storedAcceptance, document: acceptedDocument };
  await performWaiverAcceptance({
    accept: async () => events.push("accept"),
    loadProjection: async () => {
      events.push("projection");
      return projection;
    },
    fetchDashboard: async () => {
      events.push("dashboard");
      return { participationUnlocked: true };
    },
    renderDashboard: (dashboard) => {
      assert.equal(dashboard.participationUnlocked, true);
      events.push("render-dashboard");
    },
    renderProjection: (received) => {
      assert.equal(received, projection);
      events.push("render-receipt");
    },
    resetOutdatedState: () => events.push("reset-stale"),
  });
  assert.deepEqual(events, ["accept", "projection", "dashboard", "render-dashboard", "render-receipt"]);
});

test("accepted waiver view uses the immutable authenticated document with exact version and hash", async () => {
  const projection = parseWaiverAcceptanceProjection({
    data: { acceptance: storedAcceptance, document: acceptedDocument },
  });
  assert.ok(projection);
  assert.equal(exactAcceptedWaiverDocument(projection.acceptance, projection.document), acceptedDocument);

  let rendered: Record<string, unknown> | null = null;
  await performAcceptedWaiverView(acceptedDocument, async (documentValue) => {
    rendered = documentValue;
  });
  assert.equal(rendered, acceptedDocument);

  assert.equal(exactAcceptedWaiverDocument(
    storedAcceptance,
    { ...acceptedDocument, hash: "c".repeat(64) },
  ), null);
  await assert.rejects(
    performAcceptedWaiverView(null, async () => undefined),
    /exact accepted waiver document is unavailable/i,
  );
});
