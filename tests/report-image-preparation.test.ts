import assert from "node:assert/strict";
import test from "node:test";

import {
  optimizeReportImage,
  prepareReportImages,
  reportImageOptimizationAttempts,
  ReportImagePreparationError,
} from "../src/client/report-image-preparation";

const imageFile = (size: number, name = "photo.jpg", type = "image/jpeg") => {
  const file = new File([new Uint8Array([0xff, 0xd8, 0xff])], name, { type });
  Object.defineProperty(file, "size", { configurable: true, value: size });
  return file;
};

test("keeps 20 MB files direct and optimizes larger files sequentially", async () => {
  const calls: string[] = [];
  let active = 0;
  const result = await prepareReportImages(
    [
      imageFile(20_000_000, "direct.jpg"),
      imageFile(21_000_000, "large-a.jpg"),
      imageFile(22_000_000, "large-b.jpg"),
    ],
    {
      optimize: async (file) => {
        active += 1;
        assert.equal(active, 1);
        calls.push(file.name);
        await Promise.resolve();
        active -= 1;
        return imageFile(2_000_000, file.name.replace(/\.jpg$/i, ".webp"), "image/webp");
      },
    },
  );

  assert.equal(result[0]?.optimized, false);
  assert.equal(result[0]?.upload.name, "direct.jpg");
  assert.equal(result[1]?.optimized, true);
  assert.deepEqual(calls, ["large-a.jpg", "large-b.jpg"]);
});

test("rejects unsupported, over-50 MB, excessive count, and over-30 MB prepared selections", async () => {
  await assert.rejects(
    prepareReportImages([imageFile(2_000_000, "photo.heic", "image/heic")]),
    (error: ReportImagePreparationError) =>
      error.code === "unsupported_type" && error.fileName === "photo.heic" && /HEIC/i.test(error.message),
  );
  await assert.rejects(
    prepareReportImages([imageFile(50_000_001, "huge.jpg")]),
    (error: ReportImagePreparationError) =>
      error.code === "source_too_large" && /50 MB/.test(error.message),
  );
  await assert.rejects(
    prepareReportImages([
      imageFile(1, "a.jpg"),
      imageFile(1, "b.jpg"),
      imageFile(1, "c.jpg"),
      imageFile(1, "d.jpg"),
    ]),
    (error: ReportImagePreparationError) => error.code === "too_many",
  );
  await assert.rejects(
    prepareReportImages([imageFile(16_000_000, "a.jpg"), imageFile(16_000_000, "b.jpg")]),
    (error: ReportImagePreparationError) =>
      error.code === "combined_too_large" && /30 MB/.test(error.message),
  );
});

test("retries bounded encodes and always closes the decoded bitmap", async () => {
  const attempts: Array<{ edge: number; quality: number }> = [];
  let closed = 0;
  const optimized = await optimizeReportImage(imageFile(24_000_000, "evidence.jpg"), {
    decode: async () => ({
      width: 6000,
      height: 4000,
      source: {} as CanvasImageSource,
      close: () => {
        closed += 1;
      },
    }),
    encode: async (_decoded, attempt) => {
      attempts.push({ edge: attempt.edge, quality: attempt.quality });
      const size = attempts.length < 3 ? 20_000_001 : 5_000_000;
      return new Blob([new Uint8Array(size)], { type: "image/webp" });
    },
  });

  assert.deepEqual(attempts, reportImageOptimizationAttempts);
  assert.equal(optimized.name, "evidence.webp");
  assert.equal(optimized.type, "image/webp");
  assert.equal(optimized.size, 5_000_000);
  assert.equal(closed, 1);
});

test("aborts before encoding and closes decoded resources", async () => {
  const controller = new AbortController();
  let closed = 0;
  let encodes = 0;
  await assert.rejects(
    optimizeReportImage(imageFile(24_000_000), {
      signal: controller.signal,
      decode: async () => {
        controller.abort();
        return {
          width: 4000,
          height: 3000,
          source: {} as CanvasImageSource,
          close: () => {
            closed += 1;
          },
        };
      },
      encode: async () => {
        encodes += 1;
        return new Blob();
      },
    }),
    (error: Error) => error.name === "AbortError",
  );
  assert.equal(encodes, 0);
  assert.equal(closed, 1);
});

test("reports a filename-specific failure when no bounded attempt reaches 20 MB", async () => {
  await assert.rejects(
    optimizeReportImage(imageFile(24_000_000, "too-detailed.png", "image/png"), {
      decode: async () => ({
        width: 5000,
        height: 5000,
        source: {} as CanvasImageSource,
        close: () => undefined,
      }),
      encode: async () => new Blob([new Uint8Array(20_000_001)], { type: "image/webp" }),
    }),
    (error: ReportImagePreparationError) =>
      error.code === "optimization_failed" && error.fileName === "too-detailed.png",
  );
});

test("accepts a JPEG encoder fallback when WebP output is unavailable", async () => {
  const optimized = await optimizeReportImage(imageFile(24_000_000, "fallback.png", "image/png"), {
    decode: async () => ({
      width: 3000,
      height: 2000,
      source: {} as CanvasImageSource,
      close: () => undefined,
    }),
    encode: async () => new Blob([new Uint8Array(2_000_000)], { type: "image/jpeg" }),
  });
  assert.equal(optimized.name, "fallback.jpg");
  assert.equal(optimized.type, "image/jpeg");
});
