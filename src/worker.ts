import { createApi } from "./server/app";
import { ManagedIdentityVerifier } from "./server/auth";
import { D1DataStore } from "./server/d1-store";
import { ApiError } from "./server/errors";
import { TurnstileVerifier } from "./server/turnstile";
import { ManagedStaffAccounts } from "./server/staff-accounts";
import { ClerkWebhookVerifier } from "./server/clerk-webhooks";
import { ManagedPlayerAccounts } from "./server/player-accounts";
import type { DataStore, PagesEnv } from "./server/types";
import { R2UploadStorage } from "./server/uploads";
import { KvRateLimiter } from "./server/rate-limit";
import { D1EnvironmentGuard } from "./server/environment-guard";
import { providerKeyForEnvironment } from "./server/provider-environment";

const canonicalOrigin = "https://www.timlostsomething.com";
const defaultTurnstileHosts = ["www.timlostsomething.com", "seba-treasure-hunt.pages.dev"];

const unavailableStore = new Proxy(
  {},
  {
    get() {
      return async () => {
        throw new ApiError(503, "service_unavailable", "The application data service is unavailable.");
      };
    }
  }
) as DataStore;

let cache:
  | {
      db: D1Database | undefined;
      bucket: R2Bucket | undefined;
      queue: PagesEnv["MEDIA_QUEUE"];
      rateLimits: KVNamespace | undefined;
      signature: string;
      app: ReturnType<typeof createApi>;
    }
  | undefined;

const application = (env: PagesEnv) => {
  const signature = JSON.stringify([
    env.TURNSTILE_SECRET_KEY ?? null,
    env.TURNSTILE_SITE_KEY ?? null,
    env.TURNSTILE_ALLOWED_HOSTS ?? null,
    env.HUNTER_AUTH_ISSUER ?? null,
    env.HUNTER_AUTH_JWKS_URL ?? null,
    env.HUNTER_CLERK_PUBLISHABLE_KEY ?? null,
    env.HUNTER_CLERK_SECRET_KEY ?? null,
    env.CLERK_WEBHOOK_SIGNING_SECRET ?? null,
    env.HUNTER_ACCOUNT_PORTAL_URL ?? null,
    env.STAFF_CLERK_PUBLISHABLE_KEY ?? null,
    env.STAFF_CLERK_SECRET_KEY ?? null,
    env.STAFF_ACCOUNT_PORTAL_URL ?? null,
    env.STAFF_INVITATION_REDIRECT_URL ?? null,
    env.STAFF_AUTH_ISSUER ?? null,
    env.STAFF_AUTH_JWKS_URL ?? null,
    env.AUTHORIZED_PARTY ?? null,
    env.RESEND_API_KEY ?? null,
    env.RECOVERY_EMAIL_FROM ?? null,
    env.RATE_LIMIT_SALT ?? null,
    env.DEPLOYMENT_ENV ?? null
  ]);
  if (
    cache &&
    cache.db === env.DB &&
    cache.bucket === env.UPLOADS &&
    cache.queue === env.MEDIA_QUEUE &&
    cache.rateLimits === env.RATE_LIMITS &&
    cache.signature === signature
  ) {
    return cache.app;
  }

  const allowedHosts = (env.TURNSTILE_ALLOWED_HOSTS ?? defaultTurnstileHosts.join(","))
    .split(",")
    .map((host) => host.trim())
    .filter(Boolean);
  const hunterPublishableKey = providerKeyForEnvironment(
    env.HUNTER_CLERK_PUBLISHABLE_KEY,
    env.DEPLOYMENT_ENV
  );
  const hunterSecretKey = providerKeyForEnvironment(
    env.HUNTER_CLERK_SECRET_KEY,
    env.DEPLOYMENT_ENV
  );
  const staffPublishableKey = providerKeyForEnvironment(
    env.STAFF_CLERK_PUBLISHABLE_KEY,
    env.DEPLOYMENT_ENV
  );
  const staffSecretKey = providerKeyForEnvironment(
    env.STAFF_CLERK_SECRET_KEY,
    env.DEPLOYMENT_ENV
  );
  const app = createApi({
    store: env.DB ? new D1DataStore(env.DB) : unavailableStore,
    identity: new ManagedIdentityVerifier({
      hunterIssuer: env.HUNTER_AUTH_ISSUER ?? null,
      hunterJwksUrl: env.HUNTER_AUTH_JWKS_URL ?? null,
      staffIssuer: env.STAFF_AUTH_ISSUER ?? null,
      staffJwksUrl: env.STAFF_AUTH_JWKS_URL ?? null,
      authorizedParty: env.AUTHORIZED_PARTY ?? canonicalOrigin
    }),
    turnstile: new TurnstileVerifier(env.TURNSTILE_SECRET_KEY ?? null, allowedHosts),
    uploads: new R2UploadStorage(env.UPLOADS ?? null, env.MEDIA_QUEUE ?? null),
    rateLimits: new KvRateLimiter(env.RATE_LIMITS ?? null, env.RATE_LIMIT_SALT ?? null),
    environment: new D1EnvironmentGuard(env.DB ?? null, env.DEPLOYMENT_ENV ?? null),
    webhooks: new ClerkWebhookVerifier(env.CLERK_WEBHOOK_SIGNING_SECRET ?? null),
    playerAccounts: new ManagedPlayerAccounts(hunterSecretKey, {
      dashboardUrl: `${canonicalOrigin}/dashboard`,
      resendApiKey: env.RESEND_API_KEY ?? null,
      recoveryEmailFrom: env.RECOVERY_EMAIL_FROM ?? null
    }),
    staffAccounts: new ManagedStaffAccounts(staffSecretKey, {
      accountPortalUrl: env.STAFF_ACCOUNT_PORTAL_URL ?? null,
      invitationRedirectUrl: env.STAFF_INVITATION_REDIRECT_URL ?? null,
      resendApiKey: env.RESEND_API_KEY ?? null,
      recoveryEmailFrom: env.RECOVERY_EMAIL_FROM ?? null
    }),
    config: {
      deploymentEnvironment: env.DEPLOYMENT_ENV ?? null,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      hunterPublishableKey,
      hunterAccountPortalUrl: env.HUNTER_ACCOUNT_PORTAL_URL ?? null,
      staffPublishableKey,
      staffAccountPortalUrl: env.STAFF_ACCOUNT_PORTAL_URL ?? null
    }
  });
  cache = {
    db: env.DB,
    bucket: env.UPLOADS,
    queue: env.MEDIA_QUEUE,
    rateLimits: env.RATE_LIMITS,
    signature,
    app
  };
  return app;
};

export default {
  fetch(request: Request, env: PagesEnv, context: ExecutionContext) {
    return application(env).fetch(request, env, context);
  }
} satisfies ExportedHandler<PagesEnv>;
