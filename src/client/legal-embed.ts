const SIGNUP_EMBED = "signup";
const LEGAL_EMBED_READY = "tim-lost:legal-embed-ready";

function initializeSignupLegalEmbed(): void {
  const url = new URL(window.location.href);
  if (url.searchParams.get("embed") !== SIGNUP_EMBED) return;

  document.documentElement.dataset.legalEmbed = SIGNUP_EMBED;
  document.documentElement.classList.add("legal-embed--signup");
  document.body.dataset.legalEmbed = SIGNUP_EMBED;

  window.parent.postMessage(
    {
      type: LEGAL_EMBED_READY,
      embed: SIGNUP_EMBED,
      route: document.body.dataset.campaignRoute ?? "",
    },
    window.location.origin,
  );
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  initializeSignupLegalEmbed();
}

export {};
