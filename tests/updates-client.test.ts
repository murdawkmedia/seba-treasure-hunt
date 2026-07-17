import assert from "node:assert/strict";
import test from "node:test";

import { googleMapsUrl, normalizeUpdates } from "../src/client/updates";

const publishedAt = "2026-07-15T21:00:00.000Z";

test("normalizes ordinary official updates without report-only fields", () => {
  const page = normalizeUpdates({
    data: [{
      id: "ordinary-1",
      title: "Clue window changed",
      body: "The next clue arrives at noon.",
      publishedAt,
      publisherName: "A representative from SebaHub",
    }],
    page: { nextCursor: "cursor-2" },
  });

  assert.deepEqual(page, {
    items: [{
      id: "ordinary-1",
      kind: "official",
      title: "Clue window changed",
      body: "The next clue arrives at noon.",
      publishedAt,
      publisherName: "A representative from SebaHub",
    }],
    nextCursor: "cursor-2",
  });
});

test("does not infer an ordinary update publisher from contact data", () => {
  const page = normalizeUpdates({ data: [{
    id: "ordinary-contact-only",
    title: "Clue window changed",
    body: "The next clue arrives at noon.",
    publishedAt,
    email: "operator@example.test",
    contactName: "Private Operator",
  }] });
  assert.deepEqual(page.items, []);
});

test("normalizes the public allowlist for an approved report", () => {
  const page = normalizeUpdates({ data: [{
    id: "update-1",
    kind: "approved_report",
    title: "Creek clue",
    body: "Public story",
    publishedAt,
    publisherName: "Young Hunter",
    waypointId: 1,
    waypointRouteOrder: 1,
    waypointName: "The Creek Property",
    latitude: 53.123,
    longitude: -114.456,
    email: "must-not-leak@example.test",
    exactUrl: "https://maps.google.com/?q=private-waypoint",
    phone: "780-555-0101",
    sourceReportId: "private-report-id",
    media: [
      { id: "media-1", url: "/api/v1/media/media-1", contentType: "image/webp", alt: "Weathered bill", caption: "Near Stop 11" },
      { id: "media-2", url: "https://evil.example/media-2", contentType: "image/webp" },
      { id: "media-3", url: "/api/v1/media/media-3", contentType: "text/html" },
    ],
  }] });

  assert.deepEqual(page.items, [{
    id: "update-1",
    kind: "approved_report",
    title: "Creek clue",
    body: "Public story",
    publishedAt,
    publisherName: "Young Hunter",
    waypointId: 1,
    waypointRouteOrder: 1,
    waypointName: "The Creek Property",
    latitude: 53.123,
    longitude: -114.456,
    media: [{ id: "media-1", url: "/api/v1/media/media-1", contentType: "image/webp", alt: "Weathered bill", caption: "Near Stop 11" }],
  }]);
  assert.doesNotMatch(JSON.stringify(page.items), /must-not-leak|780-555|private-report-id|evil\.example|text\/html/);
});

test("drops malformed records and removes invalid report metadata", () => {
  const page = normalizeUpdates({ data: [
    { id: "", title: "Missing id", body: "Body", publishedAt, publisherName: "Ops" },
    { id: "<script>", title: "Unsafe id", body: "Body", publishedAt, publisherName: "Ops" },
    { id: "bad-time", title: "Bad time", body: "Body", publishedAt: "yesterday", publisherName: "Ops" },
    {
      id: "safe-update",
      kind: "approved_report",
      title: "Safe report",
      body: "Edited story",
      publishedAt,
      publisherName: "Community Hunter",
      waypointId: 99,
      latitude: Number.POSITIVE_INFINITY,
      longitude: -114.456,
      media: [
        { id: "../private", url: "/api/v1/media/../private", contentType: "image/jpeg" },
        { id: "media-query", url: "/api/v1/media/media-query?download=1", contentType: "image/png" },
      ],
    },
  ] });

  assert.deepEqual(page.items, [{
    id: "safe-update",
    kind: "approved_report",
    title: "Safe report",
    body: "Edited story",
    publishedAt,
    publisherName: "Community Hunter",
    waypointId: null,
    waypointRouteOrder: null,
    waypointName: null,
    latitude: null,
    longitude: null,
    media: [],
  }]);
});

test("approved reports preserve stable ID 13 and display Derby as public Waypoint 5", () => {
  const page = normalizeUpdates({ data: [{
    id: "update-derby",
    kind: "approved_report",
    title: "Derby's clue",
    body: "Edited public story",
    publishedAt,
    publisherName: "Young Hunter",
    waypointId: 13,
    waypointRouteOrder: 5,
    waypointName: "Derby's Lakeview General Store",
    latitude: null,
    longitude: null,
    media: [],
    email: "must-not-leak@example.test",
  }] });

  assert.equal(page.items[0]?.kind, "approved_report");
  if (page.items[0]?.kind !== "approved_report") return;
  assert.equal(page.items[0].waypointId, 13);
  assert.equal(page.items[0].waypointRouteOrder, 5);
  assert.equal(page.items[0].waypointName, "Derby's Lakeview General Store");
  assert.doesNotMatch(JSON.stringify(page.items), /must-not-leak|private-waypoint/);
});

test("approved report waypoint labels use public order and published names", async () => {
  const updatesModule = await import("../src/client/updates") as Record<string, unknown>;
  assert.equal(typeof updatesModule.approvedReportWaypointLabel, "function");
  if (typeof updatesModule.approvedReportWaypointLabel !== "function") return;
  assert.equal(
    updatesModule.approvedReportWaypointLabel({
      waypointRouteOrder: 5,
      waypointName: "Derby's Lakeview General Store",
    }),
    "Waypoint 5 — Derby's Lakeview General Store",
  );
  assert.equal(
    updatesModule.approvedReportWaypointLabel({ waypointRouteOrder: null, waypointName: null }),
    null,
  );
});

test("approved reports tolerate unpublished waypoint metadata without inferring public order", () => {
  const page = normalizeUpdates({ data: [{
    id: "update-hidden-waypoint",
    kind: "approved_report",
    title: "Safe story",
    body: "Public body",
    publishedAt,
    publisherName: "Young Hunter",
    waypointId: 5,
    waypointRouteOrder: null,
    waypointName: null,
    latitude: null,
    longitude: null,
    media: [],
  }] });
  assert.equal(page.items.length, 1);
  assert.deepEqual(page.items[0], {
    id: "update-hidden-waypoint",
    kind: "approved_report",
    title: "Safe story",
    body: "Public body",
    publishedAt,
    publisherName: "Young Hunter",
    waypointId: 5,
    waypointRouteOrder: null,
    waypointName: null,
    latitude: null,
    longitude: null,
    media: [],
  });
});

test("constructs an HTTPS Google Maps URL only for valid coordinate pairs", () => {
  const url = googleMapsUrl(53.123, -114.456);
  assert.ok(url);
  const parsed = new URL(url);
  assert.equal(parsed.protocol, "https:");
  assert.equal(parsed.hostname, "www.google.com");
  assert.equal(parsed.searchParams.get("api"), "1");
  assert.equal(parsed.searchParams.get("query"), "53.123,-114.456");

  assert.equal(googleMapsUrl(Number.NaN, -114.456), null);
  assert.equal(googleMapsUrl(91, -114.456), null);
  assert.equal(googleMapsUrl(53.123, -181), null);
});
