import { URL } from 'url';
import dns from 'dns';
import net from 'net';

/**
 * url-guard — SSRF protection primitives.
 *
 * EvalUXIA lets an authenticated user hand an arbitrary URL to a real
 * Playwright/Chromium session (initial navigation, redirects, and dynamic
 * NAVIGATE actions proposed by the RuleEngine/AI). Without validation this
 * is a full SSRF: an attacker could point the browser at internal services,
 * loopback, link-local, or cloud metadata endpoints and read back the
 * rendered response through the evaluation's findings/screenshots.
 *
 * This module validates by protocol allowlist + numeric IP-range checks
 * (never plain substring/prefix matching on the hostname), resolving
 * hostnames via the OS resolver and rejecting the URL if ANY resolved
 * address falls in a disallowed range. It is re-run per navigation/request
 * (not just once at input validation) so it also covers redirects and
 * DNS-rebinding between check-time and use-time.
 */

export class UnsafeUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'UnsafeUrlError';
    Object.setPrototypeOf(this, UnsafeUrlError.prototype);
  }
}

export const ALLOWED_URL_PROTOCOLS = new Set(['http:', 'https:']);

/**
 * Schemes that never touch the network (inline data, client-only resources).
 * Playwright's request interception may see these as "requests"; they carry
 * no SSRF risk and must not be rejected as if they were network destinations.
 */
export const NON_NETWORK_PROTOCOLS = new Set(['data:', 'blob:', 'about:', 'filesystem:']);

function ipv4ToInt(ip: string): number {
  return (
    ip
      .split('.')
      .reduce((acc, octet) => (acc << 8) + (Number(octet) & 0xff), 0) >>> 0
  );
}

// CIDR ranges disallowed for IPv4 destinations: loopback, private (RFC1918),
// link-local (incl. cloud metadata 169.254.169.254), carrier-grade NAT,
// documentation/test ranges, multicast, and reserved/broadcast.
const IPV4_BLOCKED_RANGES: Array<[string, number]> = [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4],
  ['255.255.255.255', 32],
];

function isBlockedIpv4Int(ipInt: number): boolean {
  return IPV4_BLOCKED_RANGES.some(([base, prefix]) => {
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    return (ipInt & mask) === (ipv4ToInt(base) & mask);
  });
}

function isBlockedIpv4(ip: string): boolean {
  return isBlockedIpv4Int(ipv4ToInt(ip));
}

/**
 * Parses a full/compressed IPv6 literal (including an IPv4-mapped tail like
 * "::ffff:192.168.1.1") into its 128-bit numeric value.
 */
function ipv6ToBigInt(address: string): bigint {
  let normalized = address;

  // Expand an embedded IPv4 tail (e.g. "::ffff:127.0.0.1") into hextets.
  const ipv4TailMatch = normalized.match(/(^|:)(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (ipv4TailMatch) {
    const ipv4 = ipv4TailMatch[2];
    const octets = ipv4.split('.').map(Number);
    const hex = octets.map((o) => o.toString(16).padStart(2, '0'));
    const hextets = `${hex[0]}${hex[1]}:${hex[2]}${hex[3]}`;
    normalized = normalized.slice(0, normalized.length - ipv4.length) + hextets;
  }

  let parts: string[];
  if (normalized.includes('::')) {
    const [head, tail] = normalized.split('::');
    const headParts = head ? head.split(':').filter(Boolean) : [];
    const tailParts = tail ? tail.split(':').filter(Boolean) : [];
    const missing = 8 - (headParts.length + tailParts.length);
    parts = [...headParts, ...Array(Math.max(missing, 0)).fill('0'), ...tailParts];
  } else {
    parts = normalized.split(':');
  }

  let result = 0n;
  for (const part of parts) {
    result = (result << 16n) | BigInt(parseInt(part || '0', 16) || 0);
  }
  return result;
}

// Blocked IPv6 ranges expressed as [network literal, prefix length].
// Parsed with the same routine used for the target address, so base and
// target are always compared using identical logic.
const IPV6_BLOCKED_RANGES: Array<[string, number]> = [
  ['::', 128], // unspecified
  ['::1', 128], // loopback
  ['fc00::', 7], // unique local (private)
  ['fe80::', 10], // link-local
  ['ff00::', 8], // multicast
];

function topBitsMask(prefix: number): bigint {
  if (prefix <= 0) return 0n;
  if (prefix >= 128) return (1n << 128n) - 1n;
  return ((1n << BigInt(prefix)) - 1n) << BigInt(128 - prefix);
}

const IPV4_MAPPED_PREFIX = 0xffffn; // top 96 bits of ::ffff:0:0/96, right after the 32 embedded bits

function isBlockedIpv6(ip: string): boolean {
  const value = ipv6ToBigInt(ip.toLowerCase());

  // IPv4-mapped IPv6 (::ffff:0:0/96) — validate the embedded IPv4 address
  // numerically. Node's URL parser normalizes "::ffff:127.0.0.1" into the
  // canonical hextet form "::ffff:7f00:1", so this must not rely on the
  // dotted-decimal string still being present.
  if (value >> 32n === IPV4_MAPPED_PREFIX) {
    const embeddedIpv4Int = Number(value & 0xffffffffn) >>> 0;
    return isBlockedIpv4Int(embeddedIpv4Int);
  }

  return IPV6_BLOCKED_RANGES.some(([base, prefix]) => {
    const mask = topBitsMask(prefix);
    return (value & mask) === (ipv6ToBigInt(base) & mask);
  });
}

/**
 * Pure, synchronous check: is this literal IP address disallowed as an
 * evaluation target? Exported separately from `assertSafeUrl` so it can be
 * unit-tested deterministically without any DNS/network dependency.
 */
export function isBlockedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isBlockedIpv4(ip);
  if (version === 6) return isBlockedIpv6(ip);
  // Not a recognizable IP literal — treat conservatively as blocked.
  return true;
}

/**
 * Validates that `rawUrl` is safe to hand to Playwright: allowed protocol,
 * and every address the hostname resolves to (or the literal IP if the URL
 * already contains one) falls outside the blocked ranges above.
 *
 * Resolution happens via the OS resolver (`dns.lookup`), so it is re-checked
 * every time this is called — calling it again immediately before use (not
 * only once at input-validation time) is what protects against DNS rebinding
 * between the initial check and the actual navigation.
 *
 * Throws `UnsafeUrlError` if the URL is not allowed.
 */
export async function assertSafeUrl(rawUrl: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError(`Invalid URL: ${rawUrl}`);
  }

  if (!ALLOWED_URL_PROTOCOLS.has(parsed.protocol)) {
    throw new UnsafeUrlError(`Protocol not allowed: ${parsed.protocol}`);
  }

  const rawHostname = parsed.hostname;
  if (!rawHostname) {
    throw new UnsafeUrlError('URL has no hostname');
  }

  // WHATWG URL.hostname keeps the surrounding brackets for IPv6 literals
  // (e.g. "[::1]"), which `net.isIP`/our IP parser do not understand.
  const hostname =
    rawHostname.startsWith('[') && rawHostname.endsWith(']')
      ? rawHostname.slice(1, -1)
      : rawHostname;

  const directIpVersion = net.isIP(hostname);
  if (directIpVersion) {
    if (isBlockedIp(hostname)) {
      throw new UnsafeUrlError(`Target IP is not allowed: ${hostname}`);
    }
    return;
  }

  let addresses: dns.LookupAddress[];
  try {
    addresses = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  } catch {
    throw new UnsafeUrlError(`Could not resolve hostname: ${hostname}`);
  }

  if (addresses.length === 0) {
    throw new UnsafeUrlError(`Hostname did not resolve to any address: ${hostname}`);
  }

  for (const { address } of addresses) {
    if (isBlockedIp(address)) {
      throw new UnsafeUrlError(
        `Hostname '${hostname}' resolves to a disallowed address: ${address}`,
      );
    }
  }
}
