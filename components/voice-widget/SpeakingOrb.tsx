"use client";

import { useEffect, useState } from "react";

const ORB_SPIN =
  "conic-gradient(from 210deg, #073888 0deg, #3ecfff 24deg, #0a4ec8 52deg, #9cf6ff 78deg, #0d46b8 112deg, #f4fffe 146deg, #1258dc 178deg, #5ad8ff 210deg, #ffffff 238deg, #0e62e6 270deg, #c8fbff 304deg, #083888 336deg, #073888 360deg)";

export function SpeakingOrb({ getLevel }: { getLevel: () => number }) {
  const [energy, setEnergy] = useState(0);

  useEffect(() => {
    let frame = 0;
    let shown = 0;
    const tick = () => {
      const raw = Math.min(1, Math.max(0, getLevel()) * 8);
      shown += (raw - shown) * 0.35;
      setEnergy((current) => (Math.abs(current - shown) < 0.012 ? current : shown));
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [getLevel]);

  const scale = 1 + energy * 0.06;

  return (
    <div className="grid place-items-center" data-orb="true" style={{ transform: `scale(${scale})` }}>
      <style>{`
        @keyframes voice-widget-orb-spin {
          to { transform: rotate(360deg); }
        }
        @media (prefers-reduced-motion: no-preference) {
          .voice-widget-orb-spin { animation: voice-widget-orb-spin 18s linear infinite; }
          .voice-widget-orb-spin[data-speaking="true"] { animation-duration: 7s; }
        }
      `}</style>
      <div className="relative h-[min(15rem,42dvh)] w-[min(15rem,42dvh)]">
        <div className="absolute inset-0 overflow-hidden rounded-full shadow-[inset_0_0_24px_rgba(255,255,255,0.18)]">
          <div
            className="voice-widget-orb-spin absolute -inset-10"
            data-speaking={energy > 0.04 ? "true" : "false"}
            style={{ background: ORB_SPIN, filter: "blur(2px)" }}
          />
          <div
            aria-hidden="true"
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(circle at 84% 48%, rgba(255,255,255,0.92) 0%, rgba(255,255,255,0.28) 12%, rgba(255,255,255,0) 34%)",
            }}
          />
        </div>
      </div>
    </div>
  );
}
