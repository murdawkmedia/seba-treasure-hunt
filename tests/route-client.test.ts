import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMemberRoute } from "../src/client/route";

test("member route normalization exposes only server-approved exact links", () => {
  const waypoints = Array.from({ length: 12 }, (_, index) => ({
    id: index + 1,
    name: `Waypoint ${index + 1}`,
    zoneState: "open",
    exactUrl: `https://maps.google.com/?q=${index + 1}`,
  }));
  const unlocked = normalizeMemberRoute({ data: { participationUnlocked: true, waypoints } });
  assert.equal(unlocked.state, "unlocked");
  assert.equal(unlocked.waypoints.length, 12);
  assert.match(unlocked.waypoints[0]?.exactUrl ?? "", /^https:\/\/maps\.google\.com/);

  const incomplete = normalizeMemberRoute({ data: { participationUnlocked: false, waypoints } });
  assert.equal(incomplete.state, "onboarding");
  assert.ok(incomplete.waypoints.every((waypoint) => waypoint.exactUrl === null));

  const hostile = normalizeMemberRoute({ data: { participationUnlocked: true, waypoints: [
    { id: 1, name: "Waypoint", zoneState: "open", exactUrl: "javascript:alert(1)" },
  ] } });
  assert.equal(hostile.waypoints[0]?.exactUrl, null);
});
