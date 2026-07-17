import {
  REPORT_IMAGE_DIRECT_BYTES,
  REPORT_IMAGE_MAX_COUNT,
  REPORT_IMAGE_SOURCE_BYTES,
  REPORT_IMAGE_TOTAL_BYTES,
  REPORT_IMAGE_TYPES,
} from "../shared/report-image-limits";

export class ReportImagePreparationError extends Error {
  constructor(
    public readonly code: string,
    public readonly fileName: string,
    message: string,
  ) {
    super(message);
    this.name = "ReportImagePreparationError";
  }
}

export interface PreparedReportImage {
  source: File;
  upload: File;
  optimized: boolean;
}

export interface DecodedReportImage {
  width: number;
  height: number;
  source: CanvasImageSource;
  close(): void;
}

export interface ReportImageOptimizationAttempt {
  edge: number;
  quality: number;
}

export const reportImageOptimizationAttempts: ReportImageOptimizationAttempt[] = [
  { edge: 2560, quality: 0.82 },
  { edge: 2048, quality: 0.76 },
  { edge: 1600, quality: 0.72 },
];

export interface ReportImageOptimizationOptions {
  signal?: AbortSignal;
  decode?: (file: File, signal?: AbortSignal) => Promise<DecodedReportImage>;
  encode?: (
    decoded: DecodedReportImage,
    attempt: ReportImageOptimizationAttempt,
    signal?: AbortSignal,
  ) => Promise<Blob>;
}

const abortError = () => new DOMException("Image preparation was cancelled.", "AbortError");

const assertNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw abortError();
};

const defaultDecode = async (file: File, signal?: AbortSignal): Promise<DecodedReportImage> => {
  assertNotAborted(signal);
  if (typeof createImageBitmap !== "function") {
    throw new Error("This browser cannot decode a large image for optimization.");
  }
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  return {
    width: bitmap.width,
    height: bitmap.height,
    source: bitmap,
    close: () => bitmap.close(),
  };
};

const canvasDimensions = (
  decoded: DecodedReportImage,
  maximumEdge: number,
): { width: number; height: number } => {
  const scale = Math.min(1, maximumEdge / Math.max(decoded.width, decoded.height));
  return {
    width: Math.max(1, Math.round(decoded.width * scale)),
    height: Math.max(1, Math.round(decoded.height * scale)),
  };
};

const htmlCanvasBlob = (
  canvas: HTMLCanvasElement,
  type: "image/webp" | "image/jpeg",
  quality: number,
): Promise<Blob> =>
  new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("The browser could not encode this image.")),
      type,
      quality,
    );
  });

const defaultEncode = async (
  decoded: DecodedReportImage,
  attempt: ReportImageOptimizationAttempt,
  signal?: AbortSignal,
): Promise<Blob> => {
  assertNotAborted(signal);
  const dimensions = canvasDimensions(decoded, attempt.edge);

  if (typeof OffscreenCanvas === "function") {
    const canvas = new OffscreenCanvas(dimensions.width, dimensions.height);
    try {
      const context = canvas.getContext("2d");
      if (!context) throw new Error("The browser could not create an image workspace.");
      context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);
      assertNotAborted(signal);
      try {
        const webp = await canvas.convertToBlob({ type: "image/webp", quality: attempt.quality });
        if (webp.type === "image/webp") return webp;
      } catch {
        assertNotAborted(signal);
      }
      return await canvas.convertToBlob({ type: "image/jpeg", quality: attempt.quality });
    } finally {
      canvas.width = 1;
      canvas.height = 1;
    }
  }

  if (typeof document === "undefined") {
    throw new Error("The browser could not create an image workspace.");
  }
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  try {
    const context = canvas.getContext("2d");
    if (!context) throw new Error("The browser could not create an image workspace.");
    context.drawImage(decoded.source, 0, 0, dimensions.width, dimensions.height);
    assertNotAborted(signal);
    const webp = await htmlCanvasBlob(canvas, "image/webp", attempt.quality);
    if (webp.type === "image/webp") return webp;
    return await htmlCanvasBlob(canvas, "image/jpeg", attempt.quality);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
  }
};

const optimizedFileName = (name: string, type: "image/webp" | "image/jpeg"): string => {
  const stem = name.replace(/\.[^.]+$/, "").trim() || "photo";
  return `${stem}${type === "image/webp" ? ".webp" : ".jpg"}`;
};

export async function optimizeReportImage(
  file: File,
  options: ReportImageOptimizationOptions = {},
): Promise<File> {
  let decoded: DecodedReportImage;
  try {
    decoded = await (options.decode ?? defaultDecode)(file, options.signal);
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") throw error;
    throw new ReportImagePreparationError(
      "decode_failed",
      file.name,
      `${file.name} could not be opened for optimization. Choose a JPEG, PNG, or WebP copy instead.`,
    );
  }

  try {
    for (const attempt of reportImageOptimizationAttempts) {
      assertNotAborted(options.signal);
      let blob: Blob;
      try {
        blob = await (options.encode ?? defaultEncode)(decoded, attempt, options.signal);
      } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw error;
        continue;
      }
      if (
        (blob.type === "image/webp" || blob.type === "image/jpeg") &&
        blob.size > 0 &&
        blob.size <= REPORT_IMAGE_DIRECT_BYTES
      ) {
        const outputType = blob.type as "image/webp" | "image/jpeg";
        return new File([blob], optimizedFileName(file.name, outputType), {
          type: outputType,
          lastModified: file.lastModified,
        });
      }
    }
  } finally {
    decoded.close();
  }

  throw new ReportImagePreparationError(
    "optimization_failed",
    file.name,
    `${file.name} could not be prepared below 20 MB without reducing it too far. Choose another copy.`,
  );
}

export async function prepareReportImages(
  files: readonly File[],
  options: {
    optimize?: (file: File, options?: { signal?: AbortSignal }) => Promise<File>;
    signal?: AbortSignal;
  } = {},
): Promise<PreparedReportImage[]> {
  if (files.length > REPORT_IMAGE_MAX_COUNT) {
    throw new ReportImagePreparationError("too_many", "", "Choose no more than three images.");
  }

  const prepared: PreparedReportImage[] = [];
  let total = 0;
  for (const source of files) {
    assertNotAborted(options.signal);
    if (!REPORT_IMAGE_TYPES.has(source.type)) {
      throw new ReportImagePreparationError(
        "unsupported_type",
        source.name,
        `${source.name} must be JPEG, PNG, or WebP. HEIC is not supported yet; choose or export a JPEG copy.`,
      );
    }
    if (source.size === 0) {
      throw new ReportImagePreparationError("empty_file", source.name, `${source.name} is empty.`);
    }
    if (source.size > REPORT_IMAGE_SOURCE_BYTES) {
      throw new ReportImagePreparationError(
        "source_too_large",
        source.name,
        `${source.name} is larger than 50 MB. Choose a smaller copy.`,
      );
    }

    const optimized = source.size > REPORT_IMAGE_DIRECT_BYTES;
    const optimizationOptions = options.signal ? { signal: options.signal } : {};
    const upload = optimized
      ? await (options.optimize ?? ((file, nested) => optimizeReportImage(file, nested)))(
          source,
          optimizationOptions,
        )
      : source;
    if (!REPORT_IMAGE_TYPES.has(upload.type) || upload.size === 0 || upload.size > REPORT_IMAGE_DIRECT_BYTES) {
      throw new ReportImagePreparationError(
        "optimization_too_large",
        source.name,
        `${source.name} could not be prepared below 20 MB. Choose another copy.`,
      );
    }
    total += upload.size;
    if (total > REPORT_IMAGE_TOTAL_BYTES) {
      throw new ReportImagePreparationError(
        "combined_too_large",
        source.name,
        "The prepared photos total more than 30 MB. Remove one photo or choose smaller copies.",
      );
    }
    prepared.push({ source, upload, optimized });
  }
  return prepared;
}
