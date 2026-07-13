import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (name) => fs.readFileSync(path.join(root, name), "utf8");
const sponsorLink = /<a\b(?=[^>]*\bhref=["'](?:\/sponsors|sponsors\.html)["'])[^>]*>[\s\S]*?\bSponsors\b[\s\S]*?<\/a>/i;
const sponsorAnchor = (html) => html.match(/<a\b(?=[^>]*\bhref=["'](?:\/sponsors|sponsors\.html)["'])[^>]*>[\s\S]*?\bSponsors\b[\s\S]*?<\/a>/i)?.[0] ?? "";

const extractRegion = (html, tag, context) => {
  const match = html.match(new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, "i"));
  assert.ok(match, `${context} must contain a <${tag}> region`);
  return match[0];
};

const extractSection = (html, id) => {
  const match = html.match(new RegExp(`<section\\b(?=[^>]*\\bid=["']${id}["'])[^>]*>[\\s\\S]*?<\\/section>`, "i"));
  assert.ok(match, `sponsors.html must contain section #${id}`);
  return match[0];
};

const optionEntries = (select) => [...select.matchAll(/<option\b[^>]*\bvalue=["']([^"']*)["'][^>]*>([^<]+)<\/option>/gi)]
  .map((match) => [match[1], match[2].trim().replaceAll("&amp;", "&")]);

test("the sponsor page is a canonical, indexable answer and conversion surface", () => {
  const html = read("sponsors.html");
  assert.match(html, /<title>Sponsor the Seba Beach Treasure Hunt \| Tim Lost Something\?<\/title>/);
  assert.match(html, /<meta name="description" content="[^"]*Seba Beach[^"]*cash, prizes, services, or practical in-kind support[^"]*"/i);
  assert.match(html, /<link rel="canonical" href="https:\/\/www\.timlostsomething\.com\/sponsors"/);
  assert.match(html, /<meta name="robots" content="index,follow/);
  assert.match(html, /<meta property="og:site_name" content="Tim Lost Something\?"/);
  assert.match(html, /<meta property="og:type" content="website"/);
  assert.match(html, /<meta property="og:url" content="https:\/\/www\.timlostsomething\.com\/sponsors"/);
  assert.match(html, /<meta property="og:image" content="https:\/\/www\.timlostsomething\.com\/assets\/favicon-512x512\.png"/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image"/);
  assert.match(html, /<meta name="twitter:image" content="https:\/\/www\.timlostsomething\.com\/assets\/favicon-512x512\.png"/);
  assert.match(html, /<link rel="icon" href="\/favicon\.ico" sizes="any">/);
  assert.match(html, /<link rel="icon" href="\/assets\/favicon\.svg" type="image\/svg\+xml">/);
  assert.match(html, /<link rel="icon" href="\/assets\/favicon-32x32\.png" type="image\/png" sizes="32x32">/);
  assert.match(html, /<link rel="apple-touch-icon" href="\/assets\/apple-touch-icon\.png">/);
  assert.match(html, /<link rel="manifest" href="\/site\.webmanifest">/);
  assert.match(html, /family=IM\+Fell\+English[^"']*family=Pirata\+One[^"']*family=Special\+Elite|family=Pirata\+One[^"']*family=IM\+Fell\+English[^"']*family=Special\+Elite/i);
  for (const stylesheet of ["/css/style.css", "/css/hunter.css", "/css/sponsors.css"]) {
    assert.match(html, new RegExp(`<link rel=["']stylesheet["'] href=["']${stylesheet.replaceAll("/", "\\/")}["']`));
  }
});

test("the sponsor page shell preserves status, navigation, accessibility, and client hooks", () => {
  const html = read("sponsors.html");
  assert.match(html, /<a class="skip-link" href="#main">/);
  assert.match(html, /<main id="main" tabindex="-1">/);
  for (const hook of ["data-case-status", "data-status-mark", "data-status-label", "data-status-detail", "data-status-next"]) {
    assert.match(html, new RegExp(`\\b${hook}\\b`));
  }
  const header = extractRegion(html, "header", "sponsors.html");
  assert.match(header, /class="[^"]*\bhunter-brand\b[^"]*"/);
  assert.match(header, /<nav\b(?=[^>]*\bclass="hunter-nav")(?=[^>]*\baria-label="Campaign")[^>]*>/);
  assert.match(header, /<a\b(?=[^>]*class="[^"]*\bnav-sponsors\b[^"]*")(?=[^>]*href="\/sponsors")(?=[^>]*aria-current="page")[^>]*>Sponsors<\/a>/);
  const footer = extractRegion(html, "footer", "sponsors.html");
  for (const destination of ["/sponsors", "/privacy", "/rules", "/sponsors#inquiry"]) {
    assert.match(footer, new RegExp(`href=["']${destination.replaceAll("/", "\\/")}["']`));
  }
  assert.match(html, /<script src="\/js\/site\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/assets\/app\/status\.js"><\/script>/);
  assert.match(html, /<script type="module" src="\/assets\/app\/sponsors\.js"><\/script>/);
  assert.match(html, /<script src="https:\/\/challenges\.cloudflare\.com\/turnstile\/v0\/api\.js\?render=explicit" defer><\/script>/);
});

test("the sponsor story follows the approved hierarchy without public package pricing", () => {
  const html = read("sponsors.html");
  const orderedIds = ["sponsor-hero", "trust", "opportunities", "recognition", "inquiry", "sponsor-faq"];
  let previous = -1;
  for (const id of orderedIds) {
    const current = html.indexOf(`id="${id}"`);
    assert.ok(current > previous, `#${id} must appear in approved page order`);
    previous = current;
  }

  const hero = extractSection(html, "sponsor-hero");
  assert.match(hero, /Sponsor the Seba Beach Treasure Hunt/);
  assert.match(hero, /<h1[^>]*>Put your name inside the mystery\.<\/h1>/);
  assert.match(hero, /href="#inquiry"/);
  assert.match(hero, /href="#opportunities"/);

  const trust = extractSection(html, "trust");
  assert.match(trust, /real local story/i);
  assert.match(trust, /flexible support/i);
  assert.match(trust, /clear approval/i);

  const opportunities = extractSection(html, "opportunities");
  assert.match(opportunities, /Community Sponsor/);
  assert.match(opportunities, /Lead Sponsor/);
  assert.match(opportunities, /Prize (?:&amp;|&) In-Kind Partner/);
  assert.match(opportunities, /opportunity-card--featured/);

  const recognition = extractSection(html, "recognition");
  for (const boundary of ["audience size", "media coverage", "exclusivity", "social reach", "placements"]) {
    assert.match(recognition, new RegExp(boundary, "i"));
  }
  assert.match(recognition, /not guaranteed unless formally agreed/i);

  for (const [name, region] of [["hero", hero], ["trust", trust], ["opportunities", opportunities], ["recognition", recognition]]) {
    assert.doesNotMatch(region, /\$\s*\d|class=["'][^"']*(?:package-price|package-amount|tier-price)[^"']*["']|data-(?:price|amount|package-tier)=/i, `${name} must not publish fixed package pricing`);
  }
});

test("the inquiry form exposes only the approved fields, values, notices, and error targets", () => {
  const html = read("sponsors.html");
  const form = html.match(/<form\b[^>]*data-sponsor-form[^>]*>[\s\S]*?<\/form>/i)?.[0];
  assert.ok(form, "sponsors.html must contain the sponsor inquiry form");
  assert.match(form, /data-sponsor-errors[^>]*role="alert"[^>]*hidden/);
  assert.match(form, /data-sponsor-result[^>]*role="status"[^>]*tabindex="-1"[^>]*hidden/);
  assert.match(form, /data-sponsor-submit/);
  assert.match(form, /<span class="human-check__label" id="sponsor-turnstile-label">Human check/);
  assert.match(form, /<div\b(?=[^>]*\bdata-sponsor-turnstile)(?=[^>]*\btabindex="-1")(?=[^>]*\brole="group")(?=[^>]*\baria-labelledby="sponsor-turnstile-label")(?=[^>]*\baria-describedby="sponsor-turnstile-hint sponsor-turnstile-error")[^>]*>/);
  assert.match(form, /data-sponsor-turnstile-state/);
  assert.match(form, /name="acknowledgementVersion" value="2026\.1"/);

  for (const name of ["contactName", "organization", "email", "phone", "supportType", "contributionRange", "desiredOutcome", "acknowledgementAccepted"]) {
    assert.match(form, new RegExp(`\\bname=["']${name}["']`), `missing ${name}`);
    assert.match(form, new RegExp(`\\bdata-error-for=["']${name}["']`), `missing error target for ${name}`);
  }
  for (const required of ["contactName", "organization", "email", "supportType", "desiredOutcome", "acknowledgementAccepted"]) {
    assert.match(form, new RegExp(`(?:<input|<select|<textarea)\\b(?=[^>]*\\bname=["']${required}["'])(?=[^>]*\\brequired\\b)[^>]*`, "i"), `${required} must be required`);
  }
  for (const name of ["contactName", "organization", "email", "phone", "supportType", "contributionRange", "desiredOutcome", "acknowledgementAccepted"]) {
    const control = form.match(new RegExp(`(?:<input|<select|<textarea)\\b(?=[^>]*\\bname=["']${name}["'])[^>]*`, "i"))?.[0];
    assert.ok(control, `missing ${name} control`);
    assert.match(control, /\bid=["'][^"']+["']/i, `${name} needs an id`);
    assert.match(control, /\baria-describedby=["'][^"']+["']/i, `${name} needs describedby help`);
  }

  const support = form.match(/<select\b(?=[^>]*\bname="supportType")[^>]*>[\s\S]*?<\/select>/i)?.[0] ?? "";
  assert.deepEqual(optionEntries(support), [
    ["", "Choose a support type"],
    ["community", "Community Sponsor"],
    ["lead", "Lead Sponsor"],
    ["prize_in_kind", "Prize & In-Kind Partner"],
    ["other", "Something else"],
  ]);

  const contribution = form.match(/<select\b(?=[^>]*\bname="contributionRange")[^>]*>[\s\S]*?<\/select>/i)?.[0] ?? "";
  assert.deepEqual(optionEntries(contribution), [
    ["", "No range selected"],
    ["not_sure", "Not sure yet"],
    ["under_1000", "Under $1,000"],
    ["1000_2499", "$1,000-$2,499"],
    ["2500_4999", "$2,500-$4,999"],
    ["5000_plus", "$5,000 or more"],
    ["prefer_to_discuss", "Prefer to discuss"],
  ]);
  assert.equal((form.match(/\$\s*\d/g) ?? []).length, (contribution.match(/\$\s*\d/g) ?? []).length, "dollar labels may appear only inside the optional contribution selector");

  assert.match(form, /Submitting this inquiry does not create an agreement, subscribe you to marketing, or authorize publication\./i);
  assert.match(form, /name="acknowledgementAccepted"[\s\S]{0,500}href="\/privacy"/i);
  assert.doesNotMatch(form, /name=["'][^"']*(?:marketing|sms|waiver|upload)[^"']*["']|<input\b[^>]*type=["']file["']/i);
});

test("visible sponsor FAQ answers exactly match FAQPage structured data", () => {
  const html = read("sponsors.html");
  const faq = extractSection(html, "sponsor-faq");
  const visible = [...faq.matchAll(/<details\b[^>]*>\s*<summary>([^<]+)<\/summary>\s*<p>([^<]+)<\/p>\s*<\/details>/gi)]
    .map((match) => ({ question: match[1].trim(), answer: match[2].trim() }));
  assert.equal(visible.length, 5);
  for (const phrase of ["products or services", "flexible", "publication", "follow up", "separate agreement"]) {
    assert.match(visible.map(({ question, answer }) => `${question} ${answer}`).join("\n"), new RegExp(phrase, "i"));
  }

  const approvedSchemaFaq = [
    {
      question: "Can we contribute products or services instead of cash?",
      answer: "Yes. Useful prizes, printing, services, and practical campaign support can be proposed through the inquiry form.",
    },
    {
      question: "Does submitting an inquiry create a sponsorship agreement?",
      answer: "No. The campaign team reviews each inquiry privately. Recognition, deliverables, and publication require a separate agreement.",
    },
  ];

  const scripts = [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)]
    .map((match) => JSON.parse(match[1]));
  const schema = scripts.find((entry) => entry["@type"] === "FAQPage");
  assert.ok(schema, "FAQPage JSON-LD is required");
  const structured = schema.mainEntity.map((entry) => ({
    question: entry.name,
    answer: entry.acceptedAnswer.text,
  }));
  assert.deepEqual(structured, approvedSchemaFaq);
  for (const entity of structured) {
    assert.ok(
      visible.some(({ question, answer }) => question === entity.question && answer === entity.answer),
      `schema FAQ must be rendered verbatim: ${entity.question}`,
    );
  }
  assert.doesNotMatch(JSON.stringify(scripts), /"@type"\s*:\s*"(?:Event|Offer|Review)"|partner|sponsor_inquiries|email|telephone/i);
});

test("the sponsor page contains no public lead data or invented partner claim", () => {
  const html = read("sponsors.html");
  assert.doesNotMatch(html, /@sebahub\.com|@businessasaforceforgood\.ca/i);
  assert.doesNotMatch(html, /sponsor_inquiries|private note|staff_subject/i);
  assert.doesNotMatch(html, /CFCW|radio partner|media partner|impressions|guaranteed reach|exclusive sponsor/i);
});

test("the build allowlist includes the sponsor page", () => {
  assert.match(read("scripts/build.mjs"), /["']sponsors\.html["']/);
});

test("desktop uses the approved stacked sticky header and mobile menus remain explicit", () => {
  const style = read("css/style.css");
  const hunter = read("css/hunter.css");

  for (const css of [style, hunter]) {
    assert.match(css, /--case-strip-height:\s*54px/);
    assert.match(css, /--campaign-nav-height:\s*66px/);
    assert.match(css, /--stacked-header-height:\s*calc\(var\(--case-strip-height\) \+ var\(--campaign-nav-height\)\)/);
    assert.match(css, /scroll-padding-top:\s*var\(--stacked-header-height\)/);
    assert.match(css, /\[id\][^{]*\{[^}]*scroll-margin-top:\s*var\(--stacked-header-height\)/s);
  }

  assert.match(style, /\.case-strip\s*\{[^}]*position:\s*sticky[^}]*top:\s*0[^}]*min-height:\s*var\(--case-strip-height\)/s);
  assert.match(style, /\.case-strip\s*\+\s*\.topbar\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--case-strip-height\)/s);
  assert.match(hunter, /\.hunter-header\s*\{[^}]*position:\s*sticky[^}]*top:\s*var\(--case-strip-height\)/s);
  assert.match(style, /\.validation-environment-notice\s*\{[^}]*position:\s*relative/s);
  assert.match(style, /\.skip-link\s*\{[^}]*z-index:\s*2000/s);

  for (const css of [style, hunter]) {
    assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*--case-strip-height:\s*76px/);
    assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*--campaign-nav-height:\s*58px/);
    assert.match(css, /@media\s*\(max-width:\s*720px\)[\s\S]*\.case-strip__detail\s*\{[^}]*display:\s*none/s);
  }
  assert.match(hunter, /@media\s*\(max-width:\s*720px\)[\s\S]*\.hunter-nav\s*\{[^}]*display:\s*none/s);
  assert.match(hunter, /\.hunter-nav\.open\s*\{[^}]*display:\s*flex/s);
  assert.match(hunter, /@media\s*\(max-width:\s*720px\)[\s\S]*\.menu-toggle\s*\{[^}]*display:\s*inline-flex/s);
});

test("every public page reaches Sponsors from navigation and footer", () => {
  const missing = [];

  for (const name of [
    "index.html", "route.html", "interview.html", "start.html", "dashboard.html",
    "updates.html", "report.html", "rules.html", "privacy.html",
    "community-guidelines.html", "clue-board.html", "sponsors.html"
  ]) {
    if (!fs.existsSync(path.join(root, name))) {
      missing.push(`${name}: page`);
      continue;
    }

    const html = read(name);
    const header = extractRegion(html, "header", name);
    const navigation = extractRegion(header, "nav", `${name} header`);
    const footer = extractRegion(html, "footer", name);

    if (!sponsorLink.test(navigation)) missing.push(`${name}: campaign navigation`);
    if (!sponsorLink.test(footer)) missing.push(`${name}: footer`);

    const headerSponsor = sponsorAnchor(navigation);
    const footerSponsor = sponsorAnchor(footer);
    const expectedHref = ["index.html", "route.html", "interview.html"].includes(name) ? "sponsors.html" : "/sponsors";
    if (!new RegExp(`href=["']${expectedHref.replaceAll("/", "\\/").replace(".", "\\.")}["']`, "i").test(headerSponsor)) {
      missing.push(`${name}: correct Sponsors header destination`);
    }
    if (!/class=["'][^"']*\bnav-sponsors\b[^"']*["']/i.test(headerSponsor)) {
      missing.push(`${name}: gold Sponsors navigation class`);
    }
    if (!new RegExp(`href=["']${expectedHref.replaceAll("/", "\\/").replace(".", "\\.")}["']`, "i").test(footerSponsor)) {
      missing.push(`${name}: correct Sponsors footer destination`);
    }
    if (name === "sponsors.html") {
      if (!/aria-current=["']page["']/i.test(headerSponsor)) missing.push(`${name}: active Sponsors state`);
    } else if (/aria-current=["']page["']/i.test(headerSponsor)) {
      missing.push(`${name}: incorrect active Sponsors state`);
    }
    if (/href=["'][^"']*#sponsor["']/i.test(footer)) missing.push(`${name}: legacy teaser used as primary footer link`);
  }

  assert.deepEqual(missing, [], `missing correctly labelled Sponsors links:\n${missing.join("\n")}`);
});
