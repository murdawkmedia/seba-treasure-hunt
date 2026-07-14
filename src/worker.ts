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
import { D1RateLimiter } from "./server/rate-limit";
import { D1EnvironmentGuard } from "./server/environment-guard";
import { providerKeyForEnvironment, publicUrlForEnvironment } from "./server/provider-environment";
import { ManagedWaiverReceipts } from "./server/waiver-receipts";
import { D1GraphTokenStore } from "./server/graph-token-store";
import { MicrosoftGraphTransactionalMailer } from "./server/microsoft-graph-mailer";
import { ResendTransactionalMailer } from "./server/resend-mailer";
import { createTransactionalMailer } from "./server/transactional-mail-factory";
import type { TransactionalMailer, TransactionalMessage } from "./server/transactional-mail";

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
      signature: string;
      app: ReturnType<typeof createApi>;
    }
  | undefined;

export interface TransactionalMailRuntime {
  mailer: TransactionalMailer;
  sender: TransactionalMessage["from"];
  replyTo: string | null;
}

export function transactionalMailRuntimeForEnvironment(
  env: Partial<PagesEnv>,
  fetchImpl: typeof globalThis.fetch = fetch
): TransactionalMailRuntime {
  const graphTokenStore = new D1GraphTokenStore(
    env.DB ?? null,
    env.GRAPH_TOKEN_ENCRYPTION_KEY ?? null,
    env.GRAPH_TOKEN_KEY_VERSION ?? null
  );
  const graphMailer = new MicrosoftGraphTransactionalMailer({
    fetch: fetchImpl,
    clientId: env.GRAPH_CLIENT_ID ?? null,
    tenantId: env.GRAPH_TENANT_ID ?? null,
    bootstrapRefreshToken: env.GRAPH_REFRESH_TOKEN_BOOTSTRAP ?? null,
    tokenStore: graphTokenStore
  });
  const resendMailer = new ResendTransactionalMailer({
    fetch: fetchImpl,
    apiKey: env.RESEND_API_KEY ?? null
  });
  const transactionalMailer = createTransactionalMailer({
    provider: env.TRANSACTIONAL_EMAIL_PROVIDER ?? null,
    graph: graphMailer,
    resend: resendMailer
  });

  return {
    mailer: transactionalMailer,
    sender: {
      name: env.TRANSACTIONAL_EMAIL_FROM_NAME?.trim() ?? "",
      address: env.TRANSACTIONAL_EMAIL_FROM_ADDRESS?.trim() ?? ""
    },
    replyTo: env.TRANSACTIONAL_EMAIL_REPLY_TO?.trim() || null
  };
}

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
    env.TRANSACTIONAL_EMAIL_PROVIDER ?? null,
    env.GRAPH_CLIENT_ID ?? null,
    env.GRAPH_TENANT_ID ?? null,
    env.GRAPH_REFRESH_TOKEN_BOOTSTRAP ?? null,
    env.GRAPH_TOKEN_ENCRYPTION_KEY ?? null,
    env.GRAPH_TOKEN_KEY_VERSION ?? null,
    env.TRANSACTIONAL_EMAIL_FROM_ADDRESS ?? null,
    env.TRANSACTIONAL_EMAIL_FROM_NAME ?? null,
    env.TRANSACTIONAL_EMAIL_REPLY_TO ?? null,
    env.RESEND_API_KEY ?? null,
    env.RECOVERY_EMAIL_FROM ?? null,
    env.LEGAL_RECEIPT_EMAIL_FROM ?? null,
    env.LEGAL_RECEIPT_EMAIL_REPLY_TO ?? null,
    env.CAMPAIGN_BASE_URL ?? null,
    env.RATE_LIMIT_SALT ?? null,
    env.DEPLOYMENT_ENV ?? null
  ]);
  if (
    cache &&
    cache.db === env.DB &&
    cache.bucket === env.UPLOADS &&
    cache.queue === env.MEDIA_QUEUE &&
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
  const campaignBaseUrl = publicUrlForEnvironment(env.CAMPAIGN_BASE_URL, env.DEPLOYMENT_ENV);
  const hunterAccountPortalUrl = publicUrlForEnvironment(
    env.HUNTER_ACCOUNT_PORTAL_URL,
    env.DEPLOYMENT_ENV
  );
  const staffAccountPortalUrl = publicUrlForEnvironment(
    env.STAFF_ACCOUNT_PORTAL_URL,
    env.DEPLOYMENT_ENV
  );
  const staffInvitationRedirectUrl = publicUrlForEnvironment(
    env.STAFF_INVITATION_REDIRECT_URL,
    env.DEPLOYMENT_ENV
  );
  const store = env.DB ? new D1DataStore(env.DB) : unavailableStore;
  const {
    mailer: transactionalMailer,
    sender: transactionalSender,
    replyTo: transactionalReplyTo
  } = transactionalMailRuntimeForEnvironment(env);
  const app = createApi({
    store,
    identity: new ManagedIdentityVerifier({
      hunterIssuer: env.HUNTER_AUTH_ISSUER ?? null,
      hunterJwksUrl: env.HUNTER_AUTH_JWKS_URL ?? null,
      staffIssuer: env.STAFF_AUTH_ISSUER ?? null,
      staffJwksUrl: env.STAFF_AUTH_JWKS_URL ?? null,
      authorizedParty: env.AUTHORIZED_PARTY ?? canonicalOrigin
    }),
    turnstile: new TurnstileVerifier(env.TURNSTILE_SECRET_KEY ?? null, allowedHosts),
    uploads: new R2UploadStorage(env.UPLOADS ?? null, env.MEDIA_QUEUE ?? null),
    rateLimits: new D1RateLimiter(env.DB ?? null, env.RATE_LIMIT_SALT ?? null),
    environment: new D1EnvironmentGuard(env.DB ?? null, env.DEPLOYMENT_ENV ?? null),
    webhooks: new ClerkWebhookVerifier(env.CLERK_WEBHOOK_SIGNING_SECRET ?? null),
    playerAccounts: new ManagedPlayerAccounts(hunterSecretKey, {
      dashboardUrl: hunterAccountPortalUrl,
      mailer: transactionalMailer,
      sender: transactionalSender,
      recoveryEmailReplyTo: transactionalReplyTo
    }),
    staffAccounts: new ManagedStaffAccounts(staffSecretKey, {
      accountPortalUrl: staffAccountPortalUrl,
      invitationRedirectUrl: staffInvitationRedirectUrl,
      mailer: transactionalMailer,
      sender: transactionalSender,
      recoveryEmailReplyTo: transactionalReplyTo
    }),
    waiverReceipts: new ManagedWaiverReceipts(store, {
      mailer: transactionalMailer,
      sender: transactionalSender,
      replyTo: transactionalReplyTo,
      canonicalOrigin: campaignBaseUrl
    }),
    config: {
      deploymentEnvironment: env.DEPLOYMENT_ENV ?? null,
      turnstileSiteKey: env.TURNSTILE_SITE_KEY ?? null,
      hunterPublishableKey,
      hunterAccountPortalUrl,
      staffPublishableKey,
      staffAccountPortalUrl
    }
  });
  cache = {
    db: env.DB,
    bucket: env.UPLOADS,
    queue: env.MEDIA_QUEUE,
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
