const base = process.env.COREBOX_API || 'http://127.0.0.1:8787';

async function request(path, options) {
  const res = await fetch(`${base}${path}`, options);
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data };
}

const health = await request('/health');
if (health.status !== 200 || !health.data?.ok || health.data?.backend !== 'local-sqlite') {
  throw new Error(`Local DB health failed: ${JSON.stringify(health)}`);
}

const rest = await request('/rest/v1/profiles?select=id&limit=1');
if (rest.status !== 200 || !Array.isArray(rest.data)) {
  throw new Error(`REST smoke failed: ${JSON.stringify(rest)}`);
}

const rpc = await request('/rest/v1/rpc/get_server_time', {
  method: 'POST',
  headers: { 'content-type': 'application/json', apikey: 'corebox-local' },
  body: '{}',
});
if (rpc.status !== 200 || !rpc.data) {
  throw new Error(`RPC smoke failed: ${JSON.stringify(rpc)}`);
}

console.log(JSON.stringify({ ok: true, backend: 'local-sqlite', health: health.data, restRows: rest.data.length, rpc: rpc.data }, null, 2));
