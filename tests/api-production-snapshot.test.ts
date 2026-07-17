import assert from "node:assert/strict";
import test from "node:test";
import { createApi } from "../src/server/app";
import type { Page, ProductionSnapshotStore } from "../src/server/types";
import {
  FakeEnvironment,
  FakeIdentity,
  FakeStore,
  FakeTurnstile,
  FakeUploads,
  responseJson
} from "./api-test-kit";

class FakeProductionSnapshot implements ProductionSnapshotStore {
  calls: string[] = [];

  async summary() {
    this.calls.push("summary");
    return { status: "verified", snapshotId: "snapshot-1" };
  }

  async listReports(): Promise<Page> {
    this.calls.push("listReports");
    return { items: [{ id: "report-1", reporterEmail: "private@example.test" }], nextCursor: null };
  }

  async getReport(id: string) {
    this.calls.push(`getReport:${id}`);
    return id === "report-1" ? { id, reporterPhone: "7805550100" } : null;
  }

  async getReportMedia(reportId: string, mediaId: string) {
    this.calls.push(`getReportMedia:${reportId}:${mediaId}`);
    return reportId === "report-1" && mediaId === "media-1"
      ? { key: "snapshots/snapshot-1/derivatives/report-1.webp", contentType: "image/webp" }
      : null;
  }

  async listPlayers(): Promise<Page> {
    this.calls.push("listPlayers");
    return { items: [{ id: "hunter-1", verifiedEmail: "private@example.test" }], nextCursor: null };
  }

  async listStaff() {
    this.calls.push("listStaff");
    return [{ id: "staff-1", email: "operator@example.test" }];
  }

  async listAudit(): Promise<Page> {
    this.calls.push("listAudit");
    return { items: [{ id: "audit-1", action: "report.created" }], nextCursor: null };
  }

  async getWaiver(subject: string) {
    this.calls.push(`getWaiver:${subject}`);
    return subject === "hunter-1" ? { id: "waiver-1", subject } : null;
  }
}

class FakeSnapshotMedia {
  async read(key: string) {
    if (!key.startsWith("snapshots/")) return null;
    return {
      body: new Blob([new Uint8Array([0x52, 0x49, 0x46, 0x46])]).stream(),
      contentType: "image/webp",
      etag: "snapshot-etag"
    };
  }
}

const makeApp = (includeSnapshot = true) => {
  const store = new FakeStore();
  const snapshot = new FakeProductionSnapshot();
  const app = createApi({
    store,
    identity: new FakeIdentity(),
    turnstile: new FakeTurnstile(),
    uploads: new FakeUploads(),
    environment: new FakeEnvironment(),
    ...(includeSnapshot
      ? {
          productionSnapshot: snapshot,
          productionSnapshotMedia: new FakeSnapshotMedia()
        }
      : {})
  });
  return { app, store, snapshot };
};

const origin = "https://www.timlostsomething.com";
const staffHeaders = { authorization: "Bearer staff-token" };

const routes = [
  "/api/v1/ops/production-snapshot",
  "/api/v1/ops/production-snapshot/reports",
  "/api/v1/ops/production-snapshot/reports/report-1",
  "/api/v1/ops/production-snapshot/players",
  "/api/v1/ops/production-snapshot/players/hunter-1/waiver",
  "/api/v1/ops/production-snapshot/staff",
  "/api/v1/ops/production-snapshot/audit"
];

test("every production snapshot data route requires an active validation Staff session", async () => {
  for (const path of routes) {
    const { app, store } = makeApp();
    assert.equal((await app.request(`${origin}${path}`)).status, 401, path);
    assert.equal(
      (await app.request(`${origin}${path}`, { headers: { authorization: "Bearer hunter-token" } })).status,
      401,
      path
    );
    store.staff.clear();
    assert.equal((await app.request(`${origin}${path}`, { headers: staffHeaders })).status, 403, path);
    store.staff.add("staff-1");
    assert.equal((await app.request(`${origin}${path}`, { headers: staffHeaders })).status, 200, path);
  }
});

test("the snapshot namespace is GET-only and never invokes the repository for mutations", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const { app, snapshot } = makeApp();
    const response = await app.request(`${origin}/api/v1/ops/production-snapshot/reports/report-1`, {
      method,
      headers: staffHeaders
    });
    assert.ok(response.status === 404 || response.status === 405, `${method}: ${response.status}`);
    assert.deepEqual(snapshot.calls, []);
  }
});

test("missing snapshot bindings fail unavailable without falling back to validation data", async () => {
  const { app, store } = makeApp(false);
  store.reports.push({ id: "validation-report" });
  const response = await app.request(`${origin}/api/v1/ops/production-snapshot/reports`, {
    headers: staffHeaders
  });
  assert.equal(response.status, 503);
  assert.equal((await responseJson(response)).error.code, "production_snapshot_unavailable");
});

test("snapshot media is staff-only and returned with private defensive headers", async () => {
  const { app } = makeApp();
  const path = "/api/v1/ops/production-snapshot/reports/report-1/media/media-1";
  assert.equal((await app.request(`${origin}${path}`)).status, 401);

  const response = await app.request(`${origin}${path}`, { headers: staffHeaders });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "private, no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("content-security-policy"), "default-src 'none'; sandbox");
  assert.equal(response.headers.get("cross-origin-resource-policy"), "same-origin");
});
