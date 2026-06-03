import * as FileSystem from "expo-file-system/legacy";
import { API_BASE_URL } from "@/config/api";

export type ProfileUser = {
  id: number;
  name?: string;
  phone?: string;
  birthdate?: string | null;
  email?: string;
  address?: string;
  profile_picture?: string | null;
};

function parseApiError(data: unknown, fallback: string): string {
  if (!data || typeof data !== "object") return fallback;
  const row = data as Record<string, unknown>;
  if (row.message) return String(row.message);
  if (row.errors && typeof row.errors === "object") {
    const flat = Object.values(row.errors as Record<string, unknown>).flat();
    if (flat.length) return flat.map(String).join("\n");
  }
  return fallback;
}

async function readResponseJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new Error(`Server returned invalid JSON (${res.status}).`);
  }
}

/** Upload or remove profile photo via JSON base64 — reliable on React Native. */
export async function uploadProfilePhotoJson(
  userId: number,
  opts: { imageUri?: string; remove?: boolean }
): Promise<ProfileUser> {
  const body: Record<string, unknown> = {};

  if (opts.remove) {
    body.remove_image = "1";
  } else if (opts.imageUri) {
    const uri = opts.imageUri;
    const filename = uri.split("/").pop()?.split("?")[0] ?? "profile.jpg";
    const ext = filename.includes(".")
      ? (filename.split(".").pop()?.toLowerCase() ?? "jpg")
      : "jpg";
    const safeExt = ext === "png" ? "png" : "jpg";

    const base64 = await FileSystem.readAsStringAsync(uri, {
      encoding: FileSystem.EncodingType.Base64,
    });

    body.profile_picture_base64 = base64;
    body.profile_picture_ext = safeExt;
  } else {
    throw new Error("No image to upload.");
  }

  const res = await fetch(`${API_BASE_URL}/mobile/update-profile-photo/${userId}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const data = await readResponseJson(res);
  if (!res.ok || !(data as { success?: boolean }).success) {
    throw new Error(parseApiError(data, `Upload failed (${res.status}).`));
  }

  return (data as { user: ProfileUser }).user;
}

/** Save text fields, then optional photo add/remove in one Save action. */
export async function saveProfileComplete(
  userId: number,
  fields: {
    name: string;
    phone: string;
    email: string;
    birthdate: string;
    address: string;
  },
  photo: { imageUri?: string | null; remove?: boolean }
): Promise<ProfileUser> {
  if (photo.remove) {
    await uploadProfilePhotoJson(userId, { remove: true });
  } else if (photo.imageUri) {
    await uploadProfilePhotoJson(userId, { imageUri: photo.imageUri });
  }

  return updateProfileFieldsJson(userId, fields);
}

/** Text fields only — no multipart. */
export async function updateProfileFieldsJson(
  userId: number,
  fields: {
    name: string;
    phone: string;
    email: string;
    birthdate: string;
    address: string;
  }
): Promise<ProfileUser> {
  const payload: Record<string, string> = {
    name: fields.name,
    phone: fields.phone,
    email: fields.email,
    address: fields.address,
  };
  const bd = fields.birthdate.trim();
  if (bd) payload.birthdate = bd;

  const res = await fetch(`${API_BASE_URL}/mobile/update-profile/${userId}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  const data = await readResponseJson(res);
  if (!res.ok || !(data as { success?: boolean }).success) {
    throw new Error(parseApiError(data, `Save failed (${res.status}).`));
  }

  return (data as { user: ProfileUser }).user;
}
