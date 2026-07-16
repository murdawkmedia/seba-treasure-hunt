import { loadAndRenderStatus, type CaseStatus } from "./status";

type ZoneState = "open" | "restricted" | "hazardous" | "temporarily_closed" | "unreviewed";

interface PublicWaypoint {
  id: string;
  name: string;
  description: string;
  zoneState: ZoneState;
}

interface PublicZone {
  id: string;
  label: string;
  instruction: string;
  state: Exclude<ZoneState, "unreviewed">;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function normalizeWaypoints(value: unknown): PublicWaypoint[] {
  if (!isRecord(value)) return [];
  const source = Array.isArray(value.data)
    ? value.data
    : isRecord(value.data) && Array.isArray(value.data.items)
      ? value.data.items
      : [];
  const allowed = new Set<ZoneState>([
    "open",
    "restricted",
    "hazardous",
    "temporarily_closed",
    "unreviewed",
  ]);
  return source.flatMap((item): PublicWaypoint[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.name !== "string" ||
      typeof item.description !== "string" ||
      typeof item.zoneState !== "string" ||
      !allowed.has(item.zoneState as ZoneState)
    ) {
      return [];
    }
    return [
      {
        id: item.id,
        name: item.name,
        description: item.description,
        zoneState: item.zoneState as ZoneState,
      },
    ];
  });
}

function normalizeZones(value: unknown): PublicZone[] {
  if (!isRecord(value) || !Array.isArray(value.data)) return [];
  const allowed = new Set<PublicZone["state"]>([
    "open",
    "restricted",
    "hazardous",
    "temporarily_closed",
  ]);
  return value.data.flatMap((item): PublicZone[] => {
    if (
      !isRecord(item) ||
      typeof item.id !== "string" ||
      typeof item.label !== "string" ||
      typeof item.instruction !== "string" ||
      typeof item.state !== "string" ||
      !allowed.has(item.state as PublicZone["state"])
    ) {
      return [];
    }
    return [{
      id: item.id,
      label: item.label,
      instruction: item.instruction,
      state: item.state as PublicZone["state"],
    }];
  });
}

const zoneLabels: Record<ZoneState, string> = {
  open: "◆ Open",
  restricted: "╳ Restricted",
  hazardous: "▲ Hazardous",
  temporarily_closed: "■ Temporarily closed",
  unreviewed: "? Not yet reviewed",
};

function applyStatusGate(status: CaseStatus): void {
  const entry = document.querySelector<HTMLAnchorElement>("[data-exact-entry]");
  if (!entry) return;
  const usable = status.state === "open";
  entry.setAttribute("aria-disabled", usable ? "false" : "true");
  entry.title = usable
    ? "Open the signed-in Hunter Dashboard"
    : "Dashboard remains available, but exact directions are locked by the current case status.";
}

async function renderWaypoints(): Promise<void> {
  const list = document.querySelector<HTMLOListElement>("[data-start-waypoints]");
  const state = document.querySelector<HTMLElement>("[data-start-waypoints-state]");
  if (!list || !state) return;

  try {
    const response = await fetch("/api/v1/waypoints", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("waypoints unavailable");
    const waypoints = normalizeWaypoints(await response.json());
    if (waypoints.length === 0) throw new Error("waypoints unavailable");

    const fragment = document.createDocumentFragment();
    for (const waypoint of waypoints) {
      const item = document.createElement("li");
      const copy = document.createElement("div");
      const heading = document.createElement("h3");
      const description = document.createElement("p");
      const zone = document.createElement("span");
      heading.textContent = waypoint.name;
      description.textContent = waypoint.description;
      zone.className = "zone-state";
      zone.dataset.zone = waypoint.zoneState;
      zone.textContent = zoneLabels[waypoint.zoneState];
      copy.appendChild(heading);
      copy.appendChild(description);
      item.appendChild(copy);
      item.appendChild(zone);
      fragment.appendChild(item);
    }
    list.replaceChildren(fragment);
    state.textContent = `${waypoints.length} public waypoint access states retrieved.`;
  } catch {
    list.replaceChildren();
    state.className = "system-message";
    state.dataset.kind = "error";
    state.textContent =
      "Live waypoint access states are unavailable. Do not enter an area unless the current route clearly marks it open.";
  }
}

async function renderZones(): Promise<void> {
  const list = document.querySelector<HTMLUListElement>("[data-start-zones]");
  const state = document.querySelector<HTMLElement>("[data-start-zones-state]");
  if (!list || !state) return;

  try {
    const response = await fetch("/api/v1/zones", {
      headers: { Accept: "application/json" },
      cache: "no-store",
      credentials: "same-origin",
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error("zones unavailable");
    const zones = normalizeZones(await response.json());
    if (zones.length === 0) throw new Error("zones unavailable");

    const fragment = document.createDocumentFragment();
    for (const zone of zones) {
      const item = document.createElement("li");
      const copy = document.createElement("div");
      const heading = document.createElement("h3");
      const instruction = document.createElement("p");
      const badge = document.createElement("span");
      heading.textContent = zone.label;
      instruction.textContent = zone.instruction;
      badge.className = "zone-state";
      badge.dataset.zone = zone.state;
      badge.textContent = zoneLabels[zone.state];
      copy.appendChild(heading);
      copy.appendChild(instruction);
      item.appendChild(copy);
      item.appendChild(badge);
      fragment.appendChild(item);
    }
    list.replaceChildren(fragment);
    state.textContent = `${zones.length} current area label${zones.length === 1 ? "" : "s"} retrieved.`;
  } catch {
    list.replaceChildren();
    state.className = "system-message";
    state.dataset.kind = "error";
    state.textContent =
      "Current area labels are unavailable. Do not enter an area unless an official update clearly marks it open.";
  }
}

async function initializeStart(): Promise<void> {
  const status = await loadAndRenderStatus();
  applyStatusGate(status);
  await Promise.all([renderWaypoints(), renderZones()]);
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => void initializeStart(), { once: true });
  } else {
    void initializeStart();
  }
}
