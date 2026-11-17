"use client";

import { useEffect } from "react";

export function RedirectHome({
  hash,
  page,
  section,
}: {
  hash?: string;
  page?: string;
  section?: string;
}) {
  useEffect(() => {
    const url = page
      ? `/?page=${encodeURIComponent(page)}${section ? `&section=${encodeURIComponent(section)}` : ""}`
      : `/#${hash ?? "home"}`;
    window.location.replace(url);
  }, [hash, page, section]);

  return null;
}
