import assert from "node:assert/strict";
import test from "node:test";

import { normalizeMemberRoute } from "../src/client/route";
import { stopLabel, stopName } from "../src/shared/waypoints";

const routeWaypoints = Array.from({ length: 13 }, (_, index) => {
  const routeOrder = index + 1;
  const id = routeOrder === 5 ? 13 : routeOrder > 5 ? routeOrder - 1 : routeOrder;
  return {
    id,
    routeOrder,
    name: routeOrder === 5 ? "Derby's Lakeview General Store" : `Waypoint ${routeOrder}`,
    zoneState: "open",
    exactUrl: `https://maps.google.com/?q=${id}`,
  };
});

test("member route normalization exposes only server-approved exact links", () => {
  const unlocked = normalizeMemberRoute({ data: { participationUnlocked: true, waypoints: routeWaypoints.toReversed() } });
  assert.equal(unlocked.state, "unlocked");
  assert.equal(unlocked.waypoints.length, 13);
  assert.deepEqual(unlocked.waypoints.map((waypoint) => waypoint.routeOrder), Array.from({ length: 13 }, (_, index) => index + 1));
  assert.equal(unlocked.waypoints[4]?.id, 13);
  assert.equal(unlocked.waypoints[5]?.id, 5);
  assert.match(unlocked.waypoints[0]?.exactUrl ?? "", /^https:\/\/maps\.google\.com/);

  const incomplete = normalizeMemberRoute({ data: { participationUnlocked: false, waypoints: routeWaypoints } });
  assert.equal(incomplete.state, "onboarding");
  assert.ok(incomplete.waypoints.every((waypoint) => waypoint.exactUrl === null));

  const hostile = normalizeMemberRoute({ data: { participationUnlocked: true, waypoints: [
    { id: 1, routeOrder: 1, name: "Waypoint", zoneState: "open", exactUrl: "javascript:alert(1)" },
    { id: 14, routeOrder: 13, name: "Invalid", zoneState: "open", exactUrl: "https://example.test" },
    { id: true, routeOrder: 2, name: "Boolean ID", zoneState: "open", exactUrl: "https://example.test/boolean" },
    { id: "1e1", routeOrder: 10, name: "Exponent ID", zoneState: "open", exactUrl: "https://example.test/exponent" },
    { id: 2, routeOrder: "02", name: "Leading-zero order", zoneState: "open", exactUrl: "https://example.test/order" },
  ] } });
  assert.equal(hostile.waypoints[0]?.exactUrl, null);
  assert.equal(hostile.waypoints.length, 1);
});

test("route hydration targets the stable waypoint ID instead of the public stop anchor", async () => {
  const routeModule = await import("../src/client/route") as Record<string, unknown>;
  assert.equal(typeof routeModule.memberRouteWaypointSelector, "function");
  if (typeof routeModule.memberRouteWaypointSelector !== "function") return;
  assert.equal(routeModule.memberRouteWaypointSelector(13), '[data-waypoint-id="13"]');
});

test("signed-out route data cannot carry exact links into public placeholders", () => {
  const projection = normalizeMemberRoute({
    data: {
      participationUnlocked: false,
      waypoints: routeWaypoints,
    },
  });

  assert.equal(projection.state, "onboarding");
  assert.equal(projection.waypoints.length, 13);
  assert.ok(projection.waypoints.every((waypoint) => waypoint.exactUrl === null));
});

test("Lucky 13 labels stay concise while stable waypoint IDs remain separate", () => {
  assert.equal(stopName(4, "Seba Beach Seniors Centre"), "Seniors Centre");
  assert.equal(stopName(5, "Derby's Lakeview General Store"), "Derby's General Store");
  assert.equal(stopLabel(11, "The Driving Range & the Digger Café"), "Stop 11 · Driving Range / Digger Café");
  assert.equal(stopLabel(13, "Old Seba Beach School — SebaHub"), "Stop 13 · Old Seba Beach School / SebaHub");
});
