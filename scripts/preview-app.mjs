// Serve the installed Paseo web bundle in an isolated browser origin for UI verification.
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(process.env.PASEO_DIRECT_APP_DIST || "/Applications/Paseo.app/Contents/Resources/app-dist");
const types = { ".js": "text/javascript", ".css": "text/css", ".html": "text/html", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".ttf": "font/ttf" };
const server = createServer(async (request, response) => {
  try {
    let path = resolve(root, "." + decodeURIComponent(new URL(request.url, "http://localhost").pathname));
    if (path !== root && !path.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    if (!(await stat(path).catch(() => null))?.isFile()) path = resolve(root, "index.html");
    const bytes = await readFile(path);
    response.writeHead(200, { "Content-Type": types[extname(path)] || "application/octet-stream", "Cache-Control": "no-store" });
    response.end(bytes);
  } catch { response.writeHead(500).end("Preview unavailable"); }
});
server.listen(0, "127.0.0.1", () => console.log(JSON.stringify({ url: `http://localhost:${server.address().port}` })));
