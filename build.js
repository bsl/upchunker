const r = await Bun.build({
  entrypoints: ["./src/upchunker.js"],
  target: "browser",
  format: "esm",
  minify: true,
  outdir: "./dist",
});

if (!r.success) {
  for (const message of r.logs) {
    console.error(message);
  }
}
