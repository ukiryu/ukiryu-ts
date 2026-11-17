// Runs the conformance corpus in UKIRYU_CONFORMANCE_DIR through the browser
// entry in headless Chromium. The page imports the package's dist/web.js,
// which fetches the vendored web engine; corpus files are served read-only.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const dir = process.env.UKIRYU_CONFORMANCE_DIR;
if (!dir) throw new Error('set UKIRYU_CONFORMANCE_DIR to the corpus/conformance directory of the pinned core');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const types = { '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm' };
const served = [
  ['/pkg/dist/', path.join(root, 'dist')],
  ['/pkg/vendor/ukiryu-web/', path.join(root, 'vendor/ukiryu-web')],
  ['/test/', path.join(root, 'test/conformance')],
  ['/corpus/', path.resolve(dir)],
];

const server = createServer(async (req, res) => {
  try {
    const url = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (url === '/') {
      res.setHeader('Content-Type', 'text/html');
      res.end('<!doctype html><title>ukiryu conformance</title>');
      return;
    }
    for (const [prefix, base] of served) {
      if (!url.startsWith(prefix)) continue;
      const file = path.resolve(base, url.slice(prefix.length));
      if (!file.startsWith(base + path.sep)) break;
      res.setHeader('Content-Type', types[path.extname(file)] ?? 'text/plain; charset=utf-8');
      res.end(await readFile(file));
      return;
    }
    res.writeHead(404);
    res.end();
  } catch (error) {
    res.writeHead(error.code === 'ENOENT' ? 404 : 500);
    res.end(String(error));
  }
});
server.listen(0, '127.0.0.1');
await new Promise((resolve) => server.once('listening', resolve));

let browser;
try {
  browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(String(error)));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  const result = await page.evaluate(async () => {
    const api = await import('/pkg/dist/web.js');
    const { runCorpus } = await import('/test/corpus.mjs');
    const engine = await api.load();
    const typeofProcess = typeof globalThis.process;
    const summary = await runCorpus({
      engine,
      api,
      load: async (file) => {
        const response = await fetch(`/corpus/${file}`);
        if (!response.ok) throw new Error(`${file}: HTTP ${response.status}`);
        return response.text();
      },
      digest: async (text) =>
        [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)))]
          .map((byte) => byte.toString(16).padStart(2, '0'))
          .join(''),
    });
    return { ...summary, typeofProcess };
  });
  assert.equal(result.typeofProcess, 'undefined', 'the browser run must not see a Node process object');
  assert.deepEqual(errors, []);
  console.log(`Chromium ${browser.version()}: ${JSON.stringify(result)}`);
} finally {
  await browser?.close();
  server.close();
}
