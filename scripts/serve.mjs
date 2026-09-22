import http from 'node:http';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const distribution = process.argv.includes('--dist');
const root = resolve(fileURLToPath(new URL('../', import.meta.url)), distribution ? 'dist' : '.');
const port = Number(process.env.PORT ?? 4173);
const host = process.env.HOST ?? '127.0.0.1';
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new RangeError('PORT must be in 1..65535.');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.json': 'application/json', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.axaml': 'application/xml', '.xaml': 'application/xml', '.md': 'text/plain; charset=utf-8' };
const server = http.createServer(async (req, res) => {
    try {
        if (!['GET', 'HEAD'].includes(req.method)) {
            res.writeHead(405, { Allow: 'GET, HEAD' }); res.end(); return;
        }
        const url = new URL(req.url, 'http://localhost');
        if (!distribution && url.pathname === '/') {
            res.writeHead(302, { Location: '/samples/ControlCatalog/' + url.search }); res.end(); return;
        }
        const path = resolve(root, '.' + decodeURIComponent(url.pathname));
        if (path !== root && !path.startsWith(root + sep)) {
            res.writeHead(403); res.end('Forbidden'); return;
        }
        let file = path;
        const info = await stat(file);
        if (info.isDirectory()) file = resolve(file, 'index.html');
        const metadata = await stat(file);
        if (!metadata.isFile()) throw new Error('Not a file');
        res.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream', 'Content-Length': metadata.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
        if (req.method === 'HEAD') { res.end(); return; }
        const stream = createReadStream(file);
        stream.on('error', error => res.destroy(error));
        stream.pipe(res);
    } catch (error) {
        if (res.headersSent) { res.destroy(error); return; }
        res.writeHead(404, { 'Content-Type': 'text/plain' }); res.end('Not found');
    }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(port, host, () => console.log(`AvaloniaWeb: http://${host}:${port}/`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
