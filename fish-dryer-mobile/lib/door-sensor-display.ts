import { coerceHardwareStatus } from "@/lib/hardware-status-rtdb";

export const DOOR_SENSOR_UI_LABEL = "Door Sensor (MC38)";

export type DoorOpenClosed = "Open" | "Closed";

/** Overview card uses lowercase; Hardware screen title-cases "Not Working". */
export type DoorSensorDisplayLabel = DoorOpenClosed | "not_working";

export function isDoorSensorUiLabel(name: string): boolean {
  return String(name ?? "").trim() === DOOR_SENSOR_UI_LABEL;
}

/** Live sensor: magnet apart (or unknown) = open. Offline / not_working ⇒ treat as not open. */
export function readRealDoorIsOpen(
  doorReading?: unknown,
  options?: { streamLive?: boolean }
): boolean {
  if (options?.streamLive === false) return false;
  const d = String(doorReading ?? "").trim().toLowerCase();
  return d !== "closed";
}

export function formatDoorSensorDisplay(
  doorReading?: unknown,
  options?: {
    forceClosed?: boolean;
    /** False when ESP32 / RTDB stream is offline or stale. */
    streamLive?: boolean;
    componentStatus?: unknown;
  }
): DoorSensorDisplayLabel {
  if (options?.streamLive === false) return "not_working";

  const componentSt = coerceHardwareStatus(options?.componentStatus ?? "working");
  if (componentSt === "not_working") return "not_working";

  if (options?.forceClosed) return "Closed";

  const d = String(doorReading ?? "").trim().toLowerCase();
  if (d === "closed") return "Closed";
  return "Open";
}

/** @deprecated Prefer {@link formatDoorSensorDisplay} with stream / component context. */
export function formatDoorOpenClosed(
  doorReading?: unknown,
  options?: { forceClosed?: boolean }
): DoorOpenClosed {
  const label = formatDoorSensorDisplay(doorReading, {
    forceClosed: options?.forceClosed,
    streamLive: true,
    componentStatus: "working",
  });
  if (label === "not_working") return "Open";
  return label;
}

export function doorSensorDisplayColor(label: DoorSensorDisplayLabel): string {
  if (label === "not_working") return "#e74c3c";
  if (label === "Closed") return "#2ecc71";
  return "#f59e0b";
}

export function doorSensorDisplayColorHardware(label: DoorSensorDisplayLabel): string {
  if (label === "not_working") return "#ef4444";
  if (label === "Closed") return "#22c55e";
  return "#f59e0b";
}

export function doorSensorDisplayTitle(label: DoorSensorDisplayLabel): string {
  if (label === "not_working") return "Not Working";
  return label;
}
