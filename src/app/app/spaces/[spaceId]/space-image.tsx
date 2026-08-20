"use client";

import { useRef, useState, useTransition } from "react";
import { updateSpaceImage } from "../../actions";
import { COVER_MAX_BYTES } from "@/lib/branding";
import { SpacePhoto } from "@/components/space-photo";

const KEEP = "__keep__";
const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

function readImage(
  file: File,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!ALLOWED.includes(file.type)) {
    return Promise.resolve({ ok: false, error: "Use a PNG, JPEG or WebP image." });
  }
  if (file.size > COVER_MAX_BYTES) {
    return Promise.resolve({
      ok: false,
      error: `That image is too large (max ${Math.round(COVER_MAX_BYTES / 1024)} KB).`,
    });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result) });
    reader.onerror = () => resolve({ ok: false, error: "Couldn't read that file." });
    reader.readAsDataURL(file);
  });
}

export function SpaceImage({
  spaceId,
  name,
  initial,
}: {
  spaceId: string;
  name: string;
  initial: string | null;
}) {
  const [preview, setPreview] = useState<string | null>(initial);
  const [field, setField] = useState<string>(initial ? KEEP : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();
  const input = useRef<HTMLInputElement>(null);

  async function pick(file: File | undefined) {
    if (!file) return;
    setError(null);
    const r = await readImage(file);
    if (!r.ok) return setError(r.error);
    setPreview(r.dataUrl);
    setField(r.dataUrl);
    setSaved(false);
  }

  function save() {
    setError(null);
    const fd = new FormData();
    fd.set("spaceId", spaceId);
    fd.set("image", field);
    startTransition(async () => {
      const result = await updateSpaceImage(fd);
      if (!result.ok) return setError(result.error);
      // Persisted — mark as "keep" so a re-save doesn't resend the payload.
      setField(preview ? KEEP : "");
      setSaved(true);
    });
  }

  const btn =
    "rounded-pill px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out";

  return (
    <section className="mt-6 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
      <h2 className="text-xl">Photo</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        Shown on your Spaces list. PNG, JPEG or WebP, up to {Math.round(COVER_MAX_BYTES / 1024)}&nbsp;KB.
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-5">
        <div className="aspect-video w-56 overflow-hidden rounded-lg border border-rule">
          <SpacePhoto src={preview} name={name} />
        </div>

        <div className="flex flex-col gap-3">
          <input
            ref={input}
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="hidden"
            onChange={(e) => pick(e.target.files?.[0])}
          />
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => input.current?.click()}
              className={`${btn} border border-rule-strong text-ink-2 hover:border-ink hover:text-ink`}
            >
              {preview ? "Replace" : "Upload photo"}
            </button>
            {preview ? (
              <button
                type="button"
                onClick={() => {
                  setPreview(null);
                  setField("");
                  setSaved(false);
                }}
                className={`${btn} text-ink-3 hover:text-clay-ink`}
              >
                Remove
              </button>
            ) : null}
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={save}
              disabled={pending}
              className="rounded-pill bg-accent px-5 py-2 text-[0.875rem] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
            >
              {pending ? "Saving…" : "Save photo"}
            </button>
            {saved ? <span className="text-[0.8125rem] text-accent-ink">Saved ✓</span> : null}
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-4 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink">
          {error}
        </p>
      ) : null}
    </section>
  );
}
