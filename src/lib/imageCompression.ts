/**
 * imageCompression.ts — Browser Image Compression Engine (10 KB – 50 KB Target)
 *
 * Compresses camera / gallery fuel receipt photos cleanly into the 10 KB – 50 KB
 * range while keeping receipt text legible via progressive downscaling + JPEG
 * quality search on HTML5 Canvas.
 */

export const FUEL_RECEIPT_MIN_BYTES = 10 * 1024; // 10 KB
export const FUEL_RECEIPT_MAX_BYTES = 50 * 1024; // 50 KB

export interface CompressionCandidateMeta {
  maxEdge: number;
  quality: number;
  sizeBytes: number;
}

export interface CompressedReceiptResult {
  file: File;
  blob: Blob;
  dataUrl: string;
  sizeBytes: number;
  sizeKb: number;
  originalSizeBytes: number;
  width: number;
  height: number;
  withinTargetRange: boolean;
}

/**
 * Computes aspect-ratio-preserving dimensions scaled so max(width, height) <= maxEdge.
 */
export function computeScaledDimensions(
  width: number,
  height: number,
  maxEdge: number
): { width: number; height: number } {
  const safeW = Math.max(1, Math.round(width));
  const safeH = Math.max(1, Math.round(height));
  const longest = Math.max(safeW, safeH);
  if (longest <= maxEdge) {
    return { width: safeW, height: safeH };
  }
  const scale = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(safeW * scale)),
    height: Math.max(1, Math.round(safeH * scale)),
  };
}

/**
 * Pure selection rule: chooses the highest-quality candidate inside [minBytes, maxBytes],
 * falling back to the largest candidate <= maxBytes, or the smallest overall if none fit.
 */
export function selectCompressionCandidate<T extends CompressionCandidateMeta>(
  candidates: T[],
  minBytes = FUEL_RECEIPT_MIN_BYTES,
  maxBytes = FUEL_RECEIPT_MAX_BYTES
): T | null {
  if (!candidates || candidates.length === 0) return null;

  const inRange = candidates.filter((c) => c.sizeBytes >= minBytes && c.sizeBytes <= maxBytes);
  if (inRange.length > 0) {
    return inRange.reduce((best, cur) =>
      cur.sizeBytes > best.sizeBytes ? cur : best
    );
  }

  const underMax = candidates.filter((c) => c.sizeBytes <= maxBytes);
  if (underMax.length > 0) {
    return underMax.reduce((best, cur) =>
      cur.sizeBytes > best.sizeBytes ? cur : best
    );
  }

  return candidates.reduce((smallest, cur) =>
    cur.sizeBytes < smallest.sizeBytes ? cur : smallest
  );
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("Failed to read compressed image data."));
    };
    reader.onerror = () => reject(new Error("Failed to read compressed image."));
    reader.readAsDataURL(blob);
  });
}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("Image compression failed in browser canvas."));
      },
      "image/jpeg",
      quality
    );
  });
}

async function loadImageSource(file: Blob): Promise<{
  width: number;
  height: number;
  drawTo: (ctx: CanvasRenderingContext2D, w: number, h: number) => void;
  cleanup: () => void;
}> {
  if (typeof createImageBitmap === "function") {
    try {
      const bitmap = await createImageBitmap(file);
      return {
        width: bitmap.width,
        height: bitmap.height,
        drawTo: (ctx, w, h) => ctx.drawImage(bitmap, 0, 0, w, h),
        cleanup: () => bitmap.close(),
      };
    } catch {
      // Fallback to HTMLImageElement below
    }
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("Could not decode the selected image file."));
      el.src = objectUrl;
    });
    return {
      width: img.naturalWidth || img.width || 1024,
      height: img.naturalHeight || img.height || 1024,
      drawTo: (ctx, w, h) => ctx.drawImage(img, 0, 0, w, h),
      cleanup: () => URL.revokeObjectURL(objectUrl),
    };
  } catch (err) {
    URL.revokeObjectURL(objectUrl);
    throw err;
  }
}

/**
 * Compresses any camera/gallery image into the 10 KB – 50 KB target band (JPEG).
 */
export async function compressReceiptImageToTarget(
  file: File | Blob,
  options?: { minBytes?: number; maxBytes?: number; fileName?: string }
): Promise<CompressedReceiptResult> {
  if (!file) {
    throw new Error("No image file selected.");
  }
  if (file.type && !file.type.startsWith("image/")) {
    throw new Error("Please select a valid image photo (JPG, PNG, WEBP, HEIC).");
  }

  const minBytes = options?.minBytes ?? FUEL_RECEIPT_MIN_BYTES;
  const maxBytes = options?.maxBytes ?? FUEL_RECEIPT_MAX_BYTES;
  const originalSizeBytes = file.size;

  const source = await loadImageSource(file);
  try {
    const maxEdges = [1280, 1024, 800, 640, 480, 360, 260, 200];
    const qualities = [0.85, 0.7, 0.56, 0.44, 0.34, 0.25, 0.18];

    interface EncodedCandidate extends CompressionCandidateMeta {
      blob: Blob;
      width: number;
      height: number;
    }

    const tried: EncodedCandidate[] = [];
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      throw new Error("Canvas 2D context is not available.");
    }

    for (const edge of maxEdges) {
      const dims = computeScaledDimensions(source.width, source.height, edge);
      canvas.width = dims.width;
      canvas.height = dims.height;
      // Fill white background before drawing so PNG transparency doesn't turn black in JPEG
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, dims.width, dims.height);
      source.drawTo(ctx, dims.width, dims.height);

      for (const q of qualities) {
        const blob = await canvasToJpegBlob(canvas, q);
        const entry: EncodedCandidate = {
          maxEdge: edge,
          quality: q,
          sizeBytes: blob.size,
          blob,
          width: dims.width,
          height: dims.height,
        };
        tried.push(entry);

        // Stop early as soon as we hit the upper end of the 10 KB – 50 KB sweet spot
        if (blob.size >= minBytes && blob.size <= maxBytes) {
          break;
        }
      }

      const foundInBand = tried.some(
        (c) => c.sizeBytes >= minBytes && c.sizeBytes <= maxBytes
      );
      if (foundInBand) break;
    }

    const best = selectCompressionCandidate(tried, minBytes, maxBytes);
    if (!best) {
      throw new Error("Could not compress receipt image.");
    }

    const baseName =
      (options?.fileName || (file instanceof File ? file.name : "fuel-receipt"))
        .replace(/\.[^/.]+$/, "") || "fuel-receipt";
    const compressedFile = new File([best.blob], `${baseName}.jpg`, {
      type: "image/jpeg",
      lastModified: Date.now(),
    });
    const dataUrl = await blobToDataUrl(best.blob);

    return {
      file: compressedFile,
      blob: best.blob,
      dataUrl,
      sizeBytes: best.sizeBytes,
      sizeKb: Math.round((best.sizeBytes / 1024) * 10) / 10,
      originalSizeBytes,
      width: best.width,
      height: best.height,
      withinTargetRange: best.sizeBytes >= minBytes && best.sizeBytes <= maxBytes,
    };
  } finally {
    source.cleanup();
  }
}
