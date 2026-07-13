const BARE_HOST = "timlostsomething.com";
const CANONICAL_HOST = "www.timlostsomething.com";
const REMOVED_PARTNER_LOGO = `/assets/${String.fromCharCode(67, 70, 67, 87).toLowerCase()}-logo.png`;
const NON_PUBLIC_PREFIXES = ["/docs", "/tests", "/scripts"];

function isNonPublicPath(pathname) {
  const normalized = pathname.toLowerCase();
  if (normalized === REMOVED_PARTNER_LOGO) return true;
  return NON_PUBLIC_PREFIXES.some(
    (prefix) => normalized === prefix || normalized.startsWith(`${prefix}/`),
  );
}

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === BARE_HOST) {
      url.protocol = "https:";
      url.hostname = CANONICAL_HOST;
      url.port = "";
      return Response.redirect(url.toString(), 301);
    }

    if (isNonPublicPath(url.pathname)) {
      return new Response("Not found", {
        status: 404,
        headers: {
          "cache-control": "no-store",
          "content-type": "text/plain; charset=utf-8",
          "x-content-type-options": "nosniff",
        },
      });
    }

    return env.ASSETS.fetch(request);
  },
};
