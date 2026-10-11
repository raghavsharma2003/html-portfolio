import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
const routes = JSON.parse(readFileSync(fileURLToPath(new URL('../../vercel.json',import.meta.url)),'utf8')).crons;
const path = process.env.AZURE_WEB_CRON_PATH;
if (!routes.some(r=>r.path===path)) throw new Error('azure_web_cron_path_refused');
const loopback = process.env.AZURE_WEB_CRON_LOOPBACK === '1' && process.env.VYAKTI_DEV_LOOPBACK === '1' && process.env.VYAKTI_DEV_PUBLICATION_EXPIRY === '1';
const origin = new URL(process.env.AZURE_WEB_PUBLIC_ORIGIN || (loopback ? 'http://missing.invalid:5177' : 'https://missing.invalid'));
const validOrigin = loopback
  ? origin.protocol === 'http:' && (origin.hostname === '127.0.0.1' || origin.hostname === 'localhost') && Boolean(origin.port)
  : origin.protocol === 'https:' && origin.hostname !== 'missing.invalid' && !origin.port;
if (!validOrigin || origin.pathname !== '/' || origin.search || origin.hash || origin.username || origin.password) throw new Error('azure_web_cron_origin_invalid');
const secret = process.env.CRON_SECRET;
if (typeof secret!=='string'||secret.length<32) throw new Error('azure_web_cron_auth_missing');
const response = await fetch(new URL(path,origin),{headers:{Authorization:`Bearer ${secret}`},redirect:'error',signal:AbortSignal.timeout(300000)});
// Never log response content; sweeps can contain owner data or provider errors.
await response.body?.cancel();
if (!response.ok) throw new Error(`azure_web_cron_http_${response.status}`);
console.log('Scheduled sweep completed.');
