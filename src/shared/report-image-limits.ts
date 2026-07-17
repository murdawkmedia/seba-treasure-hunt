export const REPORT_IMAGE_DIRECT_BYTES = 20_000_000;
export const REPORT_IMAGE_SOURCE_BYTES = 50_000_000;
export const REPORT_IMAGE_TOTAL_BYTES = 30_000_000;
export const REPORT_IMAGE_MAX_COUNT = 3;

export const REPORT_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

export const reportImageMegabytes = (bytes: number): string =>
  `${(Math.max(0, bytes) / 1_000_000).toFixed(1).replace(/\.0$/, "")} MB`;
