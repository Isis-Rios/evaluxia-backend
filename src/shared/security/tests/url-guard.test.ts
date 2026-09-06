import { assertSafeUrl, isBlockedIp, UnsafeUrlError } from '../url-guard';

/**
 * Deterministic SSRF-guard tests. No network calls to Gemini or any
 * external evaluation target — the only DNS resolution exercised is
 * `localhost`, which every OS resolves locally via /etc/hosts (no network).
 * All other cases use literal IPs in the URL, which short-circuits the
 * hostname-resolution path entirely.
 */
async function expectSafe(url: string, label: string): Promise<void> {
  try {
    await assertSafeUrl(url);
    console.log(`✅ ${label}`);
  } catch (err) {
    console.error(`❌ ${label} — expected safe but was rejected:`, err);
    process.exit(1);
  }
}

async function expectBlocked(url: string, label: string): Promise<void> {
  try {
    await assertSafeUrl(url);
    console.error(`❌ ${label} — expected the URL to be rejected but it was allowed`);
    process.exit(1);
  } catch (err) {
    if (!(err instanceof UnsafeUrlError)) {
      console.error(`❌ ${label} — rejected, but not with UnsafeUrlError:`, err);
      process.exit(1);
    }
    console.log(`✅ ${label} (blocked: ${err.message})`);
  }
}

async function runTests(): Promise<void> {
  console.log('🧪 Starting SSRF url-guard tests...');

  // Valid public destinations
  await expectSafe('http://8.8.8.8/', 'HTTP URL with public IP is allowed');
  await expectSafe('https://1.1.1.1/path', 'HTTPS URL with public IP is allowed');
  await expectSafe('http://[2001:4860:4860::8888]/', 'Public bracketed IPv6 URL is allowed');

  // Blocked hostnames / literal IPs
  await expectBlocked('http://localhost/', 'localhost is blocked');
  await expectBlocked('http://127.0.0.1/', '127.0.0.1 (loopback) is blocked');
  await expectBlocked('http://127.5.0.1/', '127.5.0.1 (loopback /8 range) is blocked');
  await expectBlocked('http://169.254.169.254/latest/meta-data/', '169.254.169.254 (cloud metadata) is blocked');
  await expectBlocked('http://[::1]/', '::1 (IPv6 loopback) is blocked');
  await expectBlocked('http://10.0.0.1/', '10.0.0.1 (private RFC1918) is blocked');
  await expectBlocked('http://172.16.5.9/', '172.16.5.9 (private RFC1918) is blocked');
  await expectBlocked('http://192.168.1.1/', '192.168.1.1 (private RFC1918) is blocked');
  await expectBlocked('http://0.0.0.0/', '0.0.0.0 is blocked');
  await expectBlocked('http://[fe80::1]/', 'fe80::1 (IPv6 link-local) is blocked');
  await expectBlocked('http://[fc00::1]/', 'fc00::1 (IPv6 unique-local/private) is blocked');
  await expectBlocked('http://[::ffff:127.0.0.1]/', '::ffff:127.0.0.1 (IPv4-mapped loopback) is blocked');

  // Disallowed protocols
  await expectBlocked('file:///etc/passwd', 'file: protocol is blocked');
  await expectBlocked('ftp://example.com/', 'ftp: protocol is blocked');
  await expectBlocked('javascript:alert(1)', 'javascript: protocol is blocked');
  await expectBlocked('data:text/html,<script>alert(1)</script>', 'data: protocol is blocked');

  // Malformed input
  await expectBlocked('not a url', 'Malformed URL string is blocked');

  // Pure isBlockedIp boundary checks (no async/DNS involved)
  const pureCases: Array<[string, boolean, string]> = [
    ['8.8.8.8', false, 'public IPv4 is not blocked'],
    ['2001:4860:4860::8888', false, 'public IPv6 (Google DNS) is not blocked'],
    ['100.64.0.1', true, 'carrier-grade NAT range is blocked'],
    ['255.255.255.255', true, 'broadcast address is blocked'],
    ['ff02::1', true, 'IPv6 multicast is blocked'],
  ];
  for (const [ip, expectedBlocked, label] of pureCases) {
    const actual = isBlockedIp(ip);
    if (actual !== expectedBlocked) {
      console.error(`❌ isBlockedIp('${ip}') — ${label} — expected ${expectedBlocked}, got ${actual}`);
      process.exit(1);
    }
    console.log(`✅ isBlockedIp('${ip}'): ${label}`);
  }

  console.log('🎉 All SSRF url-guard tests passed successfully!');
  process.exit(0);
}

runTests().catch((err) => {
  console.error('❌ Unexpected error running url-guard tests:', err);
  process.exit(1);
});
