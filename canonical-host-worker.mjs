const BARE_HOST = "timlostsomething.com";
const CANONICAL_HOST = "www.timlostsomething.com";

export default {
  fetch(request, env) {
    const url = new URL(request.url);

    if (url.hostname === BARE_HOST) {
      url.protocol = "https:";
      url.hostname = CANONICAL_HOST;
      url.port = "";
      return Response.redirect(url.toString(), 301);
    }

    return env.ASSETS.fetch(request);
  },
};
