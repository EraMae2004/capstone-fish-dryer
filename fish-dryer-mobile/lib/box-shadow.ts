import type { ViewStyle } from "react-native";

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const raw = hex.replace("#", "").trim();
  const full =
    raw.length === 3
      ? raw
          .split("")
          .map((c) => c + c)
          .join("")
      : raw.padEnd(6, "0").slice(0, 6);
  const n = Number.parseInt(full, 16);
  if (!Number.isFinite(n)) return { r: 0, g: 0, b: 0 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

/** Expo web rejects shadow* — use boxShadow + Android elevation. */
export function boxShadowStyle(opts: {
  color?: string;
  offsetX?: number;
  offsetY?: number;
  blur?: number;
  opacity?: number;
  elevation?: number;
}): ViewStyle {
  const { r, g, b } = hexToRgb(opts.color ?? "#000000");
  const ox = opts.offsetX ?? 0;
  const oy = opts.offsetY ?? 8;
  const blur = opts.blur ?? 16;
  const opacity = opts.opacity ?? 0.2;
  return {
    boxShadow: `${ox}px ${oy}px ${blur}px rgba(${r},${g},${b},${opacity})`,
    ...(opts.elevation != null ? { elevation: opts.elevation } : {}),
  };
}
