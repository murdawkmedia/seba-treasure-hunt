export const WAYPOINT_COUNT = 13;

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
