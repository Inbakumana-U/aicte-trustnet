import nacl from 'tweetnacl';
import type { CredentialEnvelope, CredentialPayload } from './api';

/** Reproduces Python's json.dumps(sort_keys=True, separators=(",", ":")) exactly. */
export function canonicalStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalStringify(item)).join(',')}]`;
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalStringify(item)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

export function hexToBytes(hex: string): Uint8Array {
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-f]/i.test(hex)) {
    throw new Error('Malformed hex string');
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return bytes;
}

export function extractCredential(raw: string): CredentialEnvelope {
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Credential must be a JSON object');
  }
  const record = parsed as Record<string, unknown>;

  const signature =
    typeof record.signature === 'string'
      ? record.signature
      : typeof record.sig === 'string'
        ? record.sig
        : undefined;

  if (!signature) {
    throw new Error('No Ed25519 signature found in this credential');
  }

  if (record.payload && typeof record.payload === 'object') {
    return {
      payload: record.payload as CredentialPayload,
      signature,
      algorithm: typeof record.algorithm === 'string' ? record.algorithm : 'Ed25519',
      issuer: typeof record.issuer === 'string' ? record.issuer : 'AICTE-APEX',
    };
  }

  const payload: Record<string, unknown> = { ...record };
  delete payload.signature;
  delete payload.sig;
  delete payload.algorithm;
  delete payload.issuer;

  return {
    payload: payload as unknown as CredentialPayload,
    signature,
    algorithm: typeof record.algorithm === 'string' ? record.algorithm : 'Ed25519',
    issuer: typeof record.issuer === 'string' ? record.issuer : 'AICTE-APEX',
  };
}

export function verifyCredentialLocally(
  credential: CredentialEnvelope,
  publicKeyHex: string,
): boolean {
  if (!credential.payload || typeof credential.payload !== 'object') {
    throw new Error('Credential payload is missing');
  }
  const message = new TextEncoder().encode(canonicalStringify(credential.payload));
  const signature = hexToBytes(credential.signature);
  const publicKey = hexToBytes(publicKeyHex);
  if (signature.length !== nacl.sign.signatureLength || publicKey.length !== 32) {
    return false;
  }
  return nacl.sign.detached.verify(message, signature, publicKey);
}

export const INVALID_SIGNATURE_MESSAGE =
  'Tamper / Fraud Detected — Cryptographic Signature Mismatch';
