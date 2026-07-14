import assert from "node:assert/strict";
import test from "node:test";

import {
  CAMPAIGN_MENU,
  CAMPAIGN_PAGES,
  renderCampaignPage,
} from "../scripts/campaign-shell.mjs";

const filenames = Object.fromEntries(
  Object.entries({
    "index.html": "home",
    "start.html": "start",
    "route.html": "route",
    "interview.html": "interview",
    "updates.html": "updates",
    "clue-board.html": "clue-board",
    "report.html": "report",
    "rules.html": "rules",
    "dashboard.html": "dashboard",
    "sponsors.html": "sponsors",
    "privacy.html": "privacy",
    "waiver.html": "waiver",
    "community-guidelines.html": "community-guidelines",
  }).map(([filename, route]) => [route, filename]),
);

function source({
  route = "route",
  target = "main",
  label = "Skip to the route",
  descriptor = { route, skipLabel: label, skipTarget: target },
  targetMarkup = `<main id="${target}"><p>Original body content.</p></main>`,
  beforeFooter = "",
} = {}) {
  return `<!doctype html>
<html lang="en-CA"><head><meta name="description" content="Keep me"><title>Test page</title></head>
<body class="campaign-page" data-campaign-route="${route}">
<!-- CAMPAIGN_SHELL ${JSON.stringify(descriptor)} -->
${targetMarkup}
${beforeFooter}
<!-- CAMPAIGN_FOOTER -->
</body></html>`;
}

function primaryNav(html) {
  return html.match(/<nav class="campaign-nav"[\s\S]*?<\/nav>/)?.[0] ?? "";
}

function footer(html) {
  return html.match(/<footer class="campaign-footer"[\s\S]*?<\/footer>/)?.[0] ?? "";
}

test("renders one complete canonical shell and footer without changing page content", () => {
  const html = renderCampaignPage(source(), "route.html");

  for (const className of [
    "skip-link",
    "case-strip",
    "campaign-header",
    "campaign-nav",
    "campaign-footer",
  ]) {
    assert.equal(
      (html.match(new RegExp(`class="${className}(?:"| )`, "g")) ?? []).length,
      1,
      `${className} should be rendered exactly once`,
    );
  }

  assert.match(html, /^<!doctype html>/);
  assert.match(html, /<meta name="description" content="Keep me">/);
  assert.match(html, /<main id="main"><p>Original body content\.<\/p><\/main>/);
  assert.match(html, /<a class="skip-link" href="#main">Skip to the route<\/a>/);
  assert.match(
    html,
    /<section class="case-strip" data-case-status data-status="unavailable" role="status" aria-live="polite" aria-atomic="true">/,
  );
  assert.match(html, /<header class="campaign-header">\s*<div class="campaign-header__inner">/);
  assert.match(
    html,
    /<a class="campaign-brand" href="\/">Tim Lost Something\?<span>This year: Tim lost his ID<\/span><\/a>/,
  );
  assert.match(
    html,
    /<button class="campaign-menu-toggle" type="button" aria-expanded="false" aria-controls="campaign-nav"><span class="sr-only">Toggle campaign menu<\/span><span aria-hidden="true">&#9776;<\/span><\/button>/,
  );
  assert.match(primaryNav(html), /id="campaign-nav" aria-label="Campaign"/);
  assert.doesNotMatch(html, /CAMPAIGN_SHELL|CAMPAIGN_FOOTER/);
});

test("renders the exact primary menu order, current route, and Sponsors class", () => {
  const html = renderCampaignPage(source(), "route.html");
  const nav = primaryNav(html);

  assert.deepEqual(
    [...nav.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
    CAMPAIGN_MENU.map((item) => item.href),
  );
  assert.deepEqual(
    [...nav.matchAll(/>([^<>]+)<\/a>/g)].map((match) => match[1]),
    CAMPAIGN_MENU.map((item) => item.label),
  );
  assert.equal((nav.match(/aria-current="page"/g) ?? []).length, 1);
  assert.match(nav, /href="\/route" aria-current="page">12-waypoint Route<\/a>/);
  assert.match(nav, /href="\/sponsors" class="nav-sponsors">Sponsors<\/a>/);
  assert.doesNotMatch(nav, /\.html/);
});

test("home, interview, and legal routes do not invent a primary current item", () => {
  for (const route of [
    "home",
    "interview",
    "privacy",
    "waiver",
    "community-guidelines",
  ]) {
    const html = renderCampaignPage(source({ route }), filenames[route]);
    assert.doesNotMatch(primaryNav(html), /aria-current="page"/, route);
  }
});

test("renders canonical footer links in order and only its matching current state", () => {
  const expected = [
    "/privacy",
    "/waiver",
    "/community-guidelines",
    "/rules",
    "/sponsors",
  ];

  for (const route of ["privacy", "waiver", "community-guidelines", "rules", "sponsors", "home"]) {
    const rendered = footer(renderCampaignPage(source({ route }), filenames[route]));
    assert.deepEqual(
      [...rendered.matchAll(/href="([^"]+)"/g)].map((match) => match[1]),
      expected,
    );
    assert.doesNotMatch(rendered, /\.html/);
    if (route === "home") {
      assert.doesNotMatch(rendered, /aria-current="page"/);
    } else {
      assert.equal((rendered.match(/aria-current="page"/g) ?? []).length, 1);
      assert.match(rendered, new RegExp(`href="/${route}" aria-current="page"`));
    }
  }
});

test("escapes the validated skip label before rendering it", () => {
  const html = renderCampaignPage(
    source({ label: "Skip to Tim's ID & route" }),
    "route.html",
  );
  assert.match(html, /Skip to Tim&#39;s ID &amp; route<\/a>/);
  assert.doesNotMatch(html, /Skip to Tim's ID & route<\/a>/);
});

test("fails closed for unknown routes and filename-to-route mismatches", () => {
  assert.throws(
    () => renderCampaignPage(source({ route: "other" }), "route.html"),
    /unknown campaign route/i,
  );
  assert.throws(
    () => renderCampaignPage(source({ route: "route" }), "start.html"),
    /filename.*route|route.*filename/i,
  );
  assert.throws(
    () => renderCampaignPage(source(), "not-approved.html"),
    /campaign filename/i,
  );
});

test("fails closed for missing, duplicate, malformed, or remaining markers", () => {
  const valid = source();
  assert.throws(
    () => renderCampaignPage(valid.replace(/<!-- CAMPAIGN_SHELL .* -->/, ""), "route.html"),
    /exactly one campaign shell marker/i,
  );
  assert.throws(
    () => renderCampaignPage(valid.replace("<main", "<!-- CAMPAIGN_SHELL {} -->\n<main"), "route.html"),
    /exactly one campaign shell marker/i,
  );
  assert.throws(
    () => renderCampaignPage(valid.replace(/<!-- CAMPAIGN_SHELL .* -->/, "<!-- CAMPAIGN_SHELL {oops} -->"), "route.html"),
    /invalid campaign shell json/i,
  );
  assert.throws(
    () => renderCampaignPage(valid.replace("<!-- CAMPAIGN_FOOTER -->", ""), "route.html"),
    /exactly one campaign footer marker/i,
  );
  assert.throws(
    () => renderCampaignPage(`${valid}\n<!-- CAMPAIGN_FOOTER -->`, "route.html"),
    /exactly one campaign footer marker/i,
  );
  assert.throws(
    () => renderCampaignPage(source({ beforeFooter: "<!-- CAMPAIGN_SHELL_EXTRA -->" }), "route.html"),
    /remaining campaign marker/i,
  );
});

test("fails closed for invalid descriptor data and unsafe skip values", () => {
  for (const descriptor of [
    null,
    [],
    {},
    { route: "route", skipLabel: "Skip to the route" },
    { route: "route", skipTarget: "main" },
    { route: 12, skipLabel: "Skip to the route", skipTarget: "main" },
  ]) {
    assert.throws(
      () => renderCampaignPage(source({ descriptor }), "route.html"),
      /campaign shell descriptor|unknown campaign route/i,
    );
  }

  for (const label of ["bad", '" onfocus="alert(1)', "x".repeat(81)]) {
    assert.throws(
      () => renderCampaignPage(source({ label }), "route.html"),
      /skip label/i,
    );
  }

  for (const target of ["1main", "not there", "main.onclick", "x".repeat(65)]) {
    assert.throws(
      () => renderCampaignPage(source({ target }), "route.html"),
      /skip target/i,
    );
  }
});

test("fails closed when the declared skip target does not exist as an id", () => {
  assert.throws(
    () =>
      renderCampaignPage(
        source({ target: "missing", targetMarkup: '<main id="main"></main>' }),
        "route.html",
      ),
    /skip target.*does not exist/i,
  );
});

test("does not accept a skip target id that exists only in a comment or script", () => {
  for (const targetMarkup of [
    '<!-- <main id="main"></main> -->',
    '<script>const template = \'<main id="main"></main>\';</script><main></main>',
  ]) {
    assert.throws(
      () => renderCampaignPage(source({ targetMarkup }), "route.html"),
      /skip target.*does not exist/i,
    );
  }
});

test("rejects legacy public shell classes", () => {
  for (const className of [
    "topbar",
    "footer",
    "hunter-header",
    "hunter-nav",
    "hunter-footer",
    "board-topbar",
    "board-nav",
    "board-footer",
    "case-signal",
    "sponsor-topbar",
    "sponsor-footer",
  ]) {
    assert.throws(
      () => renderCampaignPage(source({ beforeFooter: `<div class="${className}"></div>` }), "route.html"),
      /legacy public shell class/i,
      className,
    );
  }
});

test("rejects source markup that would duplicate a canonical shell root", () => {
  assert.throws(
    () => renderCampaignPage(source({ beforeFooter: '<div class="campaign-footer"></div>' }), "route.html"),
    /exactly one canonical campaign-footer/i,
  );
});

test("rejects duplicate canonical shell internals and campaign nav id", () => {
  for (const { markup, name } of [
    {
      markup: '<div class="campaign-header__inner"></div>',
      name: "campaign-header__inner",
    },
    {
      markup: '<button class="campaign-menu-toggle"></button>',
      name: "campaign-menu-toggle",
    },
    { markup: '<div id="campaign-nav"></div>', name: "#campaign-nav" },
  ]) {
    assert.throws(
      () => renderCampaignPage(source({ beforeFooter: markup }), "route.html"),
      new RegExp(`exactly one canonical ${name}`),
      name,
    );
  }
});

test("registry and menu expose exactly the approved frozen contracts", () => {
  assert.ok(Object.isFrozen(CAMPAIGN_PAGES));
  assert.ok(Object.isFrozen(CAMPAIGN_MENU));
  assert.deepEqual(CAMPAIGN_PAGES, {
    "index.html": "home",
    "start.html": "start",
    "route.html": "route",
    "interview.html": "interview",
    "updates.html": "updates",
    "clue-board.html": "clue-board",
    "report.html": "report",
    "rules.html": "rules",
    "dashboard.html": "dashboard",
    "sponsors.html": "sponsors",
    "privacy.html": "privacy",
    "waiver.html": "waiver",
    "community-guidelines.html": "community-guidelines",
  });
  assert.deepEqual(CAMPAIGN_MENU, [
    { route: "start", label: "Start", href: "/start" },
    { route: "route", label: "12-waypoint Route", href: "/route" },
    { route: "updates", label: "Updates", href: "/updates" },
    { route: "clue-board", label: "Clue Board", href: "/clue-board" },
    { route: "report", label: "Report", href: "/report" },
    { route: "rules", label: "Rules", href: "/rules" },
    { route: "dashboard", label: "Dashboard", href: "/dashboard" },
    { route: "sponsors", label: "Sponsors", href: "/sponsors" },
  ]);
});
