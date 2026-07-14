export const CAMPAIGN_MENU = Object.freeze([
  { route: "start", label: "Start", href: "/start" },
  { route: "route", label: "12-waypoint Route", href: "/route" },
  { route: "updates", label: "Updates", href: "/updates" },
  { route: "clue-board", label: "Clue Board", href: "/clue-board" },
  { route: "report", label: "Report", href: "/report" },
  { route: "rules", label: "Rules", href: "/rules" },
  { route: "dashboard", label: "Dashboard", href: "/dashboard" },
  { route: "sponsors", label: "Sponsors", href: "/sponsors" },
]);

export const CAMPAIGN_PAGES = Object.freeze({
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

const allowedRoutes = new Set(Object.values(CAMPAIGN_PAGES));
const safeSkipLabel = /^[A-Za-z0-9 ?'&-]{4,80}$/;
const safeTarget = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const legacyShellClasses = new Set([
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
const canonicalShellRoots = [
  "skip-link",
  "case-strip",
  "campaign-header",
  "campaign-header__inner",
  "campaign-menu-toggle",
  "campaign-nav",
  "campaign-footer",
];
const canonicalShellIds = ["campaign-nav"];

const footerLinks = [
  { route: "privacy", label: "Privacy", href: "/privacy" },
  { route: "waiver", label: "Participation Waiver", href: "/waiver" },
  {
    route: "community-guidelines",
    label: "Community Guidelines",
    href: "/community-guidelines",
  },
  { route: "rules", label: "Rules", href: "/rules" },
  { route: "sponsors", label: "Sponsors", href: "/sponsors" },
];

function escapeHtml(value) {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[character],
  );
}

function renderLink(item, route, className = "") {
  const current = item.route === route ? ' aria-current="page"' : "";
  const cssClass = className ? ` class="${className}"` : "";
  return `<a href="${item.href}"${current}${cssClass}>${item.label}</a>`;
}

function renderCampaignShell({ route, skipLabel, skipTarget }) {
  const navigation = CAMPAIGN_MENU.map((item) =>
    renderLink(item, route, item.route === "sponsors" ? "nav-sponsors" : ""),
  ).join("\n        ");

  return `<a class="skip-link" href="#${skipTarget}">${escapeHtml(skipLabel)}</a>
<section class="case-strip" data-case-status data-status="unavailable" role="status" aria-live="polite" aria-atomic="true">
  <span class="case-strip__mark" data-status-mark aria-hidden="true">?</span>
  <span class="case-strip__copy">
    <strong class="case-strip__label" data-status-label>Status unavailable</strong>
    <span class="case-strip__detail" data-status-detail>Live status could not be confirmed. Exact directions stay locked; reporting remains available.</span>
    <span class="case-strip__next" data-status-next hidden></span>
  </span>
  <a class="case-strip__link" href="/updates">Official updates</a>
</section>
<header class="campaign-header">
  <div class="campaign-header__inner">
    <a class="campaign-brand" href="/">Tim Lost Something?<span>This year: Tim lost his ID</span></a>
    <button class="campaign-menu-toggle" type="button" aria-expanded="false" aria-controls="campaign-nav"><span class="sr-only">Toggle campaign menu</span><span aria-hidden="true">&#9776;</span></button>
    <nav class="campaign-nav" id="campaign-nav" aria-label="Campaign">
        ${navigation}
    </nav>
  </div>
</header>`;
}

function renderCampaignFooter(route) {
  const links = footerLinks.map((item) => renderLink(item, route)).join("\n        ");
  return `<footer class="campaign-footer">
  <div class="campaign-footer__inner">
    <p>Tim Lost Something?</p>
    <nav aria-label="Campaign information">
        ${links}
    </nav>
  </div>
</footer>`;
}

function collectClasses(source) {
  const classes = [];
  for (const match of source.matchAll(/\bclass\s*=\s*(["'])([\s\S]*?)\1/gi)) {
    classes.push(...match[2].split(/\s+/).filter(Boolean));
  }
  return classes;
}

function collectElementIds(source) {
  const renderedMarkup = source
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script\s*>/gi, "");
  const ids = [];

  for (const tag of renderedMarkup.match(/<[A-Za-z][^>]*>/g) ?? []) {
    const id = tag.match(/\sid\s*=\s*(["'])(.*?)\1/i);
    if (id) ids.push(id[2]);
  }

  return ids;
}

function assertNoLegacyShellClasses(source) {
  const legacyClass = collectClasses(source).find((className) =>
    legacyShellClasses.has(className),
  );
  if (legacyClass) {
    throw new Error(`Legacy public shell class is not allowed: ${legacyClass}`);
  }
}

function assertOneCanonicalShell(rendered) {
  const classes = collectClasses(rendered);
  for (const className of canonicalShellRoots) {
    if (classes.filter((candidate) => candidate === className).length !== 1) {
      throw new Error(`Expected exactly one canonical ${className}`);
    }
  }

  const ids = collectElementIds(rendered);
  for (const id of canonicalShellIds) {
    if (ids.filter((candidate) => candidate === id).length !== 1) {
      throw new Error(`Expected exactly one canonical #${id}`);
    }
  }
}

function parseDescriptor(source) {
  const markers = [...source.matchAll(/<!-- CAMPAIGN_SHELL ([\s\S]*?) -->/g)];
  if (markers.length !== 1) {
    throw new Error("Expected exactly one campaign shell marker");
  }

  const marker = markers[0];

  let descriptor;
  try {
    descriptor = JSON.parse(marker[1]);
  } catch {
    throw new Error("Invalid campaign shell JSON descriptor");
  }

  if (
    descriptor === null ||
    typeof descriptor !== "object" ||
    Array.isArray(descriptor) ||
    typeof descriptor.route !== "string" ||
    typeof descriptor.skipLabel !== "string" ||
    typeof descriptor.skipTarget !== "string"
  ) {
    throw new Error("Invalid campaign shell descriptor data");
  }

  return { descriptor, marker: marker[0] };
}

export function renderCampaignPage(source, filename) {
  if (typeof source !== "string") {
    throw new TypeError("Campaign page source must be a string");
  }

  const footerReferences = source.match(/CAMPAIGN_FOOTER/g) ?? [];
  const footerMarker = "<!-- CAMPAIGN_FOOTER -->";
  if (footerReferences.length !== 1 || !source.includes(footerMarker)) {
    throw new Error("Expected exactly one campaign footer marker");
  }

  const { descriptor, marker: shellMarker } = parseDescriptor(source);
  if (!allowedRoutes.has(descriptor.route)) {
    throw new Error(`Unknown campaign route: ${descriptor.route}`);
  }
  if (typeof filename !== "string" || !Object.hasOwn(CAMPAIGN_PAGES, filename)) {
    throw new Error(`Unknown campaign filename: ${filename}`);
  }
  if (CAMPAIGN_PAGES[filename] !== descriptor.route) {
    throw new Error(
      `Campaign filename ${filename} does not match route ${descriptor.route}`,
    );
  }
  if (!safeSkipLabel.test(descriptor.skipLabel)) {
    throw new Error("Invalid campaign skip label");
  }
  if (!safeTarget.test(descriptor.skipTarget)) {
    throw new Error("Invalid campaign skip target");
  }

  if (!collectElementIds(source).includes(descriptor.skipTarget)) {
    throw new Error(
      `Campaign skip target ${descriptor.skipTarget} does not exist in ${filename}`,
    );
  }

  assertNoLegacyShellClasses(source);

  const rendered = source
    .replace(shellMarker, renderCampaignShell(descriptor))
    .replace(footerMarker, renderCampaignFooter(descriptor.route));

  if (/CAMPAIGN_(?:SHELL|FOOTER)/.test(rendered)) {
    throw new Error("Remaining campaign marker after rendering");
  }
  assertOneCanonicalShell(rendered);

  return rendered;
}
