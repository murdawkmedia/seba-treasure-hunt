import type { DeploymentEnvironment, ServiceKeyScope } from "./types";

export const SERVICE_KEY_SCOPES = [
  "case.read",
  "case.write",
  "reports.read",
  "reports.write",
  "media.read",
  "media.write",
  "publishing.read",
  "publishing.write",
  "moderation.read",
  "moderation.write",
  "inquiries.read",
  "inquiries.write",
  "people.read",
  "legal.read",
  "staff.read",
  "audit.read",
] as const satisfies readonly ServiceKeyScope[];

export interface ServiceKeySecretRecord {
  id: string;
  environment: DeploymentEnvironment;
  prefix: string;
  hash: string;
}

const environmentCode = (environment: DeploymentEnvironment) =>
  environment === "validation" ? "val" : "prod";

const base64Url = (bytes: Uint8Array) => {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
};

const hex = (buffer: ArrayBuffer) =>
  [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");

export const serviceKeyPrefix = (plaintext: string) => plaintext.slice(0, 24);

export async function hashServiceKey(plaintext: string, pepper: string) {
  if (!pepper.trim()) throw new Error("A service-key pepper is required.");
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(pepper),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return hex(await crypto.subtle.sign("HMAC", key, encoder.encode(plaintext)));
}

export function parseServiceKey(
  plaintext: string,
  expectedEnvironment: DeploymentEnvironment
): { environment: DeploymentEnvironment; id: string } | null {
  const match = /^tls_(val|prod)_([A-Za-z0-9-]{4,64})_([A-Za-z0-9_-]+)$/.exec(plaintext);
  if (!match) return null;
  const environment = match[1] === "val" ? "validation" : "production";
  if (environment !== expectedEnvironment) return null;
  return { environment, id: match[2]! };
}

export async function createServiceKeyMaterial(input: {
  environment: DeploymentEnvironment;
  pepper: string;
  id?: string;
  randomBytes?: Uint8Array;
}) {
  const id = input.id ?? crypto.randomUUID();
  const randomBytes = input.randomBytes ?? crypto.getRandomValues(new Uint8Array(32));
  if (randomBytes.byteLength !== 32) throw new Error("Service keys require 256 bits of randomness.");
  const plaintext = `tls_${environmentCode(input.environment)}_${id}_${base64Url(randomBytes)}`;
  return {
    plaintext,
    record: {
      id,
      environment: input.environment,
      prefix: serviceKeyPrefix(plaintext),
      hash: await hashServiceKey(plaintext, input.pepper),
    } satisfies ServiceKeySecretRecord,
  };
}
