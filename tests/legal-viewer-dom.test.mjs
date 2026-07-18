import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { chromium } from "@playwright/test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("legal viewer hides and detaches stale iframe documents across close and overlapping reopen", { timeout: 30_000 }, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import { createSignupLegalViewerLoadCoordinator } from "./src/client/dashboard.ts";
        window.__createLegalViewerLoads = createSignupLegalViewerLoadCoordinator;
      `,
      resolveDir: root,
      sourcefile: "legal-viewer-dom-entry.ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "silent",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<dialog open><iframe title="Legal document" src="about:blank#old"></iframe></dialog>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    const states = await page.evaluate(() => {
      const dialog = document.querySelector("dialog");
      const frameState = () => {
        const frame = dialog.querySelector("iframe");
        return { hidden: frame.hidden, src: frame.getAttribute("src") };
      };
      const loads = window.__createLegalViewerLoads(dialog);

      const firstOpen = loads.begin();
      const firstOpenSuppressed = frameState();
      loads.invalidate();
      const afterClose = frameState();

      if (typeof loads.prepareFrame !== "function") {
        return { firstOpenSuppressed, afterClose, missingFramePreparation: true };
      }

      const reopened = loads.begin();
      const currentFrame = loads.prepareFrame(reopened);
      currentFrame.src = "about:blank#new";
      const reopenedLoading = frameState();
      loads.apply(reopened, () => { currentFrame.hidden = false; });
      const reopenedReady = frameState();

      loads.apply(firstOpen, () => {
        currentFrame.hidden = true;
        currentFrame.removeAttribute("src");
      });
      const afterStaleFailure = frameState();

      loads.begin();
      const afterOverlappingOpen = frameState();
      return {
        firstOpenSuppressed,
        afterClose,
        reopenedLoading,
        reopenedReady,
        afterStaleFailure,
        afterOverlappingOpen,
        missingFramePreparation: false,
      };
    });

    assert.deepEqual(states.firstOpenSuppressed, { hidden: true, src: null });
    assert.deepEqual(states.afterClose, { hidden: true, src: null });
    assert.deepEqual(states.reopenedLoading, { hidden: true, src: "about:blank#new" });
    assert.deepEqual(states.reopenedReady, { hidden: false, src: "about:blank#new" });
    assert.deepEqual(states.afterStaleFailure, states.reopenedReady);
    assert.deepEqual(states.afterOverlappingOpen, { hidden: true, src: null });
  } finally {
    await browser.close();
  }
});

test("legal dialog dismisses a backdrop click but not a click on dialog content", { timeout: 30_000 }, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as dashboard from "./src/client/dashboard.ts";
        window.__installLegalBackdropDismissal = dashboard.installSignupLegalDialogBackdropDismissal;
      `,
      resolveDir: root,
      sourcefile: "legal-dialog-backdrop-entry.ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "silent",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<dialog><div data-dialog-content><button type="button">Inside</button></div></dialog>');
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    const states = await page.evaluate(() => {
      const dialog = document.querySelector("dialog");
      if (typeof window.__installLegalBackdropDismissal !== "function") {
        return { installed: false, afterContentClick: null, afterBackdropClick: null };
      }
      window.__installLegalBackdropDismissal(dialog);
      dialog.showModal();
      dialog.querySelector("[data-dialog-content]").dispatchEvent(new MouseEvent("click", { bubbles: true }));
      const afterContentClick = dialog.open;
      dialog.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      return { installed: true, afterContentClick, afterBackdropClick: dialog.open };
    });

    assert.deepEqual(states, {
      installed: true,
      afterContentClick: true,
      afterBackdropClick: false,
    });
  } finally {
    await browser.close();
  }
});

test("open legal dialogs wrap keyboard focus across visible iframe and fallback controls", { timeout: 30_000 }, async () => {
  const bundle = await build({
    stdin: {
      contents: `
        import * as dashboard from "./src/client/dashboard.ts";
        window.__installLegalFocusContainment = dashboard.installSignupLegalDialogFocusContainment;
      `,
      resolveDir: root,
      sourcefile: "legal-dialog-focus-entry.ts",
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    target: "es2023",
    write: false,
    logLevel: "silent",
  });
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent(`
      <button id="outside">Outside</button>
      ${["privacy-media", "waiver"].map((kind) => `
        <dialog data-kind="${kind}">
          <button data-first type="button">Close</button>
          <button hidden type="button">Hidden</button>
          <button disabled type="button">Disabled</button>
          <iframe data-frame title="Legal document" src="about:blank"></iframe>
          <a data-fallback href="/full-${kind}" target="_blank">Open full document</a>
          <button data-last type="button">Done</button>
          <a data-hidden-link href="/hidden" style="display:none">Hidden link</a>
        </dialog>
      `).join("")}
    `);
    await page.addScriptTag({ content: bundle.outputFiles[0].text });

    assert.equal(await page.evaluate(() => typeof window.__installLegalFocusContainment), "function");
    for (const kind of ["privacy-media", "waiver"]) {
      const dialog = page.locator(`dialog[data-kind="${kind}"]`);
      await dialog.evaluate((element) => {
        window.__installLegalFocusContainment(element);
        element.showModal();
      });

      await dialog.locator("[data-first]").focus();
      await page.keyboard.press("Shift+Tab");
      assert.equal(await dialog.locator("[data-last]").evaluate((element) => element === document.activeElement), true, `${kind} Shift+Tab wraps first to last`);

      await page.keyboard.press("Tab");
      assert.equal(await dialog.locator("[data-first]").evaluate((element) => element === document.activeElement), true, `${kind} Tab wraps last to first`);

      await page.keyboard.press("Tab");
      assert.equal(await dialog.locator("[data-frame]").evaluate((element) => element === document.activeElement), true, `${kind} includes the visible iframe in focus order`);
      await page.keyboard.press("Tab");
      assert.equal(await dialog.locator("[data-fallback]").evaluate((element) => element === document.activeElement), true, `${kind} includes the fallback link in focus order`);

      await dialog.evaluate((element) => element.close());
      assert.equal(await dialog.evaluate((element) => {
        const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true });
        element.dispatchEvent(event);
        return event.defaultPrevented;
      }), false, `${kind} does not trap focus while closed`);
    }
  } finally {
    await browser.close();
  }
});
