export const IMAGE_ACCEPT = "image/jpeg,image/png,image/webp";
export const IMAGE_LIMITS = Object.freeze({
  count: 12,
  totalBytes: 28 * 1024 * 1024,
  full: Object.freeze({ maxLongEdge: 2560, minimumLongEdge: 1280, initialQuality: 0.88, minimumQuality: 0.68, maxBytes: 1_900_000 }),
  thumbnail: Object.freeze({ maxLongEdge: 640, minimumLongEdge: 320, initialQuality: 0.82, minimumQuality: 0.66, maxBytes: 240_000 }),
});

const MIME_LABELS = Object.freeze({ "image/jpeg": "JPEG", "image/png": "PNG", "image/webp": "WebP" });
const EXTENSION_MIME = Object.freeze({ jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp" });

export const acceptedImageType = (file) => {
  const extension = String(file?.name ?? "").split(".").at(-1)?.toLowerCase() ?? "";
  const extensionType = EXTENSION_MIME[extension];
  const declaredType = String(file?.type ?? "").toLowerCase();
  return Boolean(extensionType && (!declaredType || declaredType === extensionType));
};

export const fitWithin = (width, height, maximumLongEdge) => {
  const longEdge = Math.max(width, height);
  const scale = Math.min(1, maximumLongEdge / longEdge);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
};

const canvasWebp = (bitmap, dimensions, quality) => new Promise((resolve, reject) => {
  const canvas = document.createElement("canvas");
  canvas.width = dimensions.width;
  canvas.height = dimensions.height;
  const context = canvas.getContext("2d", { alpha: true });
  if (!context) return reject(new Error("This browser cannot create an image canvas."));
  context.drawImage(bitmap, 0, 0, dimensions.width, dimensions.height);
  canvas.toBlob((blob) => {
    if (!blob || blob.type !== "image/webp") reject(new Error("This browser cannot encode WebP images."));
    else resolve(blob);
  }, "image/webp", quality);
});

const encodeVariant = async (bitmap, policy, label) => {
  const sourceLongEdge = Math.max(bitmap.width, bitmap.height);
  const minimumLongEdge = Math.min(sourceLongEdge, policy.minimumLongEdge);
  let targetLongEdge = Math.min(sourceLongEdge, policy.maxLongEdge);
  let quality = policy.initialQuality;

  while (true) {
    const dimensions = fitWithin(bitmap.width, bitmap.height, targetLongEdge);
    const blob = await canvasWebp(bitmap, dimensions, quality);
    if (blob.size <= policy.maxBytes) return { blob, ...dimensions, quality };

    const nextQuality = Number((quality - 0.04).toFixed(2));
    if (nextQuality >= policy.minimumQuality) {
      quality = nextQuality;
      continue;
    }

    const nextLongEdge = Math.floor(targetLongEdge * 0.84);
    if (nextLongEdge < minimumLongEdge || nextLongEdge >= targetLongEdge) {
      throw new Error(`${label} could not be reduced below ${Math.round(policy.maxBytes / 1024)} KiB without unacceptable quality loss.`);
    }
    targetLongEdge = nextLongEdge;
    quality = policy.initialQuality;
  }
};

export const normalizePhotograph = async (file) => {
  if (!acceptedImageType(file)) throw new Error("Select a JPG, JPEG, PNG, or WebP photograph.");
  if (typeof createImageBitmap !== "function") throw new Error("This browser cannot decode photographs for WebP conversion.");

  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  } catch {
    try { bitmap = await createImageBitmap(file); } catch { throw new Error(`${file.name} is not a readable photograph.`); }
  }

  try {
    if (!bitmap.width || !bitmap.height) throw new Error(`${file.name} has invalid image dimensions.`);
    const full = await encodeVariant(bitmap, IMAGE_LIMITS.full, `${file.name} full image`);
    const thumbnail = await encodeVariant(bitmap, IMAGE_LIMITS.thumbnail, `${file.name} thumbnail`);
    return {
      source: {
        name: file.name,
        format: MIME_LABELS[file.type] ?? MIME_LABELS[EXTENSION_MIME[file.name.split(".").at(-1).toLowerCase()]],
        width: bitmap.width,
        height: bitmap.height,
        size: file.size,
      },
      full,
      thumbnail,
    };
  } finally {
    bitmap.close?.();
  }
};

export const generatedImageBytes = (items) => items.reduce((total, item) => total + (item.full?.blob?.size ?? item.full?.size ?? 0) + (item.thumbnail?.blob?.size ?? item.thumbnail?.size ?? 0), 0);
