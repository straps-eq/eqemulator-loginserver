"use client";

import { useEffect, useRef } from "react";

export function MouseSpotlight() {
  const revealRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = revealRef.current;
    if (!el) return;

    let raf = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;
    let visible = false;

    const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

    const animate = () => {
      currentX = lerp(currentX, targetX, 0.08);
      currentY = lerp(currentY, targetY, 0.08);
      el.style.setProperty(
        "-webkit-mask-image",
        `radial-gradient(500px circle at ${currentX}px ${currentY}px, black 0%, transparent 70%)`
      );
      el.style.setProperty(
        "mask-image",
        `radial-gradient(500px circle at ${currentX}px ${currentY}px, black 0%, transparent 70%)`
      );
      raf = requestAnimationFrame(animate);
    };

    const onMove = (e: MouseEvent) => {
      targetX = e.clientX;
      targetY = e.clientY;
      if (!visible) {
        currentX = targetX;
        currentY = targetY;
        visible = true;
        el.style.opacity = "1";
      }
    };

    const onLeave = () => {
      visible = false;
      el.style.opacity = "0";
    };

    raf = requestAnimationFrame(animate);
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseleave", onLeave);
    return () => {
      cancelAnimationFrame(raf);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseleave", onLeave);
    };
  }, []);

  return (
    <div
      ref={revealRef}
      className="fixed inset-0 pointer-events-none z-[1] transition-opacity duration-700"
      style={{
        opacity: 0,
        background: "url('/bg-norrath.png') center center / cover no-repeat",
        filter: "brightness(0.6)",
      }}
    />
  );
}
