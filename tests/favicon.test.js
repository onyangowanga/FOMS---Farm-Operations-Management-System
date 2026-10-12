import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { base } from "./helpers.js";

const root = new URL("../", import.meta.url);
const { version } = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const assets = [["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["apple-touch-icon.png", 180], ["android-chrome-192x192.png", 192], ["android-chrome-512x512.png", 512]];
test("supplied favicon bytes/dimensions and manifest identity are retained in the served assets", async () => {
  for (const [name, size] of assets) {
    const image = await readFile(new URL(`client/favicon/${name}`, root));
    assert.deepEqual(image, await readFile(new URL(`favicon/${name}`, root)));
    assert.equal(image.subarray(0, 8).toString("hex"), "89504e470d0a1a0a");
    assert.equal(image.readUInt32BE(16), size);
    assert.equal(image.readUInt32BE(20), size);
  }
  assert.deepEqual(await readFile(new URL("client/favicon/favicon.ico", root)), await readFile(new URL("favicon/favicon.ico", root)));
  const manifest = JSON.parse(await readFile(new URL("client/favicon/site.webmanifest", root), "utf8"));
  assert.equal(manifest.short_name, "FOMS");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.theme_color, "#173b27");
  assert.deepEqual(manifest.icons.map((item) => item.sizes), ["192x192", "512x512"]);
  const html = await readFile(new URL("client/index.html", root), "utf8");
  const worker = await readFile(new URL("client/sw.js", root), "utf8");
  assert.ok(!html.includes("favicon.svg"));
  for (const [name] of assets) assert.ok(worker.includes(`/favicon/${name}?v=${version}`));
});
test("browser icon links and PWA manifest resolve to actual served image bytes", { skip: !base }, async () => {
  const html = await fetch(base);
  assert.equal(html.status, 200);
  const markup = await html.text();
  assert.ok(markup.includes(`/favicon/favicon-32x32.png?v=${version}`));
  const response = await fetch(`${base}/favicon/site.webmanifest?v=${version}`);
  assert.equal(response.status, 200);
  const manifest = await response.json();
  for (const [name] of assets) {
    const result = await fetch(`${base}/favicon/${name}?v=${version}`);
    assert.equal(result.status, 200);
    assert.match(result.headers.get("content-type"), /^image\/png/);
    assert.deepEqual(Buffer.from(await result.arrayBuffer()), await readFile(new URL(`client/favicon/${name}`, root)));
  }
  for (const icon of manifest.icons) assert.equal((await fetch(`${base}${icon.src}`)).status, 200);
});
