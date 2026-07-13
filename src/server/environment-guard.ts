import { ApiError } from "./errors";
import type { DeploymentEnvironment, EnvironmentGuard } from "./types";

type EnvironmentRow = { environment: string };

export class D1EnvironmentGuard implements EnvironmentGuard {
  constructor(
    private readonly database: D1Database | null,
    private readonly configuredEnvironment: DeploymentEnvironment | null
  ) {}

  async assertWritable(): Promise<void> {
    if (!this.database || !this.configuredEnvironment) {
      throw new ApiError(
        503,
        "environment_unavailable",
        "Writes are disabled because the deployment environment is not configured."
      );
    }

    let row: EnvironmentRow | null;
    try {
      row = await this.database
        .prepare("SELECT environment FROM environment_metadata WHERE id = 1")
        .first<EnvironmentRow>();
    } catch {
      throw new ApiError(
        503,
        "environment_unavailable",
        "Writes are disabled because the deployment environment could not be verified."
      );
    }

    if (row?.environment !== this.configuredEnvironment) {
      throw new ApiError(
        503,
        "environment_mismatch",
        "Writes are disabled because the deployment environment does not match its data store."
      );
    }
  }
}
