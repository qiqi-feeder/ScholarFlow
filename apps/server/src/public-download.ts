import http from "node:http";
import https from "node:https";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

export function isPublicAddress(address: string): boolean {
  if (isIP(address) === 6) return /^[23]/i.test(address); // Global unicast only; rejects mapped/loopback/link-local addresses.
  if (isIP(address) !== 4) return false;
  const [a, b] = address.split(".").map(Number) as [number, number];
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || a === 169 && b === 254 || a === 172 && b >= 16 && b <= 31 || a === 192 && [0, 168].includes(b) || a === 100 && b >= 64 && b <= 127 || a === 198 && [18, 19].includes(b));
}

export function selectDownloadAddress(url: URL, addresses: Array<{ address: string; family: number }>) {
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) throw new Error("material URL points to a local/private address");
  const publicAddress = addresses.find(a => isPublicAddress(a.address));
  // TUN proxies use the benchmarking pool as fake DNS. Permit a named HTTPS
  // origin on 443 only: normal TLS hostname verification remains mandatory.
  // Plain HTTP, literal pool IPs and local host API ports never take this path.
  const proxyAddress = url.protocol === "https:" && (!url.port || url.port === "443") && !isIP(hostname) && addresses.find(a => /^198\.(18|19)\./.test(a.address));
  const selected = publicAddress || proxyAddress;
  if (!selected) throw new Error("material URL points to a local/private address; cross-project host access is not allowed");
  return selected;
}

/** Pin the validated DNS result so URL import cannot read another local project
 * through the host HTTP API, including redirects and DNS rebinding. */
export async function downloadPublic(url: URL, hops = 0): Promise<Response> {
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || hops > 5) throw new Error("material download requires a public HTTP(S) URL without credentials");
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(hostname) ? [{ address: hostname, family: isIP(hostname) }] : await lookup(hostname, { all: true });
  const pinned = selectDownloadAddress(url, addresses);
  const response = await new Promise<Response>((resolve, reject) => {
    const request = (url.protocol === "https:" ? https : http).get(url, {
      headers: { "User-Agent": "ScholarFlow/0.1 local research workspace", "Accept-Encoding": "identity" },
      lookup: (_host, options, callback) => {
        if (options.all) callback(null, [pinned]); else callback(null, pinned.address, pinned.family);
      },
    }, incoming => {
      const status = incoming.statusCode ?? 500;
      const headers = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) if (value !== undefined) headers.set(name, Array.isArray(value) ? value.join(", ") : value);
      if (status >= 300 && status < 400 && headers.has("location")) { incoming.resume(); resolve(new Response(null, { status, headers })); return; }
      const chunks: Buffer[] = []; let bytes = 0;
      incoming.on("data", chunk => { bytes += chunk.length; if (bytes > 25 * 1024 * 1024) request.destroy(new Error("material exceeds the 25 MiB import limit")); else chunks.push(chunk); });
      incoming.on("error", reject);
      incoming.on("end", () => {
        try { resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks), { status, headers })); }
        catch (error) { reject(error); }
      });
    });
    const timer = setTimeout(() => request.destroy(new Error("material download timed out")), 30000);
    timer.unref(); request.on("close", () => clearTimeout(timer)); request.on("error", reject);
  });
  return response.status >= 300 && response.status < 400 && response.headers.has("location") ? downloadPublic(new URL(response.headers.get("location")!, url), hops + 1) : response;
}
