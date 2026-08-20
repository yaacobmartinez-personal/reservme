import crypto from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { validateImageDataUrl } from "@/lib/branding";
import { serverEnv } from "@/lib/env";

/**
 * Cloudflare R2 image storage, with a graceful fall back to inline data URLs.
 *
 * Images (court photos, logos, covers, QR codes) arrive from the client as a
 * `data:` URL. storeImage() offloads that to R2 when it's configured and returns
 * a public https URL to persist; when R2 is unset it returns the data URL
 * unchanged, so the app runs identically without any storage configured. Either
 * way the DB holds a string an `<img src>` renders directly.
 *
 * R2 speaks the S3 API, so we use the AWS S3 client pointed at the R2 endpoint.
 */

type R2Config = {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  publicUrl: string;
};

function config(): R2Config | null {
  const e = serverEnv();
  if (
    !e.R2_ACCOUNT_ID ||
    !e.R2_ACCESS_KEY_ID ||
    !e.R2_SECRET_ACCESS_KEY ||
    !e.R2_BUCKET ||
    !e.R2_PUBLIC_URL
  ) {
    return null;
  }
  return {
    accountId: e.R2_ACCOUNT_ID,
    accessKeyId: e.R2_ACCESS_KEY_ID,
    secretAccessKey: e.R2_SECRET_ACCESS_KEY,
    bucket: e.R2_BUCKET,
    publicUrl: e.R2_PUBLIC_URL.replace(/\/$/, ""),
  };
}

export function r2Configured(): boolean {
  return config() !== null;
}

let cachedClient: S3Client | null = null;
function client(cfg: R2Config): S3Client {
  cachedClient ??= new S3Client({
    region: "auto",
    endpoint: `https://${cfg.accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
  });
  return cachedClient;
}

const EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
};

/** The public URL for a stored key, e.g. https://images.reservme.pro/<key>. */
export function publicUrl(key: string): string {
  const cfg = config();
  if (!cfg) throw new Error("R2 is not configured");
  return `${cfg.publicUrl}/${key}`;
}

/** If a URL points at our R2 public base, return its object key; else null. */
export function keyForUrl(url: string): string | null {
  const cfg = config();
  if (!cfg) return null;
  const base = `${cfg.publicUrl}/`;
  return url.startsWith(base) ? url.slice(base.length) : null;
}

/**
 * Uploads raw image bytes to R2 and returns a public URL, or — when R2 is
 * unconfigured — returns an inline data URL so the caller stores it in the DB.
 * The upload route calls this directly with the file; storeImage wraps it for
 * the data-URL path.
 */
export async function putImageBytes(
  bytes: Buffer,
  contentType: string,
  keyPrefix: string,
): Promise<string> {
  const cfg = config();
  if (!cfg) return `data:${contentType};base64,${bytes.toString("base64")}`;

  const ext = EXT[contentType] ?? "bin";
  const key = `${keyPrefix.replace(/^\/+|\/+$/g, "")}/${crypto.randomUUID()}.${ext}`;
  await client(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: bytes,
      ContentType: contentType,
      // Content-addressed by a random key, so it can cache forever.
      CacheControl: "public, max-age=31536000, immutable",
    }),
  );
  return publicUrl(key);
}

/**
 * Persist a client image and return the string to store in the DB.
 * - a `data:` URL → uploaded to R2 (returns an https URL) when configured, else
 *   returned unchanged (stored inline);
 * - an `http(s)` URL → returned unchanged (a pasted/hosted image, or one the
 *   upload route already put in R2).
 * Validation (mime allowlist + byte cap) always runs on data URLs.
 */
export async function storeImage(
  value: string,
  keyPrefix: string,
  maxBytes: number,
): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  if (/^https?:\/\//i.test(value)) return { ok: true, url: value };

  const check = validateImageDataUrl(value, maxBytes);
  if (!check.ok) return { ok: false, error: check.error };

  const match = /^data:([a-z]+\/[a-z0-9.+-]+);base64,(.+)$/i.exec(value.trim());
  if (!match) return { ok: false, error: "That doesn't look like an image file." };
  const url = await putImageBytes(Buffer.from(match[2], "base64"), match[1], keyPrefix);
  return { ok: true, url };
}

/** Best-effort delete of a previously stored image (no-op unless it's ours). */
export async function dropImage(url: string | null | undefined): Promise<void> {
  if (!url) return;
  const cfg = config();
  if (!cfg) return;
  const key = keyForUrl(url);
  if (!key) return;
  try {
    await client(cfg).send(new DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
  } catch {
    // An orphaned object is harmless; never fail a save because cleanup failed.
  }
}
