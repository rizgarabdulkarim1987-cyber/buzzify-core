import { describe, expect, it } from 'vitest';
import { AiLinkError } from '@/server/ai/errors';
import { checkLinkUrl, isPrivateAddress } from '@/server/ai/link-fetch';

const lookup = async () => ['93.184.216.34'];

describe('the link guard sees through IPv6 spellings of IPv4 addresses', () => {
  it('refuses every form of a private IPv4 address inside an IPv6 one', () => {
    // `new URL('http://[::ffff:127.0.0.1]/').hostname` is `[::ffff:7f00:1]`: the hex form must not slip past the guard.
    for (const address of ['::ffff:7f00:1', '::ffff:a9fe:a9fe', '::ffff:0a00:0001', '::ffff:10.0.0.1', '::127.0.0.1', '::7f00:1', '64:ff9b::7f00:1', '64:ff9b::a9fe:a9fe', '2002:7f00:1::', '2002:0a00:0001::1', '0:0:0:0:0:ffff:7f00:1', '::ffff:0:7f00:1'])
      expect(isPrivateAddress(address), address).toBe(true);
  });

  it('still lets a public address through in those forms', () => {
    for (const address of ['::ffff:5db8:d822', '::ffff:93.184.216.34', '64:ff9b::5db8:d822', '2002:5db8:d822::1', '2606:2800:220:1:248:1893:25c8:1946']) expect(isPrivateAddress(address), address).toBe(false);
  });

  it('refuses the documentation and benchmarking IPv4 blocks', () => {
    for (const address of ['192.0.0.1', '192.0.2.1', '198.18.0.1', '198.19.255.1', '198.51.100.7', '203.0.113.9']) expect(isPrivateAddress(address), address).toBe(true);
  });

  it('refuses a mapped loopback or metadata address written as a URL', async () => {
    for (const url of ['http://[::ffff:127.0.0.1]/m', 'http://[::ffff:169.254.169.254]/latest', 'http://[64:ff9b::7f00:1]/m', 'http://[::127.0.0.1]/m'])
      await expect(checkLinkUrl(url, { lookup }), url).rejects.toBeInstanceOf(AiLinkError);
  });
});
