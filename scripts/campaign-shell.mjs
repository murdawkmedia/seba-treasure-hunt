export const CAMPAIGN_MENU = Object.freeze([
  Object.freeze({ route: "start", label: "Start", href: "/start" }),
  Object.freeze({ route: "route", label: "Lucky 13 Route", href: "/route" }),
  Object.freeze({ route: "interview", label: "Tim's Account", href: "/interview" }),
  Object.freeze({ route: "updates", label: "Updates", href: "/updates" }),
  Object.freeze({ route: "clue-board", label: "Case Notes", href: "/clue-board" }),
  Object.freeze({ route: "report", label: "Report", href: "/report" }),
  Object.freeze({ route: "rules", label: "Rules", href: "/rules" }),
  Object.freeze({ route: "dashboard", label: "Dashboard", href: "/dashboard" }),
  Object.freeze({ route: "sponsors", label: "Sponsors", href: "/sponsors" }),
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
const htmlWhitespace = /[\t\n\f\r ]/;
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
  "campaign-account",
  "campaign-footer",
];
const canonicalShellIds = ["campaign-nav"];
const rawTextElements = new Set([
  "iframe",
  "noembed",
  "noframes",
  // Campaign output runs JavaScript, so noscript descendants are not live DOM.
  "noscript",
  "script",
  "style",
  "textarea",
  "title",
  "xmp",
]);

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
        <div class="campaign-account" data-campaign-account>
          <button class="campaign-account__signin" type="button" data-campaign-account-sign-in>Sign in</button>
          <button class="campaign-account__toggle" type="button" data-campaign-account-toggle aria-expanded="false" aria-controls="campaign-account-menu" hidden><span class="campaign-account__avatar" data-campaign-account-avatar aria-hidden="true">?</span><span data-campaign-account-handle>Hunter</span></button>
          <div class="campaign-account__menu" id="campaign-account-menu" data-campaign-account-menu hidden>
            <button type="button" data-campaign-account-destination="/dashboard">Dashboard</button>
            <button type="button" data-campaign-account-destination="/dashboard#profile">Edit profile</button>
            <button type="button" data-campaign-sign-out>Sign out</button>
          </div>
        </div>
    </nav>
  </div>
</header>`;
}

function renderCampaignFooter(route) {
  const links = footerLinks.map((item) => renderLink(item, route)).join("\n        ");
  return `<footer class="campaign-footer">
  <div class="campaign-footer__inner">
    <p>Tim Lost Something?</p>
    <div class="campaign-footer__endorsement">
      <a class="sunny-badge-link" href="https://www.sebastays.com/guarantee" target="_blank" rel="noopener" aria-label="Visit the SebaStays Sunny Guarantee (opens in a new tab)">
        <img src="/assets/seba-badge.png" alt="Always Sunny in Seba" />
        <span>Hosted by SebaHub · Sunny Guarantee</span>
      </a>
    </div>
    <nav aria-label="Campaign information">
        ${links}
    </nav>
  </div>
</footer>
<script type="module" src="/assets/app/account.js"></script>`;
}

function malformedHtml(detail) {
  throw new Error(`Malformed campaign page HTML: ${detail}`);
}

function isHtmlWhitespace(character) {
  return character !== undefined && htmlWhitespace.test(character);
}

function findTagEnd(source, start) {
  let quote = "";
  for (let index = start + 1; index < source.length; index += 1) {
    const character = source[index];
    if (quote) {
      if (character === quote) quote = "";
    } else if (character === '"' || character === "'") {
      quote = character;
    } else if (character === ">") {
      return index;
    } else if (character === "<") {
      malformedHtml("unexpected < inside a tag");
    }
  }
  malformedHtml("unterminated tag or quoted attribute");
}

function parseStartTag(rawTag) {
  const nameMatch = rawTag.match(/^([A-Za-z][A-Za-z0-9:-]*)/);
  if (!nameMatch) malformedHtml("invalid start tag name");

  const attributes = [];
  const attributeNames = new Set();
  let cursor = nameMatch[0].length;
  if (cursor < rawTag.length && !isHtmlWhitespace(rawTag[cursor]) && rawTag[cursor] !== "/") {
    malformedHtml(`invalid <${nameMatch[0]}> tag name`);
  }

  while (cursor < rawTag.length) {
    while (isHtmlWhitespace(rawTag[cursor])) cursor += 1;
    if (cursor >= rawTag.length) break;
    if (rawTag[cursor] === "/") {
      cursor += 1;
      while (isHtmlWhitespace(rawTag[cursor])) cursor += 1;
      if (cursor !== rawTag.length) malformedHtml("content after a self-closing slash");
      break;
    }

    const nameStart = cursor;
    while (cursor < rawTag.length && !/[\t\n\f\r "'`=<>/]/.test(rawTag[cursor])) {
      cursor += 1;
    }
    if (cursor === nameStart) malformedHtml("invalid attribute name");
    const name = rawTag.slice(nameStart, cursor).toLowerCase();
    if (attributeNames.has(name)) malformedHtml(`duplicate ${name} attribute`);
    attributeNames.add(name);

    while (isHtmlWhitespace(rawTag[cursor])) cursor += 1;
    let value = null;
    if (rawTag[cursor] === "=") {
      cursor += 1;
      while (isHtmlWhitespace(rawTag[cursor])) cursor += 1;
      if (cursor >= rawTag.length) malformedHtml(`missing ${name} attribute value`);

      const quote = rawTag[cursor];
      if (quote === '"' || quote === "'") {
        cursor += 1;
        const valueStart = cursor;
        while (cursor < rawTag.length && rawTag[cursor] !== quote) cursor += 1;
        if (cursor >= rawTag.length) malformedHtml(`unterminated ${name} attribute`);
        value = rawTag.slice(valueStart, cursor);
        cursor += 1;
        if (
          cursor < rawTag.length &&
          !isHtmlWhitespace(rawTag[cursor]) &&
          rawTag[cursor] !== "/"
        ) {
          malformedHtml(`missing space after ${name} attribute`);
        }
      } else {
        const valueStart = cursor;
        while (cursor < rawTag.length && !isHtmlWhitespace(rawTag[cursor])) {
          if (/["'`=<>]/.test(rawTag[cursor])) {
            malformedHtml(`invalid unquoted ${name} attribute`);
          }
          cursor += 1;
        }
        value = rawTag.slice(valueStart, cursor);
        if (!value) malformedHtml(`missing ${name} attribute value`);
      }
    }

    if ((name === "class" || name === "id") && value === null) {
      malformedHtml(`${name} attribute requires a value`);
    }
    if ((name === "class" || name === "id") && value.includes("&")) {
      malformedHtml(`character references are not allowed in ${name}`);
    }
    attributes.push({ name, value });
  }

  return { attributes, name: nameMatch[0].toLowerCase() };
}

function scanTagSegment(source, initialCursor = 0, stopTag = "") {
  const tags = [];
  let cursor = initialCursor;

  while (cursor < source.length) {
    const start = source.indexOf("<", cursor);
    if (start === -1) break;

    if (source.startsWith("<!--", start)) {
      const end = source.indexOf("-->", start + 4);
      if (end === -1) malformedHtml("unterminated comment");
      cursor = end + 3;
      continue;
    }

    const next = source[start + 1] ?? "";
    if (next === "/") {
      const end = findTagEnd(source, start);
      const closingTag = source
        .slice(start + 2, end)
        .match(/^[\t\n\f\r ]*([A-Za-z][A-Za-z0-9:-]*)[\t\n\f\r ]*$/);
      if (!closingTag) malformedHtml("invalid closing tag");
      cursor = end + 1;
      if (stopTag && closingTag[1].toLowerCase() === stopTag) {
        return { cursor, tags };
      }
      continue;
    }
    if (next === "!" || next === "?") {
      cursor = findTagEnd(source, start) + 1;
      continue;
    }
    if (!/[A-Za-z]/.test(next)) {
      cursor = start + 1;
      continue;
    }

    const end = findTagEnd(source, start);
    const tag = parseStartTag(source.slice(start + 1, end));
    tags.push(tag);
    cursor = end + 1;

    if (tag.name === "plaintext") {
      cursor = source.length;
      break;
    }
    if (tag.name === "template") {
      cursor = scanTagSegment(source, cursor, "template").cursor;
    } else if (rawTextElements.has(tag.name)) {
      const closingTag = new RegExp(`</${tag.name}[\\t\\n\\f\\r ]*>`, "gi");
      closingTag.lastIndex = cursor;
      const closingMatch = closingTag.exec(source);
      if (!closingMatch) malformedHtml(`unterminated <${tag.name}> element`);
      cursor = closingMatch.index + closingMatch[0].length;
    }
  }

  if (stopTag) malformedHtml(`unterminated <${stopTag}> element`);
  return { cursor, tags };
}

function scanStartTags(source) {
  return scanTagSegment(source).tags;
}

export function scanCampaignHtmlStartTags(source) {
  if (typeof source !== "string") {
    throw new TypeError("Campaign HTML source must be a string");
  }
  return Object.freeze(
    scanStartTags(source).map(({ attributes, name }) =>
      Object.freeze({
        name,
        attributes: Object.freeze(
          attributes.map((attribute) => Object.freeze({ ...attribute })),
        ),
      })),
  );
}

function collectClasses(source) {
  const classes = [];
  for (const { attributes } of scanStartTags(source)) {
    for (const attribute of attributes) {
      if (attribute.name === "class") {
        classes.push(...attribute.value.split(/[\t\n\f\r ]+/).filter(Boolean));
      }
    }
  }
  return classes;
}

function collectElementIds(source) {
  const ids = [];
  for (const { attributes } of scanStartTags(source)) {
    for (const attribute of attributes) {
      if (attribute.name === "id") ids.push(attribute.value);
    }
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

  const targetCount = collectElementIds(source).filter(
    (id) => id === descriptor.skipTarget,
  ).length;
  if (targetCount === 0) {
    throw new Error(
      `Campaign skip target ${descriptor.skipTarget} does not exist in ${filename}`,
    );
  }
  if (targetCount !== 1) {
    throw new Error(
      `Campaign skip target ${descriptor.skipTarget} must identify exactly one live element in ${filename}`,
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
