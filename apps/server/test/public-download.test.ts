import assert from "node:assert/strict";
import test from "node:test";
import { downloadPublic, isPublicAddress, selectDownloadAddress } from "../src/public-download.js";
test("RT07 scope guard: material URL import cannot bypass ownership via local host APIs", async () => {
  for (const ip of ["127.0.0.1", "10.0.0.1", "172.20.0.1", "192.168.1.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "fd00::1", "fe80::1"]) assert.equal(isPublicAddress(ip), false);
  assert.equal(isPublicAddress("8.8.8.8"), true); assert.equal(isPublicAddress("2606:4700::1111"), true);
  await assert.rejects(() => downloadPublic(new URL("http://127.0.0.1:3000/api/projects/foreign/tasks/private/memories")), /local\/private/);
  await assert.rejects(() => downloadPublic(new URL("http://[::1]:3000/api/projects")), /local\/private/);
  await assert.rejects(() => downloadPublic(new URL("http://localhost:3000/api/projects")), /local\/private/);
  await assert.rejects(() => downloadPublic(new URL("https://example.org"), 6), /public HTTP/);
  const synthetic = [{ address: "198.18.0.154", family: 4 }, { address: "fdfe:dcba::1", family: 6 }];
  assert.equal(selectDownloadAddress(new URL("https://example.org"), synthetic).address, synthetic[0]!.address);
  for (const url of ["http://example.org", "https://example.org:8787", "https://198.18.0.154", "https://localhost"]) assert.throws(() => selectDownloadAddress(new URL(url), synthetic), /local\/private/);
  assert.throws(() => selectDownloadAddress(new URL("https://example.org"), [{ address: "127.0.0.1", family: 4 }]), /local\/private/);
});
