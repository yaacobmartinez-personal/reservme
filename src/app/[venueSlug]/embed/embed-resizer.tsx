"use client";

import { useEffect } from "react";

/**
 * Tells the host page how tall the embed is, so the iframe can size to its
 * content with no inner scrollbar. The host listens for
 * { type: "reservme:resize", height }.
 *
 * We poll scrollHeight rather than use a ResizeObserver: the booking widget
 * grows and shrinks as slots and the form appear, and an observer on the root
 * box doesn't reliably fire on that content reflow across browsers. A cheap
 * 250ms poll that only posts on a real change is the portable, bulletproof way
 * to keep any host (WordPress, React, plain HTML) in sync.
 */
export function EmbedResizer() {
  useEffect(() => {
    let last = -1;
    const post = () => {
      const height = document.documentElement.scrollHeight;
      if (height !== last) {
        last = height;
        window.parent?.postMessage({ type: "reservme:resize", height }, "*");
      }
    };
    post();
    const id = window.setInterval(post, 250);
    window.addEventListener("load", post);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("load", post);
    };
  }, []);

  return null;
}
