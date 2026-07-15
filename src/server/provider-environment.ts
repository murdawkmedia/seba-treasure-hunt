import type { DeploymentEnvironment } from "./types";

const developmentKey = /^(?:pk|sk)_(?:test|dev)_/i;
const liveKey = /^(?:pk|sk)_live_/i;
const productionHost = "www.timlostsomething.com";
const validationHost = "codex-validation.seba-treasure-hunt.pages.dev";

export function providerKeyForEnvironment(
  key: string | null | undefined,
  environment: DeploymentEnvironment | null | undefined
): string | null {
  if (!key || !environment || !["production", "validation"].includes(environment)) return null;
  const normalizedKey = key.trim();
  if (environment === "production") return liveKey.test(normalizedKey) ? normalizedKey : null;
  return developmentKey.test(normalizedKey) ? normalizedKey : null;
}

export function publicUrlForEnvironment(
  value: string | null | undefined,
  environment: DeploymentEnvironment | null | undefined
): string | null {
  if (!value || !environment || !["production", "validation"].includes(environment)) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    return null;
  }

  const isProduction = url.hostname === productionHost;
  const isValidation = url.hostname === validationHost;
  if (
    (environment === "production" && !isProduction) ||
    (environment === "validation" && !isValidation)
  ) {
    return null;
  }

  const path = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path}`;
}
