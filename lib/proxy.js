import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const execute = promisify(execFile);
let cached;
function proxyUrl(value) {
  if (!value) return undefined;
  try {
    const url = new URL(value.includes('://') ? value : 'http://' + value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : undefined;
  } catch { return undefined; }
}
export async function systemProxy({ platform = process.platform, env = process.env, read = async name => {
  const { stdout } = await execute('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings', '/v', name], { windowsHide: true, timeout: 3000, maxBuffer: 16000 });
  return stdout;
} } = {}) {
  const explicit = proxyUrl(env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy || env.ALL_PROXY || env.all_proxy);
  if (explicit || platform !== 'win32') return explicit;
  if (cached && Date.now() - cached.at < 60000) return cached.value;
  let value;
  try {
    if (/ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(await read('ProxyEnable'))) {
      const raw = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(await read('ProxyServer'))?.[1]?.trim();
      const parts = raw?.split(';') || [];
      const preferred = parts.find(x => x.startsWith('https=')) || parts.find(x => x.startsWith('http=')) || parts.find(x => !x.includes('='));
      value = proxyUrl(preferred?.replace(/^https?=/, ''));
    }
  } catch { /* No proxy registry values or a non-Windows runtime. */ }
  cached = { at: Date.now(), value }; return value;
}
