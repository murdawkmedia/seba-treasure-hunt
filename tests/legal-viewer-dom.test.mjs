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
