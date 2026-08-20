"use client";

import { useRef, useState } from "react";

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];
const MAX_BYTES = 512 * 1024;

function readImage(
  file: File,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!ALLOWED.includes(file.type)) {
    return Promise.resolve({ ok: false, error: "Use a PNG, JPEG or WebP image." });
  }
  if (file.size > MAX_BYTES) {
    return Promise.resolve({ ok: false, error: "That image is too large (max 512 KB)." });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result) });
    reader.onerror = () => resolve({ ok: false, error: "Couldn't read that file." });
    reader.readAsDataURL(file);
  });
}

/**
 * The InstaPay QR field: upload an image (→ stored in R2 on save) or paste a
 * hosted URL. Writes whichever to a hidden `qrUrl` input the form submits.
 */
export function QrField({ initial }: { initial: string | null }) {
  const [value, setValue] = useState(initial ?? "");
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    const r = await readImage(file);
    if (!r.ok) return setError(r.error);
    setValue(r.dataUrl);
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
          <button type="button" onClick={() => fileRef.current?.click()} className={btn}>
            {hasImage ? "Replace image" : "Upload image"}
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
