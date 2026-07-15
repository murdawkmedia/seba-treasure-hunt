import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  CAMPAIGN_MENU,
  CAMPAIGN_PAGES,
  renderCampaignPage,
  scanCampaignHtmlStartTags,
} from "../scripts/campaign-shell.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const buildScript = path.join(root, "scripts", "build.mjs");

const legacyShellClasses = Object.freeze([
  "topbar",
  "footer",
  "hunter-header",
  "hunter-nav",
  "hunter-footer",
  "board-topbar",
  "board-brand",
  "board-menu-toggle",
  "board-nav",
  "board-footer",
  "case-signal",
  "sponsor-topbar",
  "sponsor-footer",
  "site-header",
  "site-footer",
]);

const descriptors = {
  "index.html": { route: "home", skipLabel: "Skip to the campaign", skipTarget: "main" },
  "start.html": { route: "start", skipLabel: "Skip to the hunt guide", skipTarget: "main" },
  "route.html": { route: "route", skipLabel: "Skip to the route", skipTarget: "main" },
  "interview.html": { route: "interview", skipLabel: "Skip to the interview", skipTarget: "main" },
  "updates.html": { route: "updates", skipLabel: "Skip to official updates", skipTarget: "main" },
  "clue-board.html": { route: "clue-board", skipLabel: "Skip to the clue board", skipTarget: "main" },
  "report.html": { route: "report", skipLabel: "Skip to private reporting", skipTarget: "main" },
  "rules.html": { route: "rules", skipLabel: "Skip to the current rules", skipTarget: "main" },
  "dashboard.html": { route: "dashboard", skipLabel: "Skip to Hunter Dashboard", skipTarget: "main" },
  "sponsors.html": { route: "sponsors", skipLabel: "Skip to sponsor opportunities", skipTarget: "main" },
  "privacy.html": { route: "privacy", skipLabel: "Skip to the privacy policy", skipTarget: "main" },
  "waiver.html": { route: "waiver", skipLabel: "Skip to the participation waiver", skipTarget: "main" },
  "community-guidelines.html": { route: "community-guidelines", skipLabel: "Skip to the community guidelines", skipTarget: "main" },
};

test("build exposes an imported seam without runtime path overrides", () => {
  const buildSource = readFileSync(buildScript, "utf8");
  assert.doesNotMatch(buildSource, /TIM_LOST_BUILD_(?:DIST|MEDIA_DIST|PAGE_SOURCE)_DIR/);
  assert.match(buildSource, /export\s+async\s+function\s+buildSite\b/);
  assert.match(buildSource, /import\.meta\.url[\s\S]*process\.argv\[1\]/);
});

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

function assertShellPrefixPreserved(sourceHtml, renderedHtml, filename) {
  const markers = [...sourceHtml.matchAll(/<!-- CAMPAIGN_SHELL [\s\S]*? -->/g)];
  assert.equal(markers.length, 1, `${filename} has one shell marker boundary`);
  const markerStart = markers[0].index;
  assert.equal(
    renderedHtml.slice(0, markerStart),
    sourceHtml.slice(0, markerStart),
    `${filename} preserves its exact prefix through its shell marker`,
  );
  assert.match(
    renderedHtml.slice(markerStart),
    /^<a class="skip-link" /,
    `${filename} inserts the canonical shell at the marker boundary`,
  );
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
  assert.match(primaryNav(html), /class="campaign-account" data-campaign-account/);
  assert.match(primaryNav(html), /class="campaign-account__signin" type="button" data-campaign-account-sign-in>Sign in<\/button>/);
  assert.match(primaryNav(html), /data-campaign-account-toggle/);
  assert.match(primaryNav(html), /data-campaign-account-menu/);
  assert.match(primaryNav(html), /data-campaign-account-destination="\/dashboard#profile">Edit profile<\/button>/);
  assert.match(primaryNav(html), /data-campaign-sign-out/);
  assert.doesNotMatch(html, /CAMPAIGN_SHELL|CAMPAIGN_FOOTER/);
});

test("the canonical shell loads one global account client after public page content", () => {
  const html = renderCampaignPage(source(), "route.html");
  assert.equal((html.match(/src="\/assets\/app\/account\.js"/g) ?? []).length, 1);
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

test("fails closed when the declared skip target id is duplicated", () => {
  assert.throws(
    () =>
      renderCampaignPage(
        source({
          targetMarkup: '<main id="main"></main><aside id="main"></aside>',
        }),
        "route.html",
      ),
    /skip target.*exactly one live element/i,
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

test("does not treat markup-looking attribute or raw-text content as a skip target", () => {
  for (const targetMarkup of [
    '<div data-template=\'<main id="main">\'></div>',
    '<style>.example::before { content: \'<main id="main">\'; }</style>',
    '<textarea><main id="main"></textarea>',
  ]) {
    assert.throws(
      () => renderCampaignPage(source({ targetMarkup }), "route.html"),
      /skip target.*does not exist/i,
    );
  }
});

for (const [context, targetMarkup] of [
  ["plaintext", '<plaintext><main id="main"></main>'],
  ["template", '<template><main id="main"></main></template>'],
  ["script-enabled noscript", '<noscript><main id="main"></main></noscript>'],
]) {
  test(`does not accept a skip target inside ${context} content`, () => {
    assert.throws(
      () => renderCampaignPage(source({ targetMarkup }), "route.html"),
      /skip target.*does not exist/i,
    );
  });
}

for (const [context, hiddenMarkup] of [
  [
    "nested template",
    '<template><div class="topbar" id="campaign-nav"></div><template><div class="campaign-footer"></div></template></template>',
  ],
  [
    "script-enabled noscript",
    '<noscript><div class="topbar campaign-footer" id="campaign-nav"></div></noscript>',
  ],
]) {
  test(`ignores ${context} classes and ids, then recognizes a live target after it`, () => {
    assert.doesNotThrow(() =>
      renderCampaignPage(
        source({ targetMarkup: `${hiddenMarkup}<main id="main"></main>` }),
        "route.html",
      ),
    );
  });
}

test("treats plaintext descendants and the generated footer as text", () => {
  assert.throws(
    () =>
      renderCampaignPage(
        source({
          targetMarkup:
            '<plaintext id="main"><div class="topbar campaign-footer" id="campaign-nav"></div>',
        }),
        "route.html",
      ),
    /exactly one canonical campaign-footer/i,
  );
});

for (const [name, character] of [
  ["NBSP", "\u00a0"],
  ["vertical tab", "\u000b"],
]) {
  test(`does not treat ${name} after a tag name as HTML whitespace`, () => {
    assert.throws(
      () =>
        renderCampaignPage(
          source({ targetMarkup: `<main${character}id="main"></main>` }),
          "route.html",
        ),
      /malformed campaign page html|skip target/i,
    );
  });

  test(`does not treat ${name} between attributes as HTML whitespace`, () => {
    assert.throws(
      () =>
        renderCampaignPage(
          source({ targetMarkup: `<main data-value=one${character}id=main></main>` }),
          "route.html",
        ),
      /malformed campaign page html|skip target/i,
    );
  });

  test(`does not accept a script end tag padded with ${name}`, () => {
    assert.throws(
      () =>
        renderCampaignPage(
          source({
            targetMarkup: `<script>const ignored = true;</script${character}><main id="main"></main>`,
          }),
          "route.html",
        ),
      /unterminated <script>|skip target/i,
    );
  });

  test(`does not accept a template end tag padded with ${name}`, () => {
    assert.throws(
      () =>
        renderCampaignPage(
          source({
            targetMarkup: `<template><div></div></template${character}><main id="main"></main>`,
          }),
          "route.html",
        ),
      /malformed campaign page html|unterminated <template>|skip target/i,
    );
  });

  test(`does not split class tokens on ${name}`, () => {
    assert.doesNotThrow(() =>
      renderCampaignPage(
        source({ beforeFooter: `<div class="safe${character}topbar"></div>` }),
        "route.html",
      ),
    );
  });
}

test("splits class tokens on HTML form-feed whitespace", () => {
  assert.throws(
    () =>
      renderCampaignPage(
        source({ beforeFooter: '<div class="safe\ftopbar"></div>' }),
        "route.html",
      ),
    /legacy public shell class/i,
  );
});

test("the shared live-HTML scanner parses attribute forms and ignores inert lookalikes", () => {
  const tags = scanCampaignHtmlStartTags(`
    <!-- <a href="/comment" class="topbar">Comment</a> -->
    <script>const inert = '<a href="/script" class="topbar">';</script>
    <template><a href="/template" class="topbar">Template</a></template>
    <a HREF = "/double" data-class="topbar">Double</a>
    <a href = '/single' class='campaign-link'>Single</a>
    <a\thReF\f=\r/unquoted>Unquoted</a>
  `);
  const attributes = tags.flatMap((tag) => tag.attributes);

  assert.ok(Object.isFrozen(tags));
  assert.ok(tags.every((tag) => Object.isFrozen(tag) && Object.isFrozen(tag.attributes)));
  assert.deepEqual(
    attributes.filter((attribute) => attribute.name === "href").map((attribute) => attribute.value),
    ["/double", "/single", "/unquoted"],
  );
  assert.deepEqual(
    attributes.filter((attribute) => attribute.name === "class").map((attribute) => attribute.value),
    ["campaign-link"],
  );
});

test("rejects every legacy public shell class", () => {
  for (const className of legacyShellClasses) {
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

test("recognizes unquoted legacy classes and canonical class or id duplicates", () => {
  for (const { markup, expected } of [
    { markup: "<div class=topbar></div>", expected: /legacy public shell class/i },
    {
      markup: "<div class=campaign-footer></div>",
      expected: /exactly one canonical campaign-footer/i,
    },
    {
      markup: "<div id=campaign-nav></div>",
      expected: /exactly one canonical #campaign-nav/i,
    },
  ]) {
    assert.throws(
      () => renderCampaignPage(source({ beforeFooter: markup }), "route.html"),
      expected,
    );
  }
});

test("fails closed on malformed relevant start-tag attributes", () => {
  assert.throws(
    () =>
      renderCampaignPage(
        source({ beforeFooter: '<div class="campaign-footer></div>' }),
        "route.html",
      ),
    /malformed campaign page html/i,
  );
});

test("freezes every exported campaign menu item", () => {
  for (const item of CAMPAIGN_MENU) assert.ok(Object.isFrozen(item));
});

test("attempted menu mutation cannot change navigation output", () => {
  const item = CAMPAIGN_MENU[0];
  const originalHref = item.href;
  const before = renderCampaignPage(source({ route: "start" }), "start.html");
  const changed = Reflect.set(item, "href", '/start"><script>alert(1)</script>');
  if (changed) Reflect.set(item, "href", originalHref);
  const after = renderCampaignPage(source({ route: "start" }), "start.html");

  assert.equal(changed, false);
  assert.equal(item.href, originalHref);
  assert.equal(after, before);
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

test("every registered source page declares exactly its approved shell descriptor", () => {
  assert.deepEqual(Object.keys(CAMPAIGN_PAGES), Object.keys(descriptors));

  for (const [filename, expected] of Object.entries(descriptors)) {
    const html = readFileSync(path.join(root, filename), "utf8");
    const markers = [...html.matchAll(/<!--\s*CAMPAIGN_SHELL\s+([\s\S]*?)\s*-->/g)];
    assert.equal(markers.length, 1, `${filename} must declare exactly one shell marker`);
    assert.deepEqual(JSON.parse(markers[0][1]), expected, `${filename} descriptor`);
    assert.equal(
      (html.match(/<!--\s*CAMPAIGN_FOOTER\s*-->/g) ?? []).length,
      1,
      `${filename} must declare exactly one footer marker`,
    );
    assert.equal(
      (html.match(/<main\b/g) ?? []).length,
      1,
      `${filename} must have exactly one primary main landmark`,
    );
    assert.match(
      html,
      /<main\b(?=[^>]*\bid="main")(?=[^>]*\btabindex="-1")[^>]*>/,
      `${filename} main landmark must be the focusable skip target`,
    );
    assert.match(
      html,
      new RegExp(`<body\\b(?=[^>]*\\bclass="[^"]*\\bcampaign-page\\b[^"]*")(?=[^>]*\\bdata-campaign-route="${expected.route}")[^>]*>\\s*<!--\\s*CAMPAIGN_SHELL`),
      `${filename} marker must immediately follow its declared campaign body`,
    );
    assert.match(
      html,
      /<!--\s*CAMPAIGN_FOOTER\s*-->\s*<script\b/,
      `${filename} footer marker must immediately precede its body scripts`,
    );
  }
});

test("shell rendering preserves each registered page prefix through the shell marker", () => {
  for (const filename of Object.keys(CAMPAIGN_PAGES)) {
    const sourceHtml = readFileSync(path.join(root, filename), "utf8");
    const renderedHtml = renderCampaignPage(sourceHtml, filename);
    assertShellPrefixPreserved(sourceHtml, renderedHtml, filename);
  }
});

test("prefix preservation does not truncate at a raw-text head lookalike", () => {
  const fixture = source().replace(
    '<meta name="description" content="Keep me">',
    '<script>const fakeHeadEnd = "</head>";</script><meta name="description" content="Keep me">',
  );
  const rendered = renderCampaignPage(fixture, "route.html");

  assert.doesNotThrow(() => assertShellPrefixPreserved(fixture, rendered, "route.html"));
  assert.throws(
    () => assertShellPrefixPreserved(
      fixture,
      rendered.replace("<title>Test page</title>", "<title>Changed after fake end</title>"),
      "route.html",
    ),
    /prefix through its shell marker/i,
  );
});
