import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

export function isPrivateAddress(address) {
  const ip = address.toLowerCase().replace(/^::ffff:/, '');
  if (isIP(ip) === 4) {
    const [a,b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && (b === 168 || b === 0)) || (a === 100 && b >= 64 && b <= 127) || (a === 198 && (b === 18 || b === 19));
  }
  if (isIP(ip) === 6) return ip === '::' || ip === '::1' || /^f[cd]/.test(ip) || /^fe[89ab]/.test(ip) || /^ff/.test(ip);
  return true;
}
export async function validatePublicUrl(value, { domains, resolve = lookup } = {}) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('只允许公开 HTTP(S) 地址');
  const hostname = url.hostname.replace(/^\[|\]$/g, '');
  if (domains && !domains.some(domain => hostname === domain || hostname.endsWith('.' + domain))) throw new Error('不支持的音频域名');
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname.endsWith('.internal')) throw new Error('不允许内网地址');
  const records = isIP(hostname) ? [{ address: hostname }] : await resolve(hostname, { all: true });
  if (!records.length || records.some(x => isPrivateAddress(x.address))) throw new Error('不允许内网地址');
  return url;
}
export async function publicFetch(value, options = {}, { domains, fetchImpl = fetch, resolve = lookup, timeoutMs = 12000 } = {}) {
  let url = value;
  const signal = AbortSignal.any([AbortSignal.timeout(timeoutMs), ...(options.signal ? [options.signal] : [])]);
  for (let i = 0; i <= 4; i++) {
    await validatePublicUrl(url, { domains, resolve });
    const response = await fetchImpl(url, { ...options, signal, redirect: 'manual' });
    if (response.status >= 300 && response.status < 400 && response.headers.get('location')) {
      if (i === 4) throw new Error('上游重定向次数过多');
      url = new URL(response.headers.get('location'), url).href;
      await response.body?.cancel();
      continue;
    }
    return response;
  }
}
export async function limitedText(response, maxBytes = 2_000_000) {
  if (!response.ok) throw new Error('上游服务返回 HTTP ' + response.status);
  const reader = response.body.getReader(); const pieces = []; let total = 0;
  while (true) { const { done, value } = await reader.read(); if (done) break; total += value.length; if (total > maxBytes) { await reader.cancel(); throw new Error('上游响应过大'); } pieces.push(value); }
  return Buffer.concat(pieces).toString('utf8');
}
