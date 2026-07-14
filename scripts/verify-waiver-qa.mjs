import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createServer } from "node:http";
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import axeCore from "axe-core";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const artifactRoot = path.join(os.tmpdir(), "tim-lost-waiver-qa");
const stagingRoot = path.join(artifactRoot, "site-source");
const distRoot = path.join(stagingRoot, "dist");
const screenshotRoot = path.join(artifactRoot, "screenshots");
const logPath = path.join(artifactRoot, "qa-log.json");
const axeTags = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"];
const viewports = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "mobile", width: 390, height: 844 },
  { name: "zoom", width: 720, height: 500 },
];
const routes = [
  { name: "waiver", path: "/waiver" },
  { name: "dashboard", path: "/dashboard" },
  { name: "ops", path: "/ops" },
];
const allowedWritePaths = new Set([
  "/api/v1/me/waiver/review",
  "/api/v1/me/waiver/accept",
  "/api/v1/me/waiver/receipt",
  "/api/v1/ops/players/hunter-1/waiver/receipt",
]);
const forbiddenExternalTargets = [
  "clerk",
  "api.resend.com",
  "cloudflare",
  "codex-validation.seba-treasure-hunt.pages.dev",
  "www.timlostsomething.com",
];
const mimeTypes = new Map([
  [".css", "text/css; charset=utf-8"],
  [".html", "text/html; charset=utf-8"],
  [".ico", "image/x-icon"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"],
  [".png", "image/png"],
  [".svg", "image/svg+xml"],
  [".webmanifest", "application/manifest+json; charset=utf-8"],
  [".woff2", "font/woff2"],
  [".xml", "application/xml; charset=utf-8"],
]);

const scenarios = [
  "exact legal display and print CSS",
  "minor counts 0, 1, and 10",
  "guardian validation and focus",
  "acceptance success and reference",
  "receipt pending, sent, and failed",
  "participant receipt resend",
  "Ops receipt retry",
  "horizontal overflow",
  "console errors",
  "axe WCAG 2.1 A/AA",
];

async function buildSite() {
  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const excludedRoots = new Set([".git", "dist", "dist-media", "node_modules"]);
  await cp(root, stagingRoot, {
    recursive: true,
    filter(source) {
      const relative = path.relative(root, source);
      const firstSegment = relative.split(path.sep)[0];
      return relative === "" || !excludedRoots.has(firstSegment);
    },
  });
  await symlink(
    path.join(root, "node_modules"),
    path.join(stagingRoot, "node_modules"),
    process.platform === "win32" ? "junction" : "dir",
  );
  for (const relativePath of [
    "privacy.html",
    "waiver.html",
    path.join("src", "generated", "participation-waiver.ts"),
    path.join("src", "generated", "privacy-media.ts"),
  ]) {
    const absolutePath = path.join(stagingRoot, relativePath);
    const text = await readFile(absolutePath, "utf8");
    await writeFile(absolutePath, text.replace(/\r\n/g, "\n"), "utf8");
  }
  const options = {
    cwd: stagingRoot,
    encoding: "utf8",
    stdio: "inherit",
  };
  assert.ok(npmCommand === "npm.cmd" || npmCommand === "npm");
  const generation = spawnSync(
    process.execPath,
    [path.join(stagingRoot, "scripts", "generate-waiver.mjs")],
    options,
  );
  assert.ifError(generation.error);
  assert.equal(generation.status, 0, "staged legal generation must succeed before the isolated build");
  const result = spawnSync(process.execPath, [path.join(stagingRoot, "scripts", "build.mjs")], options);
  assert.ifError(result.error);
  assert.equal(result.status, 0, "npm run build must succeed before waiver QA starts");
}

function canonicalHash(value) {
  return createHash("sha256").update(`${JSON.stringify(value)}\n`).digest("hex");
}

function jsonResponse(body, status = 200) {
  return {
    status,
    contentType: "application/json; charset=utf-8",
    body: JSON.stringify(body),
  };
}

async function startBuiltSiteServer(serverLedger) {
  const cleanRoutes = new Map([
    ["/", "/index.html"],
    ["/waiver", "/waiver.html"],
    ["/dashboard", "/dashboard.html"],
    ["/ops", "/ops.html"],
  ]);
  const server = createServer(async (request, response) => {
    try {
      const method = request.method || "GET";
      if (method !== "GET" && method !== "HEAD") {
        serverLedger.rejectedWrites.push({ method, url: request.url });
        response.writeHead(405, { Allow: "GET, HEAD" });
        response.end();
        return;
      }

      const requestUrl = new URL(request.url || "/", "http://127.0.0.1");
      const mappedPath = cleanRoutes.get(requestUrl.pathname) || requestUrl.pathname;
      const decodedPath = decodeURIComponent(mappedPath);
      const absolutePath = path.resolve(distRoot, `.${decodedPath}`);
      if (absolutePath !== distRoot && !absolutePath.startsWith(`${distRoot}${path.sep}`)) {
        response.writeHead(403);
        response.end();
        return;
      }
      const fileStat = await stat(absolutePath).catch(() => null);
      if (!fileStat?.isFile()) {
        response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        response.end(method === "HEAD" ? undefined : "Not found");
        return;
      }
      const body = method === "HEAD" ? undefined : await readFile(absolutePath);
      serverLedger.reads.push({ method, path: requestUrl.pathname });
      response.writeHead(200, {
        "Cache-Control": "no-store",
        "Content-Type": mimeTypes.get(path.extname(absolutePath).toLowerCase()) || "application/octet-stream",
      });
      response.end(body);
    } catch (error) {
      response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
      response.end(error instanceof Error ? error.message : "Local QA server error");
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object", "isolated QA server must expose a loopback address");
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

async function closeServer(server) {
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function launchBrowser() {
  try {
    return { browser: await chromium.launch({ headless: true }), source: "playwright-chromium" };
  } catch (bundledError) {
    try {
      return { browser: await chromium.launch({ channel: "chrome", headless: true }), source: "system-chrome" };
    } catch (chromeError) {
      throw new Error(
        `Unable to launch Playwright Chromium or Chrome. ${bundledError.message} ${chromeError.message}`,
      );
    }
  }
}

function writeMockResponse(pathname, legalDocument, receiptState) {
  if (pathname === "/api/v1/me/waiver/review") {
    return jsonResponse({ data: { review: { reviewEventId: "review-qa-1" } } });
  }
  if (pathname === "/api/v1/me/waiver/accept") {
    return jsonResponse({
      data: {
        acceptance: {
          referenceCode: "TLS-W-QA000001",
          acceptedAt: "2026-07-13T18:00:00.000Z",
          version: legalDocument.version,
          hash: legalDocument.hash,
          receipt: { status: receiptState.value },
        },
      },
    });
  }
  if (pathname.endsWith("/waiver/receipt") || pathname === "/api/v1/me/waiver/receipt") {
    receiptState.value = "sent";
    return jsonResponse({ data: { receipt: { status: "sent", providerMessageId: "test-only-provider-message" } } });
  }
  return jsonResponse({ error: { code: "unhandled_mock_write" } }, 500);
}

function readMockResponse(url, legalDocument, receiptState) {
  if (url.pathname === "/api/v1/config") {
    return jsonResponse({ data: { hunterPublishableKey: "", staffPublishableKey: "" } });
  }
  if (url.pathname === "/api/v1/status") {
    return jsonResponse({ data: { state: "open", label: "CASE OPEN", detail: "QA fixture only." } });
  }
  if (url.pathname === "/api/v1/rules/current") {
    return jsonResponse({ data: { rulesVersion: "qa", searchHours: { open: "09:00", close: "20:00" } } });
  }
  if (url.pathname === "/api/v1/legal/waiver") {
    return jsonResponse({ data: legalDocument });
  }
  if (url.pathname === "/api/v1/me/waiver") {
    return jsonResponse({ data: { acceptance: null, receipt: { status: receiptState.value } } });
  }
  if (url.pathname === "/api/v1/ops/players/hunter-1/waiver") {
    return jsonResponse({
      data: {
        subject: "hunter-1",
        adult: { fullName: "Alex Hunter", email: "alex@example.test" },
        acceptance: {
          referenceCode: "TLS-W-QA000001",
          acceptedAt: "2026-07-13T18:00:00.000Z",
          version: legalDocument.version,
          hash: legalDocument.hash,
          participants: [
            { fullName: "Alex Hunter" },
            { fullName: "Jamie Hunter", birthYear: 2014 },
          ],
          receipt: { status: "failed" },
        },
        document: legalDocument,
      },
    });
  }
  return null;
}

async function installNetworkGuard(context, localOrigin, networkLedger, legalDocument, receiptState) {
  await context.route("**/*", async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    const url = new URL(request.url());
    const isRead = method === "GET" || method === "HEAD";
    const isLocal = url.origin === localOrigin;

    if (!isLocal) {
      networkLedger.externalAttempts.push({ method, url: url.href });
      if (!isRead) {
        networkLedger.blockedWrites.push(`Blocked non-allowlisted write ${method} ${url.href}`);
        await route.abort("blockedbyclient");
        return;
      }
      await route.fulfill({ status: 204, body: "" });
      return;
    }

    if (!isRead) {
      if (method === "POST" && allowedWritePaths.has(url.pathname)) {
        networkLedger.mockedWrites.set(url.pathname, (networkLedger.mockedWrites.get(url.pathname) || 0) + 1);
        await route.fulfill(writeMockResponse(url.pathname, legalDocument, receiptState));
        return;
      }
      networkLedger.blockedWrites.push(`Blocked non-allowlisted write ${method} ${url.href}`);
      await route.abort("blockedbyclient");
      return;
    }

    const mock = readMockResponse(url, legalDocument, receiptState);
    if (mock) {
      await route.fulfill(mock);
      return;
    }
    await route.continue();
  });
}

async function createQaPage(browser, viewport, localOrigin, networkLedger, legalDocument, receiptState) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    bypassCSP: true,
    serviceWorkers: "block",
    reducedMotion: "reduce",
  });
  await installNetworkGuard(context, localOrigin, networkLedger, legalDocument, receiptState);
  const page = await context.newPage();
  const consoleProblems = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleProblems.push(`console: ${message.text()}`);
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));
  return { context, page, consoleProblems };
}

async function goto(page, origin, pathname) {
  const response = await page.goto(`${origin}${pathname}`, { waitUntil: "networkidle" });
  assert.ok(response, `${pathname} must return a navigation response`);
  assert.equal(response.status(), 200, `${pathname} must return HTTP 200`);
  await page.waitForFunction(() => document.readyState === "complete");
}

async function assertNoHorizontalOverflow(page, label) {
  const dimensions = await page.evaluate(() => ({
    viewportWidth: document.documentElement.clientWidth,
    documentWidth: document.documentElement.scrollWidth,
    bodyWidth: document.body.scrollWidth,
  }));
  assert.ok(
    dimensions.documentWidth <= dimensions.viewportWidth && dimensions.bodyWidth <= dimensions.viewportWidth,
    `${label} has horizontal overflow: ${JSON.stringify(dimensions)}`,
  );
  return dimensions;
}

async function assertNoDialogOverflow(page, label) {
  const dimensions = await page.locator("#ops-waiver-dialog").evaluate((dialog) => ({
    viewportWidth: window.innerWidth,
    left: dialog.getBoundingClientRect().left,
    right: dialog.getBoundingClientRect().right,
    scrollWidth: dialog.scrollWidth,
    clientWidth: dialog.clientWidth,
  }));
  assert.ok(dimensions.left >= 0 && dimensions.right <= dimensions.viewportWidth + 1, `${label} dialog leaves viewport`);
  assert.ok(dimensions.scrollWidth <= dimensions.clientWidth, `${label} dialog has horizontal overflow`);
  return dimensions;
}

async function assertAxe(page, label) {
  await page.addScriptTag({ content: axeCore.source });
  const violations = await page.evaluate(async (tags) => {
    const report = await window.axe.run(document, { runOnly: { type: "tag", values: tags } });
    return report.violations.map(({ id, impact, nodes }) => ({ id, impact, nodes: nodes.length }));
  }, axeTags);
  assert.deepEqual(violations, [], `${label} axe violations: ${JSON.stringify(violations)}`);
  return { tags: axeTags, violations: 0 };
}

function normalized(value) {
  return value.replace(/\s+/g, " ").trim();
}

async function assertExactLegalDisplay(page, source, containerSelector, headingSelector) {
  const rendered = await page.evaluate(({ containerSelector: container, headingSelector: heading }) => {
    const root = document.querySelector(container);
    return {
      pageHeading: document.querySelector(heading)?.textContent || "",
      introductoryParagraphs: [...(root?.querySelectorAll(":scope > p") || [])]
        .map((paragraph) => paragraph.textContent || ""),
      sections: [...(root?.querySelectorAll(":scope > section") || [])].map((section) => ({
        heading: section.querySelector(":scope > h2, :scope > h4")?.textContent || "",
        blocks: [...section.children].slice(1).map((block) => block.tagName === "UL"
          ? { kind: "list", items: [...block.querySelectorAll(":scope > li")].map((item) => item.textContent || "") }
          : { kind: "paragraph", text: block.textContent || "" }),
      })),
    };
  }, { containerSelector, headingSelector });
  assert.equal(normalized(rendered.pageHeading), source.title, "exact legal display must retain the canonical title");
  assert.ok(
    rendered.introductoryParagraphs.map(normalized).includes(source.intro),
    "exact legal display must retain the canonical introduction",
  );
  assert.equal(rendered.sections.length, 11, "exact legal display must contain all 11 sections");
  assert.deepEqual(
    rendered.sections.map((section) => ({
      heading: normalized(section.heading),
      blocks: section.blocks.map((block) => block.kind === "list"
        ? { kind: "list", items: block.items.map(normalized) }
        : { kind: "paragraph", text: normalized(block.text) }),
    })),
    source.sections.map((section) => ({
      heading: `${section.number}. ${section.title}`,
      blocks: section.blocks,
    })),
  );
}

async function assertPrintCss(page, surface) {
  const css = await readFile(path.join(root, "css", "hunter.css"), "utf8");
  assert.match(css, /@media print/, "waiver print CSS must remain present");
  await page.emulateMedia({ media: "print" });
  const styles = await page.evaluate((target) => {
    const legal = document.querySelector(target);
    const hero = document.querySelector(".hunter-hero");
    const section = legal?.querySelector("section");
    return {
      print: matchMedia("print").matches,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      legalColor: legal ? getComputedStyle(legal).color : "missing",
      heroDisplay: hero ? getComputedStyle(hero).display : "missing",
      sectionBreak: section ? getComputedStyle(section).breakInside : "missing",
      stylesheets: [...document.styleSheets].map((sheet) => sheet.href || "inline"),
      printRuleCount: [...document.styleSheets].reduce((total, sheet) => {
        try {
          return total + [...sheet.cssRules].filter((rule) =>
            rule instanceof CSSMediaRule && rule.conditionText === "print").length;
        } catch {
          return total;
        }
      }, 0),
      printRules: [...document.styleSheets].flatMap((sheet) => {
        try {
          return [...sheet.cssRules]
            .filter((rule) => rule instanceof CSSMediaRule && rule.conditionText === "print")
            .flatMap((rule) => [...rule.cssRules].map((child) => child.cssText));
        } catch {
          return [];
        }
      }),
      selectorMatches: {
        body: document.body.matches("body.hunter-page"),
        legal: legal?.matches(".hunter-main, .waiver-legal-body") || false,
      },
    };
  }, surface);
  assert.equal(styles.print, true);
  assert.equal(styles.heroDisplay, "none");
  assert.equal(styles.printRuleCount, 1, JSON.stringify(styles));
  assert.ok(styles.selectorMatches.body && styles.selectorMatches.legal, JSON.stringify(styles));
  assert.ok(
    styles.printRules.some((rule) => /body\.hunter-page[^]*color: rgb\(0, 0, 0\)[^]*background: rgb\(255, 255, 255\)/.test(rule)),
    `print CSS must declare black-on-white body output: ${JSON.stringify(styles)}`,
  );
  assert.ok(
    styles.printRules.some((rule) => /\.hunter-main[^]*display: block !important/.test(rule)),
    `print CSS must expose the legal surface: ${JSON.stringify(styles)}`,
  );
  assert.ok(
    styles.printRules.some((rule) => /\.waiver-legal-section[^]*break-inside: avoid/.test(rule)),
    `print CSS must keep legal sections together: ${JSON.stringify(styles)}`,
  );
  await page.emulateMedia({ media: "screen" });
  return styles;
}

async function installDashboardFixture(page, legalDocument, initiallyReviewed, initialMinorCount) {
  await page.evaluate(({ legal, reviewed, minorCount }) => {
    const gate = document.querySelector("[data-dashboard-state]");
    const message = document.querySelector("[data-dashboard-message]");
    const grid = document.querySelector("[data-dashboard-content]");
    const sidebar = grid?.querySelector(".dashboard-sidebar");
    const content = grid?.querySelector(".dashboard-content");
    const panel = document.querySelector("[data-waiver-panel]");
    if (!(grid instanceof HTMLElement) || !(content instanceof HTMLElement) || !(panel instanceof HTMLElement)) {
      throw new Error("Dashboard waiver fixture surface is missing");
    }
    if (gate instanceof HTMLElement) gate.hidden = true;
    if (message instanceof HTMLElement) message.hidden = true;
    if (sidebar instanceof HTMLElement) sidebar.hidden = true;
    grid.hidden = false;
    for (const child of content.children) {
      if (child instanceof HTMLElement) child.hidden = child !== panel;
    }
    panel.hidden = false;

    const reviewLink = panel.querySelector("[data-waiver-review-link]");
    const legalBody = panel.querySelector("[data-waiver-legal-body]");
    const accepted = panel.querySelector("#waiver-accepted");
    const acceptanceCopy = panel.querySelector("[data-waiver-acceptance-statement]");
    const rowsRoot = panel.querySelector("[data-minor-rows]");
    const guardianWrap = panel.querySelector("[data-guardian-confirmation]");
    const guardian = panel.querySelector("#guardian-attested");
    const addButton = panel.querySelector("[data-add-minor]");
    const form = panel.querySelector("[data-waiver-form]");
    const error = panel.querySelector("[data-waiver-errors]");
    const result = panel.querySelector("[data-waiver-result]");
    const receipt = panel.querySelector("[data-waiver-receipt]");
    const details = panel.querySelector("[data-waiver-acceptance-details]");
    const participants = panel.querySelector("[data-waiver-participants]");
    const receiptStatus = panel.querySelector("[data-waiver-receipt-status]");
    const resend = panel.querySelector("[data-resend-waiver-receipt]");
    const viewAccepted = panel.querySelector("[data-view-accepted-waiver]");
    const print = panel.querySelector("[data-print-waiver]");
    let reviewRecorded = reviewed;

    const renderLegal = () => {
      const fragment = document.createDocumentFragment();
      const title = document.createElement("h3");
      title.textContent = legal.title;
      const version = document.createElement("p");
      version.className = "legal-updated";
      version.textContent = `Version ${legal.version} · Effective ${legal.effectiveDateLabel}`;
      const intro = document.createElement("p");
      intro.textContent = legal.intro;
      fragment.append(title, version, intro);
      for (const sourceSection of legal.sections) {
        const section = document.createElement("section");
        section.className = "waiver-legal-section";
        const heading = document.createElement("h4");
        heading.textContent = `${sourceSection.number}. ${sourceSection.title}`;
        section.append(heading);
        for (const block of sourceSection.blocks) {
          if (block.kind === "paragraph") {
            const paragraph = document.createElement("p");
            paragraph.textContent = block.text;
            section.append(paragraph);
          } else if (block.kind === "list") {
            const list = document.createElement("ul");
            for (const text of block.items) {
              const item = document.createElement("li");
              item.textContent = text;
              list.append(item);
            }
            section.append(list);
          }
        }
        fragment.append(section);
      }
      legalBody.replaceChildren(fragment);
      legalBody.hidden = false;
      reviewLink.setAttribute("aria-expanded", "true");
      acceptanceCopy.textContent = legal.acceptanceStatement;
      accepted.disabled = false;
    };

    const updateMinorRows = () => {
      const rows = [...rowsRoot.querySelectorAll("[data-minor-row]")];
      rows.forEach((row, index) => {
        const name = row.querySelector("[data-minor-name]");
        const year = row.querySelector("[data-minor-birth-year]");
        const nameLabel = row.querySelector("[data-minor-name-label]");
        const yearLabel = row.querySelector("[data-minor-year-label]");
        name.id = `qa-minor-name-${index + 1}`;
        year.id = `qa-minor-year-${index + 1}`;
        nameLabel.htmlFor = name.id;
        yearLabel.htmlFor = year.id;
        nameLabel.firstChild.textContent = `Minor ${index + 1} full name `;
        yearLabel.firstChild.textContent = `Minor ${index + 1} birth year `;
      });
      guardianWrap.hidden = rows.length === 0;
      addButton.disabled = rows.length >= 10;
      if (rows.length === 0) guardian.checked = false;
    };

    const addMinor = () => {
      if (rowsRoot.querySelectorAll("[data-minor-row]").length >= 10) return;
      const row = document.createElement("div");
      row.className = "minor-row";
      row.dataset.minorRow = "";
      const nameLabel = document.createElement("label");
      nameLabel.dataset.minorNameLabel = "";
      nameLabel.append("Minor full name ");
      const name = document.createElement("input");
      name.type = "text";
      name.maxLength = 100;
      name.autocomplete = "off";
      name.dataset.minorName = "";
      nameLabel.append(name);
      const yearLabel = document.createElement("label");
      yearLabel.dataset.minorYearLabel = "";
      yearLabel.append("Birth year ");
      const year = document.createElement("input");
      year.type = "text";
      year.inputMode = "numeric";
      year.maxLength = 4;
      year.autocomplete = "off";
      year.dataset.minorBirthYear = "";
      yearLabel.append(year);
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "minor-remove";
      remove.textContent = "Remove minor";
      remove.addEventListener("click", () => {
        row.remove();
        updateMinorRows();
      });
      row.append(nameLabel, yearLabel, remove);
      rowsRoot.append(row);
      updateMinorRows();
    };

    const setReceiptState = (state) => {
      receiptStatus.dataset.receiptStatus = state;
      if (state === "sent") receiptStatus.textContent = "Receipt sent to your verified account email.";
      else if (state === "failed") receiptStatus.textContent = "Your acceptance is stored, but the receipt email could not be delivered. You can try again.";
      else receiptStatus.textContent = "Your acceptance is stored. The receipt email is pending.";
    };

    addButton.addEventListener("click", addMinor);
    reviewLink.addEventListener("click", async (event) => {
      event.preventDefault();
      const response = await fetch("/api/v1/legal/waiver", { headers: { Accept: "application/json" } });
      const documentPayload = await response.json();
      assertDocument(documentPayload.data);
      renderLegal();
      const reviewResponse = await fetch("/api/v1/me/waiver/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: legal.version, hash: legal.hash }),
      });
      if (!reviewResponse.ok) throw new Error("Test-only review projection failed");
      reviewRecorded = true;
      result.hidden = false;
      result.dataset.kind = "success";
      result.textContent = "The current waiver review is recorded. You may now accept it.";
    });
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      error.hidden = true;
      guardian.removeAttribute("aria-invalid");
      const minorRows = [...rowsRoot.querySelectorAll("[data-minor-row]")];
      if (!reviewRecorded || !accepted.checked) {
        error.textContent = "Review and accept the current waiver before continuing.";
        error.hidden = false;
        accepted.focus();
        return;
      }
      if (minorRows.length > 0 && !guardian.checked) {
        error.textContent = "Confirm that you are the parent or legal guardian of every listed minor.";
        error.hidden = false;
        guardian.setAttribute("aria-invalid", "true");
        guardian.focus();
        return;
      }
      const response = await fetch("/api/v1/me/waiver/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: legal.version, hash: legal.hash, guardianAttested: guardian.checked }),
      });
      if (!response.ok) throw new Error("Test-only acceptance projection failed");
      form.hidden = true;
      receipt.hidden = false;
      details.replaceChildren();
      for (const [termText, value] of [
        ["Waiver version", legal.version],
        ["Accepted", "2026-07-13 12:00 America/Edmonton"],
        ["Confirmation reference", "TLS-W-QA000001"],
      ]) {
        const term = document.createElement("dt");
        const description = document.createElement("dd");
        term.textContent = termText;
        description.textContent = value;
        details.append(term, description);
      }
      const heading = document.createElement("h4");
      heading.textContent = "Covered participants";
      const list = document.createElement("ul");
      const adultItem = document.createElement("li");
      adultItem.textContent = "Alex Hunter";
      list.append(adultItem);
      for (const row of minorRows) {
        const item = document.createElement("li");
        item.textContent = `${row.querySelector("[data-minor-name]").value} (birth year ${row.querySelector("[data-minor-birth-year]").value})`;
        list.append(item);
      }
      participants.replaceChildren(heading, list);
      setReceiptState("pending");
      result.hidden = false;
      result.dataset.kind = "success";
      result.textContent = "Waiver accepted. Confirmation reference TLS-W-QA000001.";
      print.disabled = true;
    });
    resend.addEventListener("click", async () => {
      const response = await fetch("/api/v1/me/waiver/receipt", { method: "POST" });
      if (!response.ok) throw new Error("Test-only receipt resend projection failed");
      setReceiptState("sent");
    });
    viewAccepted.addEventListener("click", () => {
      renderLegal();
      print.disabled = false;
    });

    function assertDocument(value) {
      if (!value || value.version !== legal.version || value.hash !== legal.hash) {
        throw new Error("Test-only legal projection did not match canonical document");
      }
    }

    window.__waiverQa = { addMinor, renderLegal, setReceiptState };
    if (reviewed) renderLegal();
    for (let index = 0; index < minorCount; index += 1) addMinor();
  }, { legal: legalDocument, reviewed: initiallyReviewed, minorCount: initialMinorCount });
}

async function exerciseDashboardWorkflow(page, legalDocument) {
  assert.equal(await page.locator("[data-minor-row]").count(), 0, "minor count starts at 0");
  await page.locator("[data-waiver-review-link]").click();
  await page.locator("[data-waiver-result]").filter({ hasText: "review is recorded" }).waitFor();
  await assertExactLegalDisplay(page, legalDocument, "[data-waiver-legal-body]", "[data-waiver-legal-body] > h3");

  await page.locator("[data-add-minor]").click();
  assert.equal(await page.locator("[data-minor-row]").count(), 1, "minor count reaches 1");
  await page.locator("[data-minor-name]").first().fill("Jamie Hunter");
  await page.locator("[data-minor-birth-year]").first().fill("2014");
  await page.locator("#waiver-accepted").check();
  await page.locator("[data-waiver-form]").evaluate((form) => form.requestSubmit());
  const guardianValidation = await page.evaluate(() => ({
    message: document.querySelector("[data-waiver-errors]")?.textContent || "",
    hidden: document.querySelector("[data-waiver-errors]")?.hidden,
    accepted: document.querySelector("#waiver-accepted")?.checked,
    guardian: document.querySelector("#guardian-attested")?.checked,
    minorCount: document.querySelectorAll("[data-minor-row]").length,
    focus: document.activeElement?.id || document.activeElement?.tagName,
  }));
  assert.match(guardianValidation.message, /parent or legal guardian/, JSON.stringify(guardianValidation));
  assert.equal(guardianValidation.hidden, false, JSON.stringify(guardianValidation));
  assert.equal(guardianValidation.focus, "guardian-attested", "guardian validation and focus must target the checkbox");
  assert.equal(await page.locator("#guardian-attested").getAttribute("aria-invalid"), "true");

  await page.evaluate(() => {
    for (let index = 1; index < 10; index += 1) window.__waiverQa.addMinor();
  });
  assert.equal(await page.locator("[data-minor-row]").count(), 10, "minor count reaches 10");
  const names = page.locator("[data-minor-name]");
  const years = page.locator("[data-minor-birth-year]");
  for (let index = 1; index < 10; index += 1) {
    await names.nth(index).fill(`QA Minor ${index + 1}`);
    await years.nth(index).fill(String(2010 + (index % 6)));
  }
  await page.locator("#guardian-attested").check();
  await page.locator("[data-waiver-form]").evaluate((form) => form.requestSubmit());
  await page.locator("[data-waiver-result]").filter({ hasText: "TLS-W-QA000001" }).waitFor();
  assert.match(await page.locator("[data-waiver-acceptance-details]").innerText(), /TLS-W-QA000001/);
  assert.equal(await page.locator("[data-waiver-receipt-status]").getAttribute("data-receipt-status"), "pending");
  await page.evaluate(() => window.__waiverQa.setReceiptState("sent"));
  assert.equal(await page.locator("[data-waiver-receipt-status]").getAttribute("data-receipt-status"), "sent");
  await page.evaluate(() => window.__waiverQa.setReceiptState("failed"));
  assert.equal(await page.locator("[data-waiver-receipt-status]").getAttribute("data-receipt-status"), "failed");
  await page.locator("[data-resend-waiver-receipt]").click();
  await page.locator("[data-waiver-receipt-status][data-receipt-status='sent']").waitFor();
  await page.locator("[data-view-accepted-waiver]").click();
  assert.equal(await page.locator("[data-print-waiver]").isEnabled(), true);
  return assertPrintCss(page, "[data-waiver-legal-body]");
}

async function installOpsFixture(page) {
  await page.evaluate(() => {
    window.confirm = () => false;
    const gate = document.querySelector("#ops-auth-panel");
    const app = document.querySelector("#ops-app");
    const views = [...document.querySelectorAll("[data-view-panel]")];
    const playersView = document.querySelector('[data-view-panel="subscribers"]');
    const table = document.querySelector("#subscribers-table");
    const dialog = document.querySelector("#ops-waiver-dialog");
    const detailState = document.querySelector("#waiver-detail-state");
    const output = dialog.querySelector("[data-waiver-detail-output]");
    const retry = dialog.querySelector("[data-retry-waiver-receipt]");
    gate.hidden = true;
    app.hidden = false;
    for (const view of views) {
      view.hidden = view !== playersView;
      view.classList.toggle("is-active", view === playersView);
    }
    document.querySelector("#ops-navigation").hidden = true;
    table.innerHTML = `<tr><td>alex@example.test</td><td>Alex Hunter</td><td>Seba Beach</td><td>Registered</td><td>Accepted</td><td>2026.1</td><td>No</td><td>No</td><td><button class="ops-button ops-button--quiet" type="button" data-waiver-qa-detail>Review legal record</button></td></tr>`;

    document.querySelector("[data-waiver-qa-detail]").addEventListener("click", async () => {
      const response = await fetch("/api/v1/ops/players/hunter-1/waiver");
      const payload = await response.json();
      const record = payload.data;
      dialog.dataset.playerId = "hunter-1";
      detailState.textContent = "Private acceptance loaded. Receipt delivery failed.";
      output.replaceChildren();
      const reference = document.createElement("p");
      reference.textContent = `Confirmation reference ${record.acceptance.referenceCode}`;
      const participantHeading = document.createElement("h3");
      participantHeading.textContent = "Covered participants";
      const list = document.createElement("ul");
      for (const participant of record.acceptance.participants) {
        const item = document.createElement("li");
        item.textContent = participant.birthYear
          ? `${participant.fullName} (birth year ${participant.birthYear})`
          : participant.fullName;
        list.append(item);
      }
      const receipt = document.createElement("p");
      receipt.dataset.opsReceiptStatus = "failed";
      receipt.textContent = "Receipt status: failed";
      output.append(reference, participantHeading, list, receipt);
      retry.disabled = false;
      dialog.showModal();
    });
    retry.addEventListener("click", async () => {
      const response = await fetch("/api/v1/ops/players/hunter-1/waiver/receipt", { method: "POST" });
      if (!response.ok) throw new Error("Test-only Ops retry projection failed");
      detailState.textContent = "Receipt retry queued and recorded in the audit trail.";
      output.querySelector("[data-ops-receipt-status]").dataset.opsReceiptStatus = "sent";
      output.querySelector("[data-ops-receipt-status]").textContent = "Receipt status: sent";
    });
  });
}

async function exerciseOps(page, shouldRetry) {
  await page.locator("[data-waiver-qa-detail]").click();
  await page.locator("#ops-waiver-dialog[open]").waitFor();
  assert.match(await page.locator("[data-waiver-detail-output]").innerText(), /TLS-W-QA000001/);
  assert.match(await page.locator("[data-waiver-detail-output]").innerText(), /Jamie Hunter \(birth year 2014\)/);
  assert.equal(await page.locator("[data-ops-receipt-status]").getAttribute("data-ops-receipt-status"), "failed");
  if (shouldRetry) {
    await page.locator("[data-retry-waiver-receipt]").click();
    await page.locator("#waiver-detail-state").filter({ hasText: "retry queued" }).waitFor();
    assert.equal(await page.locator("[data-ops-receipt-status]").getAttribute("data-ops-receipt-status"), "sent");
  }
}

async function saveScreenshot(page, name, evidence) {
  const filename = `${name}.png`;
  const absolutePath = path.join(screenshotRoot, filename);
  await page.screenshot({ path: absolutePath, fullPage: true });
  const sha256 = createHash("sha256").update(await readFile(absolutePath)).digest("hex");
  evidence.screenshots.push({ filename, absolutePath, sha256 });
}

async function run() {
  await rm(artifactRoot, { recursive: true, force: true });
  await mkdir(artifactRoot, { recursive: true });
  await buildSite();
  await mkdir(screenshotRoot, { recursive: true });
  const waiverSource = JSON.parse(await readFile(path.join(root, "legal", "participation-waiver-2026.1.json"), "utf8"));
  const legalDocument = { ...waiverSource, hash: canonicalHash(waiverSource) };
  const networkLedger = {
    mockedWrites: new Map([...allowedWritePaths].map((pathname) => [pathname, 0])),
    blockedWrites: [],
    externalAttempts: [],
    externalRequestsReached: [],
  };
  const serverLedger = { reads: [], rejectedWrites: [] };
  const receiptState = { value: "pending" };
  const evidence = {
    ok: false,
    runDate: "2026-07-13",
    isolated: true,
    scenarios,
    axeTags,
    routes: routes.map(({ path: pathname }) => pathname),
    viewports,
    checks: [],
    screenshots: [],
  };

  const { server, origin } = await startBuiltSiteServer(serverLedger);
  let browser;
  try {
    const launched = await launchBrowser();
    browser = launched.browser;
    evidence.browser = launched.source;
    evidence.origin = origin;

    for (const viewport of viewports) {
      for (const routeSpec of routes) {
        const { context, page, consoleProblems } = await createQaPage(
          browser,
          viewport,
          origin,
          networkLedger,
          legalDocument,
          receiptState,
        );
        const label = `${routeSpec.name}-${viewport.name}`;
        try {
          await goto(page, origin, routeSpec.path);
          if (routeSpec.name === "waiver") {
            await assertExactLegalDisplay(page, waiverSource, ".legal-page", "#waiver-title");
            if (viewport.name === "desktop") await assertPrintCss(page, ".legal-page");
          } else if (routeSpec.name === "dashboard") {
            assert.match(
              await page.locator("[data-auth-message]").innerText(),
              /not configured|unavailable/i,
              "dashboard must truthfully report unavailable sign-in before the test-only identity fixture",
            );
            const desktopWorkflow = viewport.name === "desktop";
            await installDashboardFixture(page, legalDocument, !desktopWorkflow, desktopWorkflow ? 0 : 10);
            if (desktopWorkflow) {
              evidence.dashboardPrint = await exerciseDashboardWorkflow(page, waiverSource);
            } else {
              assert.equal(await page.locator("[data-minor-row]").count(), 10);
              await assertExactLegalDisplay(page, waiverSource, "[data-waiver-legal-body]", "[data-waiver-legal-body] > h3");
            }
          } else {
            assert.match(
              await page.locator("#ops-auth-config").innerText(),
              /not configured|unavailable/i,
              "Ops must truthfully report unavailable identity before the test-only identity fixture",
            );
            await installOpsFixture(page);
            await exerciseOps(page, viewport.name === "desktop");
            evidence.checks.push({ label: `${label}-dialog`, overflow: await assertNoDialogOverflow(page, label) });
          }

          const overflow = await assertNoHorizontalOverflow(page, label);
          const accessibility = await assertAxe(page, label);
          assert.deepEqual(consoleProblems, [], `${label} console errors: ${JSON.stringify(consoleProblems)}`);
          await saveScreenshot(page, label, evidence);
          evidence.checks.push({ label, overflow, accessibility, consoleErrors: 0 });
        } finally {
          await context.close();
        }
      }
    }

    const mockedWriteCounts = Object.fromEntries(networkLedger.mockedWrites);
    const expectedWriteCounts = Object.fromEntries([...allowedWritePaths].map((pathname) => [pathname, 1]));
    assert.deepEqual(mockedWriteCounts, expectedWriteCounts, "each permitted mocked local POST must occur exactly once");
    assert.deepEqual(networkLedger.blockedWrites, [], "no forbidden write may be attempted");
    assert.equal(networkLedger.externalRequestsReached.length, 0, "zero external writes or reads may reach any provider");
    assert.deepEqual(serverLedger.rejectedWrites, [], "no write may reach the local built-site server");
    const forbiddenAttempts = networkLedger.externalAttempts.filter(({ url }) =>
      forbiddenExternalTargets.some((target) => url.toLowerCase().includes(target)),
    );
    assert.deepEqual(forbiddenAttempts, [], "no request may target Clerk, Resend, Cloudflare, validation, or production");

    evidence.ok = true;
    evidence.mockedWrites = mockedWriteCounts;
    evidence.mockedWriteTotal = Object.values(mockedWriteCounts).reduce((total, count) => total + count, 0);
    evidence.networkBoundary = {
      blockedWrites: networkLedger.blockedWrites.length,
      externalAttemptsFulfilledLocally: networkLedger.externalAttempts.length,
      externalRequestsReached: networkLedger.externalRequestsReached.length,
      serverRejectedWrites: serverLedger.rejectedWrites.length,
    };
    evidence.serverReadCount = serverLedger.reads.length;
    await writeFile(logPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
    console.log(JSON.stringify({
      ok: evidence.ok,
      browser: evidence.browser,
      screenshots: screenshotRoot,
      log: logPath,
      mockedWrites: evidence.mockedWrites,
      mockedWriteTotal: evidence.mockedWriteTotal,
      networkBoundary: evidence.networkBoundary,
    }, null, 2));
  } finally {
    if (browser) await browser.close();
    await closeServer(server);
  }
}

await run();
