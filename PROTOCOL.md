# Protocol / pseudocode for upload controller

First, a warning. Writing an upload controller like this is fraught with peril.
If you're not careful, hostile people will be able to create too many files,
fill up a disk or partition, write files with arbitrary content to locations
you don't expect, etc.

My advice is to be extremely defensive about each and every incoming parameter.
Before using any of them, subject them to strict tests. If they're not
absolutely perfect, bail early. Especially when constructing paths, use
user-supplied values only if they have been strictly verified.

## `start`

To start an upload, the client sends a POST with the following parameters:

- `do: "start"`
- `fileName`
- `fileSize` (size of file in bytes)
- `fileNumChunks`
- `fileDigest` (SHA256)

If everything is OK, the controller will return a v4 UUID representing the
upload. `{ "uploadId": "..." }`

## `chunk`

To check if the server has a certain chunk, the client sends a GET with the
following parameters:

- `uploadId`
- `chunkNum` (starting from 1)
- `chunkSize`
- `chunkDigest` (SHA256)

If the controller already has that chunk, it will return a `200`. Otherwise,
`204`.

To send a chunk, the client sends a POST with the following parameters:

- `do: "chunk"`
- `uploadId`
- `chunkNum` (starting from 1)
- `chunkSize`
- `chunkDigest` (SHA256)
- `file` (Javascript `FormData` format)

The controller should verify the size and digest of the received data, store
the chunk contents, and return `200`.

## `finish`

After all the chunks are sent, the client sends a POST with the following
parameters to tell the controller to finalize the upload by doing final checks
and coalescing the chunks.

- `do: "finish"`
- `uploadId`

If everything is OK, the controller returns `200`. Otherwise, `204`.
