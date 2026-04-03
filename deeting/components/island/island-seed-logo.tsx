"use client";

import { cn } from "@/lib/utils";

interface IslandSeedLogoProps {
  size?: number;
  isActive?: boolean;
  className?: string;
}

export function IslandSeedLogo({
  size = 20,
  isActive = false,
  className,
}: IslandSeedLogoProps) {
  return (
    <div
      className={cn(
        "relative flex items-center justify-center shrink-0",
        isActive
          ? "animate-[island-breathe_3s_ease-in-out_infinite]"
          : "animate-[island-seed-sway_4s_ease-in-out_infinite]",
        className
      )}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
      >
        {/* Seed body */}
        <path
          d="M12 21c-1.5-2-3-5.5-3-9 0-4.5 1.5-7.5 3-9 1.5 1.5 3 4.5 3 9 0 3.5-1.5 7-3 9Z"
          fill="var(--island-gold-stroke)"
          fillOpacity={0.18}
          stroke="var(--island-gold-stroke)"
          strokeWidth={1.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Sprout leaf left */}
        <path
          d="M12 8C9.5 6.5 7 7 5.5 9c1.5 0.2 4 0.5 6.5-1Z"
          fill="var(--island-gold-stroke)"
          fillOpacity={0.25}
          stroke="var(--island-gold-stroke)"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Sprout leaf right */}
        <path
          d="M12 8c2.5-1.5 5-1 6.5 1-1.5 0.2-4 0.5-6.5-1Z"
          fill="var(--island-gold-stroke)"
          fillOpacity={0.25}
          stroke="var(--island-gold-stroke)"
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}
