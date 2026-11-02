// JSON requests through Node's http/https, available in Eagle plugins. Unlike
// the page's fetch(), these are not blocked by CORS, so the plugin can reach
// Eagle's local API and a Karakeep server on a NAS.
(function (root) {
  const http = require('http');
  const https = require('https');

  function requestJson(address, { method = 'GET', headers = {}, body, insecure = false, timeout = 20000 } = {}) {
    return new Promise((resolve, reject) => {
      let url;
      try { url = new URL(address); } catch { reject(new Error(`Invalid address: ${address}`)); return; }
      const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
      const client = url.protocol === 'https:' ? https : http;
      const request = client.request(url, {
        method,
        headers: { Accept: 'application/json', ...(payload ? { 'Content-Type': 'application/json', 'Content-Length': payload.length } : {}), ...headers },
        // A NAS often serves HTTPS with a self-signed certificate.
        ...(url.protocol === 'https:' && insecure ? { rejectUnauthorized: false } : {}),
        timeout
      }, response => {
        const chunks = [];
        response.on('data', chunk => chunks.push(chunk));
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let json = null;
          try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
          resolve({ status: response.statusCode, json, text });
        });
      });
      request.on('timeout', () => request.destroy(new Error('No answer (timed out)')));
      request.on('error', reject);
      if (payload) request.write(payload);
      request.end();
    });
  }

  // Eagle's local Web API, the same one the Chrome extension uses.
  const EAGLE = 'http://localhost:41595';
  async function eagleCall(path, body) {
    const response = await requestJson(EAGLE + path, body === undefined ? {} : { method: 'POST', body });
    if (response.status !== 200 || response.json?.status !== 'success') {
      throw new Error(response.json?.message || `Eagle answered HTTP ${response.status}`);
    }
    return response.json.data;
  }

  const eagle = {
    folders: () => eagleCall('/api/folder/list'),
    createFolder: name => eagleCall('/api/folder/create', { folderName: name }),
    addFromPath: item => eagleCall('/api/item/addFromPath', item)
  };

  // Karakeep REST API: /api/v1 with a Bearer API key from its settings.
  function karakeep(settings) {
    const base = String(settings.url || '').trim().replace(/\/+$/, '').replace(/\/api\/v1$/, '');
    const call = async (path, options = {}) => {
      if (!base) throw new Error('Set the Karakeep address in Settings.');
      if (!settings.apiKey) throw new Error('Set the Karakeep API key in Settings.');
      const response = await requestJson(`${base}/api/v1${path}`, {
        ...options, insecure: settings.insecure, headers: { Authorization: `Bearer ${settings.apiKey}` }
      });
      if (response.status === 401 || response.status === 403) throw new Error('Karakeep refused the API key.');
      return response;
    };
    return {
      async test() {
        const response = await call('/users/me');
        if (response.status !== 200) throw new Error(`Karakeep answered HTTP ${response.status}`);
        return response.json?.name || response.json?.email || 'connected';
      },
      async addBookmark(body, tags) {
        let response = await call('/bookmarks', { method: 'POST', body });
        // Older Karakeep versions do not accept createdAt; retry without it.
        if (response.status === 400 && body.createdAt) {
          const { createdAt, ...rest } = body;
          response = await call('/bookmarks', { method: 'POST', body: rest });
        }
        if (response.status !== 200 && response.status !== 201) {
          throw new Error(response.json?.message || response.json?.error || `Karakeep answered HTTP ${response.status}`);
        }
        const id = response.json?.id;
        if (id && tags.length) {
          await call(`/bookmarks/${id}/tags`, { method: 'POST', body: { tags: tags.map(tagName => ({ tagName })) } });
        }
        return { id, alreadyExists: Boolean(response.json?.alreadyExists) };
      }
    };
  }

  root.TelegramSorterNet = { requestJson, eagle, karakeep };
})(globalThis);
