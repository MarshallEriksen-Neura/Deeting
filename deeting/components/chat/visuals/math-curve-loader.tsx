"use client";

import { useEffect, useRef } from "react";

import { cn } from "@/lib/utils";

type Curve = "rose3" | "lissajous";

const POINT_FN: Record<Curve, (t: number, pulse: number) => [number, number]> = {
  rose3: (t, pulse) => {
    const breath = 1 + 0.12 * Math.sin(pulse);
    const r = breath * Math.cos(3 * t);
    return [Math.cos(t) * r * 0.42, Math.sin(t) * r * 0.42];
  },
  lissajous: (t, pulse) => {
    const k = 1 + 0.08 * Math.sin(pulse);
    return [Math.sin(3 * t) * k * 0.4, Math.sin(2 * t + Math.PI / 2) * k * 0.4];
  },
};

const STATIC_PATH: Record<Curve, string> = {
  rose3:
    "M0.920 0.500L0.907 0.532L0.870 0.559L0.811 0.575L0.735 0.576L0.648 0.562L0.559 0.530L0.472 0.483L0.395 0.424L0.333 0.357L0.290 0.290L0.267 0.228L0.265 0.177L0.281 0.143L0.312 0.130L0.352 0.142L0.395 0.177L0.436 0.235L0.470 0.312L0.492 0.402L0.500 0.500L0.492 0.598L0.470 0.688L0.436 0.765L0.395 0.823L0.352 0.858L0.312 0.870L0.281 0.857L0.265 0.823L0.267 0.772L0.290 0.710L0.333 0.643L0.395 0.576L0.472 0.517L0.559 0.470L0.648 0.438L0.735 0.424L0.811 0.425L0.870 0.441L0.907 0.468L0.920 0.500L0.907 0.532L0.870 0.559L0.811 0.575L0.735 0.576L0.648 0.562L0.559 0.530L0.472 0.483L0.395 0.424L0.333 0.357L0.290 0.290L0.267 0.228L0.265 0.177L0.281 0.143L0.312 0.130L0.352 0.142L0.395 0.177L0.436 0.235L0.470 0.312L0.492 0.402L0.500 0.500L0.492 0.598L0.470 0.688L0.436 0.765L0.395 0.823L0.352 0.858L0.312 0.870L0.281 0.857L0.265 0.823L0.267 0.772L0.290 0.710L0.333 0.643L0.395 0.576L0.472 0.517L0.559 0.470L0.648 0.438L0.735 0.424L0.811 0.425L0.870 0.441L0.907 0.468L0.920 0.500",
  lissajous:
    "M0.500 0.900L0.593 0.895L0.682 0.880L0.760 0.856L0.824 0.824L0.870 0.783L0.895 0.735L0.899 0.682L0.880 0.624L0.841 0.563L0.783 0.500L0.709 0.437L0.624 0.376L0.531 0.318L0.437 0.265L0.347 0.217L0.265 0.176L0.196 0.144L0.144 0.120L0.111 0.105L0.100 0.100L0.111 0.105L0.144 0.120L0.196 0.144L0.265 0.176L0.347 0.217L0.437 0.265L0.531 0.318L0.624 0.376L0.709 0.437L0.783 0.500L0.841 0.563L0.880 0.624L0.899 0.682L0.895 0.735L0.870 0.783L0.824 0.824L0.760 0.856L0.682 0.880L0.593 0.895L0.500 0.900L0.407 0.895L0.318 0.880L0.240 0.856L0.176 0.824L0.130 0.783L0.105 0.735L0.101 0.682L0.120 0.624L0.159 0.563L0.217 0.500L0.291 0.437L0.376 0.376L0.469 0.318L0.563 0.265L0.653 0.217L0.735 0.176L0.804 0.144L0.856 0.120L0.889 0.105L0.900 0.100L0.889 0.105L0.856 0.120L0.804 0.144L0.735 0.176L0.653 0.217L0.563 0.265L0.469 0.318L0.376 0.376L0.291 0.437L0.217 0.500L0.159 0.563L0.120 0.624L0.101 0.682L0.105 0.735L0.130 0.783L0.176 0.824L0.240 0.856L0.318 0.880L0.407 0.895L0.500 0.900",
};

interface MathCurveLoaderProps {
  curve?: Curve;
  size?: number;
  particles?: number;
  trail?: number;
  loopMs?: number;
  pulseMs?: number;
  className?: string;
  label?: string;
  showTrace?: boolean;
}

export function MathCurveLoader({
  curve = "rose3",
  size = 20,
  particles = 18,
  trail = 0.3,
  loopMs = 2400,
  pulseMs = 3200,
  className,
  label = "AI is thinking",
  showTrace = true,
}: MathCurveLoaderProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const mql =
      typeof window !== "undefined" && typeof window.matchMedia === "function"
        ? window.matchMedia("(prefers-reduced-motion: reduce)")
        : null;
    if (mql?.matches) return;

    const circles = Array.from(
      svg.querySelectorAll<SVGCircleElement>("circle[data-curve-particle]"),
    );
    if (circles.length === 0) return;

    const fn = POINT_FN[curve];
    const start = performance.now();
    let raf = 0;
    let running = true;

    const draw = (now: number) => {
      const elapsed = now - start;
      const base = (elapsed % loopMs) / loopMs;
      const pulse = ((elapsed % pulseMs) / pulseMs) * Math.PI * 2;
      for (let i = 0; i < circles.length; i++) {
        const p = (base + (i / circles.length) * trail) % 1;
        const t = p * Math.PI * 2;
        const [x, y] = fn(t, pulse);
        const c = circles[i];
        c.setAttribute("cx", (0.5 + x).toFixed(4));
        c.setAttribute("cy", (0.5 + y).toFixed(4));
        c.setAttribute(
          "opacity",
          (0.18 + (i / circles.length) * 0.82).toFixed(3),
        );
      }
    };

    const tick = (now: number) => {
      if (!running) return;
      draw(now);
      raf = requestAnimationFrame(tick);
    };

    const stop = () => {
      if (!running) return;
      running = false;
      if (raf) cancelAnimationFrame(raf);
    };
    const startLoop = () => {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else startLoop();
    };

    const io = new IntersectionObserver(
      ([entry]) => {
        if (!entry) return;
        if (entry.isIntersecting) startLoop();
        else stop();
      },
      { threshold: 0 },
    );
    io.observe(svg);
    document.addEventListener("visibilitychange", onVisibility);

    draw(performance.now());
    raf = requestAnimationFrame(tick);

    return () => {
      running = false;
      if (raf) cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [curve, trail, loopMs, pulseMs]);

  const radius = size >= 36 ? 0.018 : size >= 20 ? 0.024 : 0.03;

  return (
    <svg
      ref={svgRef}
      viewBox="0 0 1 1"
      width={size}
      height={size}
      role="status"
      aria-label={label}
      className={cn(
        "shrink-0 text-[#6d5cff] dark:text-[var(--accent)]",
        className,
      )}
    >
      {showTrace ? (
        <path
          d={STATIC_PATH[curve]}
          fill="none"
          stroke="currentColor"
          strokeWidth={1}
          vectorEffect="non-scaling-stroke"
          strokeLinejoin="round"
          opacity={0.22}
        />
      ) : null}
      {Array.from({ length: particles }).map((_, i) => (
        <circle
          key={i}
          data-curve-particle
          r={radius}
          fill="currentColor"
          cx={0.5}
          cy={0.5}
        />
      ))}
    </svg>
  );
}
