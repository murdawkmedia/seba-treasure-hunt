import {
  TransactionalMailError,
  type TransactionalMailer
} from "./transactional-mail";

export interface TransactionalMailFactoryConfig {
  provider: string | null | undefined;
  graph?: TransactionalMailer | null;
  resend?: TransactionalMailer | null;
}

const unavailableMailer: TransactionalMailer = {
  async send() {
    throw new TransactionalMailError("provider_unavailable");
  }
};

export function createTransactionalMailer(
  config: TransactionalMailFactoryConfig
): TransactionalMailer {
  const provider = config.provider?.trim();
  if (provider === "microsoft_graph") return config.graph ?? unavailableMailer;
  if (provider === "resend") return config.resend ?? unavailableMailer;
  return unavailableMailer;
}
