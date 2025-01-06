# upchunker

`upchunker` is a Javascript library that implements [a simple
protocol](PROTOCOL.md) for uploading files in chunks.

It generates cryptographic digests for files locally to ensure
integrity, and is capable of uploading multiple chunks in
parallel.

Warning: alpha quality. Expect bugs and API changes.

## Development cheat sheet

- `bun install`

- `bun run build` generate minified `dist/upchunker.js`
- `bun run buildwatch` watch `src/upchunker.js` and rebuild automatically
- `bun run check` display linter warnings
- `bun run format` display code formatting issues
- `bun run checkfix` automatically fix
- `bun run formatfix` automatically fix

## The test upload controller

This library needs a corresponding upload controller. An example webapp with
such a controller is provided in `testapp`.

- `bin/rails db:migrate`
- `bin/rails server`

The app should be running on `localhost:3000`. It will serve the stuff in
[public/](testapp/public). You should be able to choose files, watch them
upload, and then verify that they showed up in `/tmp`.

## See also

- [resumable.js](https://github.com/23/resumable.js)
- [sha256-uintarray](https://github.com/kawanet/sha256-uint8array)
