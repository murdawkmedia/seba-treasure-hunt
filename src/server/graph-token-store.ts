export interface StoredGraphRefreshToken {
  refreshToken: string;
  stateVersion: number;
}

export interface GraphRefreshTokenStore {
  load(): Promise<StoredGraphRefreshToken | null>;
  save(expectedVersion: number | null, refreshToken: string): Promise<boolean>;
}

interface GraphTokenRow {
  encrypted_refresh_token: string;
  nonce: string;
  key_version: string;
  state_version: number;
}

const provider = "microsoft_graph";
const unavailableMessage = "Graph token state unavailable.";
const base64Pattern = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function unavailable(): Error {
  return new Error(unavailableMessage);
}

function decodeBase64(value: string): Uint8Array {
  if (!value || value.length % 4 !== 0 || !base64Pattern.test(value)) throw unavailable();
  return Uint8Array.from(atob(value), (character) => character.charCodeAt(0));
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function changed(result: D1Result): boolean {
  const changes = result.meta?.changes;
  if (changes === 1) return true;
  if (changes === 0) return false;
  throw unavailable();
}

export class D1GraphTokenStore implements GraphRefreshTokenStore {
  constructor(
    private readonly db: D1Database | null,
    private readonly encryptionKeyBase64: string | null,
    private readonly keyVersion: string | null,
  ) {}

  async load(): Promise<StoredGraphRefreshToken | null> {
    try {
      const { db, key, keyVersion } = await this.configuration();
      const row = await db
        .prepare(
          `SELECT encrypted_refresh_token, nonce, key_version, state_version
           FROM oauth_provider_state WHERE provider = ?`
        )
        .bind(provider)
        .first<GraphTokenRow>();
      if (row === null) return null;
      if (
        row.key_version !== keyVersion ||
        !Number.isInteger(row.state_version) ||
        row.state_version < 1
      ) {
        throw unavailable();
      }

      const nonce = decodeBase64(row.nonce);
      if (nonce.byteLength !== 12) throw unavailable();
      const ciphertext = decodeBase64(row.encrypted_refresh_token);
      const plaintext = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv: nonce },
        key,
        ciphertext
      );
      const refreshToken = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        plaintext
      );
      return { refreshToken, stateVersion: row.state_version };
    } catch {
      throw unavailable();
    }
  }

  async save(expectedVersion: number | null, refreshToken: string): Promise<boolean> {
    try {
      if (
        expectedVersion !== null &&
        (!Number.isInteger(expectedVersion) || expectedVersion < 1)
      ) {
        throw unavailable();
      }
      const { db, key, keyVersion } = await this.configuration();
      const nonce = new Uint8Array(12);
      crypto.getRandomValues(nonce);
      const ciphertext = new Uint8Array(
        await crypto.subtle.encrypt(
          { name: "AES-GCM", iv: nonce },
          key,
          new TextEncoder().encode(refreshToken)
        )
      );
      const encryptedRefreshToken = encodeBase64(ciphertext);
      const encodedNonce = encodeBase64(nonce);
      const now = new Date().toISOString();

      if (expectedVersion === null) {
        const result = await db
          .prepare(
            `INSERT INTO oauth_provider_state
             (provider, encrypted_refresh_token, nonce, key_version, state_version, created_at, updated_at)
             VALUES (?, ?, ?, ?, 1, ?, ?)
             ON CONFLICT(provider) DO NOTHING`
          )
          .bind(provider, encryptedRefreshToken, encodedNonce, keyVersion, now, now)
          .run();
        return changed(result);
      }

      const result = await db
        .prepare(
          `UPDATE oauth_provider_state
           SET encrypted_refresh_token = ?, nonce = ?, key_version = ?,
               state_version = state_version + 1, updated_at = ?
           WHERE provider = ? AND state_version = ?`
        )
        .bind(
          encryptedRefreshToken,
          encodedNonce,
          keyVersion,
          now,
          provider,
          expectedVersion
        )
        .run();
      return changed(result);
    } catch {
      throw unavailable();
    }
  }

  private async configuration(): Promise<{
    db: D1Database;
    key: CryptoKey;
    keyVersion: string;
  }> {
    if (!this.db || !this.encryptionKeyBase64 || !this.keyVersion) throw unavailable();
    const keyBytes = decodeBase64(this.encryptionKeyBase64);
    if (keyBytes.byteLength !== 32) throw unavailable();
    const key = await crypto.subtle.importKey("raw", keyBytes, "AES-GCM", false, [
      "encrypt",
      "decrypt"
    ]);
    return { db: this.db, key, keyVersion: this.keyVersion };
  }
}
