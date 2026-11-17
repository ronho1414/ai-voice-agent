"use client";

import { useEffect, useState } from "react";

export function SpeakingOrb({
  getLevel,
  caption,
  onInterrupt,
}: {
  getLevel: () => number;
  caption: string;
  onInterrupt: () => void;
}) {
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

  const core = 1 + energy * 0.18;
  const ring = 1 + energy * 0.48;
  const halo = 1 + energy * 0.12;

  return (
    <div className="flex flex-col items-center gap-4" data-orb="true">
      <style>{`
        @keyframes voice-widget-orb-breathe {
          0%, 100% { opacity: 0.38; }
          50% { opacity: 1; }
        }
        @media (prefers-reduced-motion: no-preference) {
          .voice-widget-orb-ring { animation: voice-widget-orb-breathe 1.6s ease-in-out infinite; }
        }
      `}</style>
      <button
        type="button"
        onClick={onInterrupt}
        aria-label="打斷語音"
        className="relative grid h-44 w-44 place-items-center"
      >
        <span
          aria-hidden="true"
          className="voice-widget-orb-ring absolute h-40 w-40 rounded-full border border-[#E4E4E4]"
          style={{ transform: `scale(${ring})` }}
        />
        <span
          aria-hidden="true"
          className="absolute h-32 w-32 rounded-full bg-white"
          style={{
            transform: `scale(${halo})`,
            boxShadow: `0 0 ${28 + energy * 36}px rgba(255, 255, 255, 0.95)`,
          }}
        />
        <span
          aria-hidden="true"
          className="h-28 w-28 rounded-full"
          style={{
            transform: `scale(${core})`,
            background:
              "radial-gradient(circle at 38% 32%, #f4f7e6 0%, #d7e4b4 46%, #c3d59a 78%, #b4c78b 100%)",
            boxShadow: `0 12px ${28 + energy * 42}px rgba(168, 190, 126, ${0.28 + energy * 0.45})`,
          }}
        />
      </button>
      {caption ? (
        <p
          className="max-w-[18rem] bg-black px-3 py-2 text-center text-sm font-semibold leading-5 text-white"
          aria-live="polite"
        >
          {caption}
        </p>
      ) : (
        <p className="h-9" aria-hidden="true" />
      )}
    </div>
  );
}
