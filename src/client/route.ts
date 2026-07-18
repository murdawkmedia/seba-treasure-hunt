import { campaignHunterSession } from "./account";
import { routeOrder, waypointId } from "../shared/waypoints";

type RouteState = "onboarding" | "unlocked";

export interface MemberRouteWaypoint {
  id: number;
  routeOrder: number;
  name: string;
  zoneState: string;
  exactUrl: string | null;
}

export interface MemberRouteProjection {
  state: RouteState;
  waypoints: MemberRouteWaypoint[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function safeExactUrl(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return url.toString();
  } catch {
    return null;
  }
}

export function normalizeMemberRoute(payload: unknown): MemberRouteProjection {
  const data = isRecord(payload) && isRecord(payload.data) ? payload.data : isRecord(payload) ? payload : {};
  const unlocked = data.participationUnlocked === true;
  const rows = Array.isArray(data.waypoints) ? data.waypoints : [];
  const byId = new Map<number, MemberRouteWaypoint>();
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const id = waypointId(row.id);
    const order = routeOrder(row.routeOrder);
    if (id === null || order === null || byId.has(id)) continue;
    byId.set(id, {
      id,
      routeOrder: order,
      name: typeof row.name === "string" && row.name.trim() ? row.name.trim() : `Waypoint ${order}`,
      zoneState: typeof row.zoneState === "string" && row.zoneState.trim() ? row.zoneState.trim() : "unreviewed",
      exactUrl: unlocked ? safeExactUrl(row.exactUrl) : null,
    });
  }
  const waypoints = [...byId.values()].sort(
    (left, right) => left.routeOrder - right.routeOrder || left.id - right.id,
  );
  return { state: unlocked ? "unlocked" : "onboarding", waypoints };
}

export function memberRouteWaypointSelector(id: number): string {
  return `[data-waypoint-id="${id}"]`;
}

function renderWaypointLinks(projection: MemberRouteProjection): void {
  for (const waypoint of projection.waypoints) {
    const section = document.querySelector<HTMLElement>(memberRouteWaypointSelector(waypoint.id));
    const meta = section?.querySelector<HTMLElement>(".stop-meta");
    if (!meta) continue;
    meta.replaceChildren();
    meta.dataset.zone = waypoint.zoneState.replaceAll("_", " ");
    if (waypoint.exactUrl) {
      const link = document.createElement("a");
      link.href = waypoint.exactUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Open approved Google Maps waypoint →";
      meta.appendChild(link);
    } else {
      const copy = document.createElement("span");
      copy.textContent = projection.state === "onboarding"
        ? "Complete your profile and legal registration to unlock this exact map link."
        : "The exact map link is unavailable under the current case or zone state.";
      meta.appendChild(copy);
    }
  }
}

async function initializeMemberRoute(): Promise<void> {
  const signedOut = document.querySelector<HTMLElement>("[data-route-signed-out]");
  const state = document.querySelector<HTMLElement>("[data-route-member-state]");
  if (!signedOut || !state) return;

  const session = await campaignHunterSession();
  if (!session?.coordinator.snapshot().principal) return;
  const token = await session.getToken().catch(() => null);
  if (!token) return;

  signedOut.hidden = true;
  try {
    const response = await fetch("/api/v1/me/dashboard", {
      headers: { Accept: "application/json", Authorization: `Bearer ${token}` },
      credentials: "same-origin",
      cache: "no-store",
      signal: AbortSignal.timeout(10_000),
    });
    const payload: unknown = await response.json().catch(() => null);
    if (!response.ok) throw new Error("Your protected route could not be loaded.");
    const projection = normalizeMemberRoute(payload);
    renderWaypointLinks(projection);
    if (projection.state === "unlocked") {
      state.textContent = "Signed in. All thirteen waypoints are shown; exact links appear only where the case and zone are currently approved as open.";
    } else {
      state.replaceChildren();
      state.append("You are signed in. ");
      const link = document.createElement("a");
      link.href = "/dashboard#profile";
      link.textContent = "Complete registration to unlock exact Google Maps links.";
      state.appendChild(link);
    }
  } catch (error) {
    state.textContent = error instanceof Error ? error.message : "Your protected route could not be loaded.";
  }
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeMemberRoute(), { once: true });
  } else {
    void initializeMemberRoute();
  }
}
