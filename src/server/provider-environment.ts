import type { DeploymentEnvironment } from "./types";

const developmentKey = /^(?:pk|sk)_(?:test|dev)_/i;

export function providerKeyForEnvironment(
  key: string | null | undefined,
  environment: DeploymentEnvironment | null | undefined
): string | null {
  if (!key || !environment) return null;
  if (environment === "production" && developmentKey.test(key)) return null;
  return key;
}
