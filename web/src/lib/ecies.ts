/**
 * ECIES implementation matching go-ethereum's crypto/ecies package exactly.
 *
 * Wire format: ephemeralPub(65) || IV(16) || ciphertext || HMAC(32)
 * KDF: NIST SP800-56 Concatenation KDF with SHA-256, 32 bytes output
 * Sym: AES-128-CTR (first 16 KDF bytes = AES key)
 * MAC: HMAC-SHA-256 keyed with SHA-256(KDF bytes 16..31), over IV||ciphertext
 * s1/s2 shared info: both empty (nil), matching go-ethereum default
 *
 * ponytail: hand-rolled because eciesjs uses AES-256-GCM+HKDF; no match to go-ethereum
 */

import { secp256k1 } from "@noble/curves/secp256k1.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { hmac } from "@noble/hashes/hmac.js";
import { ctr } from "@noble/ciphers/aes";
import { randomBytes } from "@noble/ciphers/webcrypto";

// NIST SP800-56 Concatenation KDF with SHA-256 (no s1/s2 shared info).
// Matches go-ethereum: sha256(counter || sharedX) iterated, take outLen bytes.
function concatKDF(sharedX: Uint8Array, outLen: number): Uint8Array {
  const iterations = Math.ceil(outLen / 32);
  const out = new Uint8Array(iterations * 32);
  for (let i = 1; i <= iterations; i++) {
    const counter = new Uint8Array(4);
    new DataView(counter.buffer).setUint32(0, i, false); // big-endian
    const h = sha256.create();
    h.update(counter);
    h.update(sharedX);
    out.set(h.digest(), (i - 1) * 32);
  }
  return out.subarray(0, outLen);
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const total = arrays.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const a of arrays) {
    out.set(a, offset);
    offset += a.length;
  }
  return out;
}

function hexToBytes(hex: string): Uint8Array {
  const h = hex.startsWith("0x") ? hex.slice(2) : hex;
  const padded = h.length % 2 ? "0" + h : h;
  const bytes = new Uint8Array(padded.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return (
    "0x" +
    Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("")
  );
}

export function newEphemeralKey(): { privHex: string; pubHex: string } {
  const priv = secp256k1.utils.randomSecretKey();
  const pub = secp256k1.getPublicKey(priv, false); // uncompressed 65 bytes
  return { privHex: bytesToHex(priv), pubHex: bytesToHex(pub) };
}

/**
 * Encrypt plaintext for a TEE's uncompressed secp256k1 public key.
 * teePubHex: "0x04||X||Y" (65 bytes, uncompressed)
 */
export function encryptToTee(teePubHex: string, plaintext: Uint8Array): Uint8Array {
  const pubBytes = hexToBytes(teePubHex);

  // Generate ephemeral key pair
  const ephPriv = secp256k1.utils.randomSecretKey();
  const ephPub = secp256k1.getPublicKey(ephPriv, false); // uncompressed 65 bytes

  // ECDH: getSharedSecret(ephPriv, receiverPub, compressed=true) → 33 bytes (02/03 || x)
  const sharedCompressed = secp256k1.getSharedSecret(ephPriv, pubBytes, true);
  const sharedX = sharedCompressed.slice(1, 33); // 32 bytes x-coordinate

  // KDF: 32 bytes → first 16 = AES-128 key, next 16 = MAC key material
  const keyMaterial = concatKDF(sharedX, 32);
  const aesKey = keyMaterial.slice(0, 16);
  const macKeyMaterial = keyMaterial.slice(16, 32);
  const macKey = sha256(macKeyMaterial);

  // AES-128-CTR encrypt
  const iv = randomBytes(16);
  const stream = ctr(aesKey, iv);
  const ciphertext = stream.encrypt(plaintext);

  // HMAC-SHA-256 over IV || ciphertext (s2 = empty, matches go-ethereum nil)
  const tag = hmac(sha256, macKey, concat(iv, ciphertext));

  // Wire: ephPub(65) || IV(16) || ciphertext || tag(32)
  return concat(ephPub, iv, ciphertext, tag);
}

/**
 * Decrypt ECIES ciphertext using a secp256k1 private key.
 * privHex: 32-byte private key as "0x..." hex
 */
export function decryptWith(privHex: string, ciphertext: Uint8Array): Uint8Array {
  // Wire: ephPub(65) || IV(16) || ct || HMAC(32)
  if (ciphertext.length < 65 + 16 + 32) {
    throw new Error("ciphertext too short");
  }

  const ephPubBytes = ciphertext.slice(0, 65);
  const iv = ciphertext.slice(65, 81);
  const ct = ciphertext.slice(81, ciphertext.length - 32);
  const tag = ciphertext.slice(ciphertext.length - 32);

  const privBytes = hexToBytes(privHex);

  // ECDH: sharedSecret(priv, ephPub, compressed=true) → 33 bytes
  const sharedCompressed = secp256k1.getSharedSecret(privBytes, ephPubBytes, true);
  const sharedX = sharedCompressed.slice(1, 33);

  const keyMaterial = concatKDF(sharedX, 32);
  const aesKey = keyMaterial.slice(0, 16);
  const macKeyMaterial = keyMaterial.slice(16, 32);
  const macKey = sha256(macKeyMaterial);

  // Verify HMAC (constant-time comparison)
  const expected = hmac(sha256, macKey, concat(iv, ct));
  let diff = 0;
  for (let i = 0; i < 32; i++) diff |= expected[i] ^ tag[i];
  if (diff !== 0) throw new Error("mac verification failed");

  // AES-128-CTR decrypt
  const stream = ctr(aesKey, iv);
  return stream.decrypt(ct);
}
