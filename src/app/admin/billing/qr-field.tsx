"use client";

import { useRef, useState } from "react";
import { uploadImage } from "@/lib/upload-client";

const MAX_BYTES = 512 * 1024;

/**
 * The InstaPay QR field: upload an image (stored in R2 immediately) or paste a
 * hosted URL. Writes whichever URL to a hidden `qrUrl` input the form submits.
 */
export function QrField({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    setUploading(true);
    const r = await uploadImage(file, "instapay", MAX_BYTES);
    setUploading(false);
    if (!r.ok) return setError(r.error);
    setValue(r.url);
  }

  const hasImage = value.startsWith("data:") || /^https?:\/\//i.test(value);
  const btn =
    "rounded-pill border border-rule-strong px-3.5 py-1.5 text-[0.8125rem] text-ink-2 hover:border-ink hover:text-ink";

  return (
    <div className="grid gap-2 text-[0.875rem] text-ink-2">
      <span>QR code</span>
      <input type="hidden" name="qrUrl" value={value} />

      <div className="flex items-start gap-3">
        {hasImage ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={value}
            alt=""
            className="size-28 rounded-sm border border-rule bg-paper-2 object-contain"
          />
        ) : (
          <div className="grid size-28 place-items-center rounded-sm border border-dashed border-rule-strong bg-paper-2 text-[0.75rem] text-ink-3">
            No QR
          </div>
        )}
        <div className="flex flex-col gap-2">
          <input
            ref={fileRef}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className={`${btn} disabled:opacity-45`}
          >
            {uploading ? "Uploading…" : hasImage ? "Replace image" : "Upload image"}
          </button>
          {value ? (
            <button
              type="button"
              onClick={() => setValue("")}
              className="rounded-pill px-3.5 py-1.5 text-[0.8125rem] text-ink-3 hover:text-clay-ink"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>

      <label className="grid gap-1">
        <span className="text-[0.75rem] text-ink-3">…or paste a hosted image URL</span>
        <input
          value={value.startsWith("data:") ? "" : value}
          onChange={(e) => setValue(e.target.value.trim())}
          placeholder="https://…/reservme-instapay.png"
          className="h-9 rounded-sm border border-rule bg-paper-2 px-2 text-[0.8125rem]"
        />
      </label>

      {error ? <p className="text-[0.8125rem] text-clay-ink">{error}</p> : null}
    </div>
  );
}
