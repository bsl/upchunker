import { createHash } from "sha256-uint8array";

const UpchunkerChunk = function (upchunkerFile, num, offset, size) {
  this.upchunkerFile = upchunkerFile;
  this.num = num;
  this.offset = offset;
  this.size = size;
  this.status = UpchunkerChunkStatus.Pending;
  this.digest = null;
  this.prepared = false;

  this.prepare = async function () {
    if (this.prepared) return;
    this.digest = await calcDigestChunk(upchunkerFile.file, offset, size);
    this.prepared = true;
  };
};

const UpchunkerChunkStatus = {
  Pending: "Pending",
  InProgress: "InProgress",
  Done: "Done",
};

const UpchunkerFile = function (upchunker, file) {
  const $ = this;
  this.upchunker = upchunker;
  this.file = file;
  this.uploadId = null;
  this.digest = null;
  this.upchunkerChunks = [];
  this.done = false;
  this.numUploadWorkers = 0;

  this.prepare = async function () {
    this.digest = await calcDigestFile(
      file,
      $.upchunker.options.fileDigestProgressCb,
    );
    $.upchunker.logInfo(`${this.file.name} digest ${this.digest}`);
    const chunkSize = this.upchunker.options.chunkSize;
    const numChunks = Math.ceil(this.file.size / chunkSize);
    for (let num = 1; num <= numChunks; num++) {
      const offset = (num - 1) * chunkSize;
      // Every chunk has size `chunkSize` except possibly for the last one,
      // which will be smaller.
      const size = num < numChunks ? chunkSize : this.file.size % chunkSize;
      const upchunkerChunk = new UpchunkerChunk(this, num, offset, size);
      await upchunkerChunk.prepare();
      this.upchunkerChunks.push(upchunkerChunk);
      const cb = $.upchunker.options.chunkDigestProgressCb;
      if (cb) {
        cb(this.file.name, num, numChunks, roundTo2(num / numChunks));
      }
    }
    await this.getUploadId();
  };

  this.getUploadId = async function () {
    const endpoint = this.upchunker.options.endpoint;
    const params = [
      "do=start",
      `fileName=${encodeURIComponent(this.file.name)}`,
      `fileSize=${this.file.size}`,
      `fileNumChunks=${this.upchunkerChunks.length}`,
      `fileDigest=${this.digest}`,
    ].join("&");
    const url = `${endpoint}?${params}`;
    const r = await fetchRetry(url, { method: "POST" });
    if (r.status !== 200) throw new Error("unable to get uploadId");
    const j = await r.json();
    this.uploadId = j.uploadId;
    $.upchunker.logInfo(`upload id: ${this.uploadId}`);
  };

  this.upload = function () {
    let numChunksUploaded = 0;

    return new Promise(function (resolve, reject) {
      const handleMessageFromWorker = function (e) {
        if ("chunkNum" in e.data) {
          // An upload worker is sending back the result of a chunk upload.
          const upchunkerChunk = $.upchunkerChunks.find(
            (x) => x.num === e.data.chunkNum,
          );
          if (upchunkerChunk !== undefined) {
            if (e.data.succeeded) {
              upchunkerChunk.status = UpchunkerChunkStatus.Done;
              numChunksUploaded++;
              const cb = $.upchunker.options.uploadProgressCb;
              if (cb !== undefined) {
                const f = roundTo2(
                  numChunksUploaded / $.upchunkerChunks.length,
                );
                cb($.file.name, numChunksUploaded, $.upchunkerChunks.length, f);
              }
            } else {
              upchunkerChunk.status = UpchunkerChunkStatus.Pending;
            }
          }
        }
        // Find next pending chunk.
        const upchunkerChunk = $.upchunkerChunks.find(
          (x) => x.status === UpchunkerChunkStatus.Pending,
        );
        if (upchunkerChunk === undefined) {
          // No pending chunks left. Terminate worker.
          e.target.terminate();
          $.numUploadWorkers--;
          if ($.numUploadWorkers === 0) {
            // We just terminated the last worker. Resolve this promise.
            resolve();
          }
        } else {
          // Tell worker about this chunk.
          // Set this chunk's status to "in progress" so we won't give the same
          // chunk to another worker.
          upchunkerChunk.status = UpchunkerChunkStatus.InProgress;
          const data = upchunkerChunk.upchunkerFile.file.slice(
            upchunkerChunk.offset,
            upchunkerChunk.offset + upchunkerChunk.size,
          );
          const info = {
            endpoint: $.upchunker.options.endpoint,
            uploadId: upchunkerChunk.upchunkerFile.uploadId,
            chunkNum: upchunkerChunk.num,
            chunkSize: upchunkerChunk.size,
            chunkDigest: upchunkerChunk.digest,
            data: data,
          };
          e.target.postMessage(info);
        }
      };

      for (let i = 0; i < $.upchunker.options.numSimultaneousUploads; i++) {
        const workerObjectURL = URL.createObjectURL(
          new Blob([`(${workerCode.toString()})()`], {
            type: "text/javascript",
          }),
        );
        const worker = new Worker(workerObjectURL);
        worker.addEventListener("message", handleMessageFromWorker);
        $.numUploadWorkers++;
      }
    });
  };

  this.finish = async function () {
    const endpoint = this.upchunker.options.endpoint;
    const params = ["do=finish", `uploadId=${$.uploadId}`].join("&");
    const url = `${endpoint}?${params}`;
    const r = await fetchRetry(url, { method: "POST" });
    if (r.status === 200) {
      this.done = true;
      $.upchunker.logInfo(`${$.file.name} received by server`);
    }
  };
};

function workerCode() {
  self.onmessage = (message) => {
    const info = message.data;
    const params = [
      "do=chunk",
      `uploadId=${info.uploadId}`,
      `chunkNum=${info.chunkNum}`,
      `chunkSize=${info.chunkSize}`,
      `chunkDigest=${info.chunkDigest}`,
    ].join("&");
    const url = `${info.endpoint}?${params}`;
    fetch(url).then((r) => {
      if (r.status === 200) {
        // Tell main thread server this chunk is done.
        tellChunkResult(info.chunkNum, true);
      } else if (r.status === 204) {
        // Server does not have this chunk.
        const formData = new FormData();
        formData.append("file", info.data);
        fetch(url, { method: "POST", body: formData }).then((r) => {
          tellChunkResult(info.chunkNum, r.status === 200);
        });
      }
    });
  };

  self.tellChunkResult = function (chunkNum, succeeded) {
    self.postMessage({
      chunkNum: chunkNum,
      succeeded: succeeded,
    });
  };

  // Tell the main thread we're ready for work.
  self.postMessage({});
}

const Upchunker = function (fileList, options) {
  const $ = this;
  $.fileList = fileList;
  $.upchunkerFiles = [];
  // $.events = [];

  $.defaultOptions = {
    endpoint: "upload",
    clearFileSelection: false,
    chunkSize: 1 * 1024 * 1024,
    numSimultaneousUploads: 2,
    logCb: undefined, // (level, text)
    fileDigestProgressCb: undefined, // (filename, m, n, f)
    chunkDigestProgressCb: undefined, // (filename, m, n, f)
    uploadProgressCb: undefined, // (filename, m, n, f)
  };
  $.options = Object.assign({}, $.defaultOptions, options);

  $.upload = async () => {
    for (const file of $.fileList) {
      const upchunkerFile = new UpchunkerFile($, file);
      await upchunkerFile.prepare();
      await upchunkerFile.upload();
      await upchunkerFile.finish();
    }
  };

  $.log = (level, text) => {
    const cb = $.options.logCb;
    if (cb !== undefined) cb(level, text);
  };
  $.logInfo = (text) => $.log("info", text);

  // $.on = function (eventName, cb) {
  //   $.events.push(eventName.toLowerCase(), cb);
  // };

  // $.fire = function () {
  //   // `arguments` might be an object or an array, so copy it safely.
  //   var args = [];
  //   for (let i = 0; i < arguments.length; i++) {
  //     args.push(arguments[i]);
  //   }
  //   var eventName = args[0].toLowerCase();
  //   for (let i = 0; i <= $.events.length; i += 2) {
  //     if ($.events[i] === eventName) {
  //       $.events[i + 1].apply($, args.slice(1));
  //     }
  //   }
  // };
};

async function readChunk(file, offset, chunkSize) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    const chunk = file.slice(offset, offset + chunkSize);
    fr.onload = () => resolve(new Uint8Array(fr.result));
    fr.onerror = reject;
    fr.readAsArrayBuffer(chunk);
  });
}

async function calcDigestFile(file, progressCb = null) {
  const hasher = createHash();
  const chunkSize = 10 * 1024 * 1024;
  const numChunks = Math.ceil(file.size / chunkSize);
  let chunkNum = 1;
  let offset = 0;

  while (offset < file.size) {
    const chunk = await readChunk(file, offset, chunkSize);
    hasher.update(chunk);
    if (progressCb) {
      const f = roundTo2(chunkNum / numChunks);
      progressCb(file.name, chunkNum, numChunks, f);
    }
    offset += chunk.length;
    chunkNum++;
  }
  return hasher.digest("hex");
}

async function calcDigestChunk(file, offset, chunkSize) {
  const chunk = await readChunk(file, offset, chunkSize);
  return createHash().update(chunk).digest("hex");
}

const NUM_RETRIES = 3;
const TIMEOUT_MS = 4000;

async function fetchRetry(...args) {
  args.signal = AbortSignal.timeout(TIMEOUT_MS);
  let numRetriesLeft = NUM_RETRIES;
  while (numRetriesLeft > 0) {
    try {
      return await fetch(...args);
    } catch (error) {
      console.log(error);
    }
    numRetriesLeft--;
  }
  throw new Error();
}

function roundTo2(n) {
  // biome-ignore lint/style/useTemplate: it's fine.
  return +(Math.round(n + "e+2") + "e-2");
}

export default Upchunker;
