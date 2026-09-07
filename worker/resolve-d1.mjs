import { readFile, writeFile } from 'node:fs/promises';

const token = process.env.CLOUDFLARE_API_TOKEN;
const configured = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!token) throw new Error('CLOUDFLARE_API_TOKEN is required');

async function call(path, options = {}) {
  const response = await fetch(`https://api.cloudflare.com/client/v4${path}`, {
    ...options,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) },
  });
  const body = await response.json();
  if (!response.ok || !body.success) throw new Error(`Cloudflare request failed: ${JSON.stringify(body.errors ?? body)}`);
  return body.result;
}

const accounts = await call('/accounts');
const account = accounts.find((item) => item.id === configured) ?? (accounts.length === 1 ? accounts[0] : null);
if (!account) throw new Error('Could not resolve the Cloudflare account for this token.');
let databases = await call(`/accounts/${account.id}/d1/database`);
let database = databases.find((item) => item.name === 'pack1');
if (!database) {
  database = await call(`/accounts/${account.id}/d1/database`, { method: 'POST', body: JSON.stringify({ name: 'pack1' }) });
  console.log(`Created D1 database pack1 (${database.uuid}).`);
} else {
  console.log(`Using D1 database pack1 (${database.uuid}).`);
}
const path = new URL('./wrangler.toml', import.meta.url);
const config = await readFile(path, 'utf8');
await writeFile(path, config.replace('replace-after-bootstrap', database.uuid));
