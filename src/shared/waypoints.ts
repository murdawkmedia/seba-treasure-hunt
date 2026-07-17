export const WAYPOINT_COUNT = 13;

const STOP_NAMES = [
  "Creek Property",
  "Public Beach / Market Lot",
  "Randy's Beach",
  "Seniors Centre",
  "Derby's General Store",
  "Gated Road / School Grounds",
  "Back Trails",
  "Lodge Trails",
  "Vista Lands",
  "Cliff-Edge Slope",
  "Driving Range / Digger Café",
  "Kokanee Springs Front Gate",
  "Old Seba Beach School / SebaHub",
] as const;

function canonicalWaypointNumber(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isInteger(value) && value >= 1 && value <= WAYPOINT_COUNT ? value : null;
  }
  if (typeof value !== "string") return null;
  const canonical = value.trim();
  if (!/^(?:[1-9]|1[0-3])$/.test(canonical)) return null;
  return Number(canonical);
}

export function waypointId(value: unknown): number | null {
  return canonicalWaypointNumber(value);
}

export function routeOrder(value: unknown): number | null {
  return canonicalWaypointNumber(value);
}

export function stopName(order: unknown, fallback: string): string {
  const canonical = routeOrder(order);
  return canonical === null ? fallback.trim() : (STOP_NAMES[canonical - 1] ?? fallback.trim());
}

export function stopLabel(order: unknown, fallback: string): string {
  const canonical = routeOrder(order);
  if (canonical === null) return fallback.trim();
  return `Stop ${String(canonical).padStart(2, "0")} · ${stopName(canonical, fallback)}`;
}
