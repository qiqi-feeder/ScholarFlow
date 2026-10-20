import { randomBytes } from "node:crypto";

const ALPHABET = "0123456789abcdefghjkmnpqrstvwxyz";

/** Sortable, human-readable identifier with an entity prefix. */
export function createId(prefix: string, now = Date.now()): string {
  let time = now;
  let stamp = "";
  for (let i = 0; i < 10; i += 1) {
    stamp = ALPHABET[time % 32]! + stamp;
    time = Math.floor(time / 32);
  }
  const random = randomBytes(10);
  let suffix = "";
  for (const byte of random) suffix += ALPHABET[byte % 32];
  return `${prefix}_${stamp}${suffix}`;
}

export function isId(value: unknown, prefix: string): value is string {
  return typeof value === "string" && new RegExp(`^${prefix}_[0-9a-z]{20}$`).test(value);
}
