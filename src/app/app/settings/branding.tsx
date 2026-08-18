"use client";

import { useRef, useState, useTransition } from "react";
import { updateBranding } from "@/app/app/branding-actions";
import {
  type Branding,
  COVER_MAX_BYTES,
  LOGO_MAX_BYTES,
  THEMES,
  type ThemeId,
} from "@/lib/branding";

const KEEP = "__keep__";

// Literal classes so Tailwind's scanner keeps them.
const SWATCH: Record<ThemeId, string> = {
  pine: "bg-swatch-pine",
  ocean: "bg-swatch-ocean",
  violet: "bg-swatch-violet",
  sunset: "bg-swatch-sunset",
  rose: "bg-swatch-rose",
  slate: "bg-swatch-slate",
};

const ALLOWED = ["image/png", "image/jpeg", "image/webp"];

function readImage(
  file: File,
  maxBytes: number,
): Promise<{ ok: true; dataUrl: string } | { ok: false; error: string }> {
  if (!ALLOWED.includes(file.type)) {
    return Promise.resolve({ ok: false, error: "Use a PNG, JPEG or WebP image." });
  }
  if (file.size > maxBytes) {
    return Promise.resolve({ ok: false, error: `That image is too large (max ${Math.round(maxBytes / 1024)} KB).` });
  }
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ ok: true, dataUrl: String(reader.result) });
    reader.onerror = () => resolve({ ok: false, error: "Couldn't read that file." });
    reader.readAsDataURL(file);
  });
}

export function BrandingSection({
  initial,
  venueName,
  tagline,
}: {
  initial: Branding;
  venueName: string;
  tagline: string | null;
}) {
  const [theme, setTheme] = useState<ThemeId>(initial.theme);
  const [logoPreview, setLogoPreview] = useState<string | null>(initial.logo);
  const [logoField, setLogoField] = useState<string>(initial.logo ? KEEP : "");
  const [coverPreview, setCoverPreview] = useState<string | null>(initial.coverUrl);
  const [coverField, setCoverField] = useState<string>(initial.coverUrl ? KEEP : "");
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [pending, startTransition] = useTransition();

  const logoInput = useRef<HTMLInputElement>(null);
  const coverInput = useRef<HTMLInputElement>(null);

  async function pickLogo(file: File | undefined) {
    if (!file) return;
    setError(null);
    const r = await readImage(file, LOGO_MAX_BYTES);
    if (!r.ok) return setError(r.error);
    setLogoPreview(r.dataUrl);
    setLogoField(r.dataUrl);
    setSaved(false);
  }
  async function pickCover(file: File | undefined) {
    if (!file) return;
    setError(null);
    const r = await readImage(file, COVER_MAX_BYTES);
    if (!r.ok) return setError(r.error);
    setCoverPreview(r.dataUrl);
    setCoverField(r.dataUrl);
    setSaved(false);
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.set("theme", theme);
    fd.set("logo", logoField);
    fd.set("cover", coverField);
    startTransition(async () => {
      const result = await updateBranding(fd);
      if (!result.ok) {
        setError(result.error);
        return;
      }
      // Persisted — mark images as "keep" so a re-save doesn't resend them.
      setLogoField(logoPreview ? KEEP : "");
      setCoverField(coverPreview ? KEEP : "");
      setSaved(true);
    });
  }

  const btn = "rounded-pill px-3.5 py-1.5 text-[0.8125rem] transition-colors duration-[--dur-fast] ease-out";

  return (
    <section className="mt-8 rounded-xl border border-rule bg-card p-6 shadow-float sm:p-8">
      <h2 className="text-xl">Branding</h2>
      <p className="mt-1 text-[0.875rem] text-ink-3">
        Make your booking page yours. PNG, JPEG or WebP · logo up to 128&nbsp;KB, cover up to 512&nbsp;KB.
      </p>

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div className="grid gap-6">
          {/* Theme */}
          <div>
            <p className="text-[0.875rem] text-ink-2">Theme colour</p>
            <div className="mt-2 flex flex-wrap gap-2.5">
              {THEMES.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => {
                    setTheme(t.id);
                    setSaved(false);
                  }}
                  aria-pressed={theme === t.id}
                  title={t.label}
                  className={[
                    "size-8 rounded-full transition-transform",
                    SWATCH[t.id],
                    theme === t.id
                      ? "ring-2 ring-ink ring-offset-2 ring-offset-card"
                      : "hover:scale-105",
                  ].join(" ")}
                >
                  <span className="sr-only">{t.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Logo */}
          <div>
            <p className="text-[0.875rem] text-ink-2">Logo</p>
            <div className="mt-2 flex items-center gap-3">
              {logoPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoPreview} alt="" className="size-12 rounded-pill border border-rule object-cover" />
              ) : (
                <span className="grid size-12 place-items-center rounded-pill bg-accent-soft font-display text-lg text-accent-ink">
                  {venueName.charAt(0)}
                </span>
              )}
              <input
                ref={logoInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pickLogo(e.target.files?.[0])}
              />
              <button type="button" onClick={() => logoInput.current?.click()} className={`${btn} border border-rule-strong text-ink-2 hover:border-ink hover:text-ink`}>
                {logoPreview ? "Replace" : "Upload logo"}
              </button>
              {logoPreview ? (
                <button
                  type="button"
                  onClick={() => {
                    setLogoPreview(null);
                    setLogoField("");
                    setSaved(false);
                  }}
                  className={`${btn} text-ink-3 hover:text-clay-ink`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>

          {/* Cover */}
          <div>
            <p className="text-[0.875rem] text-ink-2">Cover photo</p>
            {coverPreview ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={coverPreview} alt="" className="mt-2 h-24 w-full rounded-lg border border-rule object-cover" />
            ) : (
              <div className="mt-2 grid h-24 place-items-center rounded-lg border border-dashed border-rule-strong bg-paper-2 text-[0.8125rem] text-ink-3">
                No cover yet
              </div>
            )}
            <div className="mt-2 flex items-center gap-3">
              <input
                ref={coverInput}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                className="hidden"
                onChange={(e) => pickCover(e.target.files?.[0])}
              />
              <button type="button" onClick={() => coverInput.current?.click()} className={`${btn} border border-rule-strong text-ink-2 hover:border-ink hover:text-ink`}>
                {coverPreview ? "Replace" : "Upload cover"}
              </button>
              {coverPreview ? (
                <button
                  type="button"
                  onClick={() => {
                    setCoverPreview(null);
                    setCoverField("");
                    setSaved(false);
                  }}
                  className={`${btn} text-ink-3 hover:text-clay-ink`}
                >
                  Remove
                </button>
              ) : null}
            </div>
          </div>
        </div>

        {/* Live preview */}
        <div>
          <p className="text-[0.875rem] text-ink-2">Preview</p>
          <div data-brand={theme} className="mt-2 overflow-hidden rounded-xl border border-rule">
            <div className="h-20 w-full bg-accent">
              {coverPreview ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={coverPreview} alt="" className="h-20 w-full object-cover" />
              ) : null}
            </div>
            <div className="p-4">
              <div className="-mt-9 flex items-end gap-3">
                {logoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoPreview} alt="" className="size-12 rounded-xl border-4 border-card object-cover" />
                ) : (
                  <span className="grid size-12 place-items-center rounded-xl border-4 border-card bg-accent-soft font-display text-lg text-accent-ink">
                    {venueName.charAt(0)}
                  </span>
                )}
              </div>
              <p className="mt-2 font-medium">{venueName}</p>
              {tagline ? <p className="text-[0.8125rem] text-ink-3">{tagline}</p> : null}
              <div className="mt-3 flex items-center gap-2">
                <span className="rounded-pill bg-accent px-3 py-1 text-[0.75rem] text-on-accent">Court 1</span>
                <span className="rounded-pill bg-accent-soft px-3 py-1 text-[0.75rem] text-accent-ink">18:00</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {error ? (
        <p className="mt-5 rounded-sm border border-clay/40 bg-clay-soft px-3 py-2 text-[0.875rem] text-clay-ink">
          {error}
        </p>
      ) : null}

      <div className="mt-6 flex items-center gap-3">
        <button
          type="button"
          onClick={submit}
          disabled={pending}
          className="rounded-pill bg-accent px-5 py-2 text-[0.875rem] font-medium text-on-accent hover:bg-accent-hover disabled:opacity-45"
        >
          {pending ? "Saving…" : "Save branding"}
        </button>
        {saved ? <span className="text-[0.8125rem] text-accent-ink">Saved ✓</span> : null}
      </div>
    </section>
  );
}
