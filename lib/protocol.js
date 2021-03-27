const { EventEmitter } = require("events");
const zlib = require("zlib");
const crypto = require("crypto");

function debug() {
  if (+process.env.GIT_DEBUG === 1) {
    console.log.apply(this, arguments);
  }
}

const Stages = {
  Initial: "Initial",
  PktLine: "PktLine",
  PackHeader: "PackHeader",
  PackData: "PackData",
  PackChecksum: "PackChecksum",
  Error: "Error",
  Final: "Final",
};

const ObjectTypes = {
  1: "commit",
  2: "tree",
  3: "blob",
  4: "tag",
  7: "ref_delta",
};

const ObjectNames = {
  commit: 1,
  tree: 2,
  blob: 3,
  tag: 4,
  ref_delta: 7,
};

const Zero = Buffer.from([0]);
const PackHeader = Buffer.from("PACK");
const FlushPkt = Buffer.from("0000");
const ZeroIdStr = "0".repeat(40);
const ZeroId = Buffer.from(ZeroIdStr);
const Capabilities = "side-band-64k";
const LF = Buffer.from("\n");
const DataBand = Buffer.from([1]);
const ProgressBand = Buffer.from([2]);
const ErrorBand = Buffer.from([3]);

class GitRequestParser extends EventEmitter {
  constructor(req, ignoreFlushPkt) {
    super();
    this.ignoreFlushPkt = ignoreFlushPkt;
    this.stage = Stages.Initial;
    this.objects = {};

    req.on("data", (chunk) => {
      if (this.stage === Stages.Error) return;
      if (this.stage === Stages.Final) {
        this.emit(
          "error",
          new Error(
            "Protocol error. Client sent more data after the final stage of the protocol."
          )
        );
        this.setStage(Stages.Error);
      } else if (this.stage === Stages.Initial) {
        this.setStage(Stages.PktLine);
      }
      this.buffer = this.buffer ? Buffer.concat([this.buffer, chunk]) : chunk;
      debug("NEW CHUNK", chunk.length, this.buffer.length);
      try {
        this.continueParsing();
      } catch (e) {
        this.emit("error", e);
        this.setStage(Stages.Error);
      }
    });

    req.on("end", () => {
      if (this.stage === Stages.Error) return;
      if (this.stage === Stages.PktLine && this.ignoreFlushPkt) {
        this.setStage(Stages.Final);
      }
      if (this.stage !== Stages.Final) {
        this.emit(
          "error",
          new Error(
            `Protocol error. The client did not send enough data. Current stage is ${this.stage}.`
          )
        );
        this.setStage(Stages.Error);
      } else {
        this.emit("end");
      }
    });

    req.on("error", (error) => {
      if (this.stage === Stages.Error) return;
      this.emit("error", error);
      this.setStage(Stages.Error);
    });
  }

  setStage(stage, p1, p2, p3) {
    this.stage = stage;
    this.emit("stage", this.stage, p1, p2, p3);
  }

  continueParsing() {
    let parseMore = true;
    while (
      this.stage !== Stages.Final &&
      this.stage !== Stages.Error &&
      parseMore
    ) {
      if (this.stage === Stages.PktLine) {
        parseMore = this.parsePktLines();
      } else if (this.stage === Stages.PackHeader) {
        parseMore = this.parsePackHeader();
      } else if (this.stage === Stages.PackData) {
        parseMore = this.parsePackData();
      } else if (this.stage === Stages.PackChecksum) {
        parseMore = this.parsePackChecksum();
      } else {
        throw new Error(`Invalid parser stage ${this.stage}.`);
      }
    }
  }

  parsePktLines() {
    while (this.buffer.length >= 4) {
      // First four characters are hex-encoded length of pkt-line
      const length = parseInt(this.buffer.subarray(0, 4).toString("utf8"), 16);
      if (isNaN(length) || (length < 4 && length !== 0)) {
        throw new Error(
          `Protocol error. Invalid pkt-line length of ${length}.`
        );
      }
      if (length === 0) {
        // The pkt-line length of "0000" is a flush pkt indicating the end packet lines
        this.buffer = this.buffer.slice(4);
        if (!this.ignoreFlushPkt) {
          // If PACK is expected, it must follow the first flush packet
          this.setStage(Stages.PackHeader);
        }
        return true; // Continue parsing Pack
      } else if (length <= this.buffer.length) {
        // Enough data buffered for the pkt-line to be extracted
        const pkt = this.buffer.subarray(4, length);
        this.buffer = this.buffer.slice(length);
        this.emit("pkt", pkt);
      } else {
        break; // Not enough data in buffer to extract pkt-line
      }
    }
    return false; // Not enough data in buffer to extract pkt-line
  }

  parsePackHeader() {
    if (this.buffer.length < PackHeader.length + 8) return false; // Not enough data in buffer to parse PACK header
    if (PackHeader.compare(this.buffer, 0, PackHeader.length) === 0) {
      const packVersion = this.buffer.readUInt32BE(PackHeader.length);
      const packObjectCount = this.buffer.readUInt32BE(PackHeader.length + 4);
      debug("PACK HEADER", {
        packVersion,
        packObjectCount,
      });
      if (packVersion !== 2 && packVersion !== 3) {
        throw new Error(
          `Protocol error. Expected pack version 2 or 3 but received ${packVersion}.`
        );
      }
      this.packVersion = packVersion;
      this.packObjectsLeft = packObjectCount;
      this.buffer = this.buffer.slice(PackHeader.length + 8);
      this.setStage(Stages.PackData, packVersion, packObjectCount);
      return true;
    } else {
      throw new Error("Protocol error. Expected PACK header not found.");
    }
  }

  parseVarint(ctx) {
    let v = 0;
    let moreBytes = true;
    let shift = 0;
    do {
      if (ctx.offset >= ctx.buffer.length) {
        throw new Error(
          "Protocol error. Not enough data sent by the client to parse a variable length integer."
        );
      }
      moreBytes = !!(ctx.buffer[ctx.offset] & 0b10000000);
      v += (ctx.buffer[ctx.offset] & 0b01111111) << shift;
      shift += 7;
      ctx.offset++;
    } while (moreBytes);
    return v;
  }

  parseDeltaInstruction(ctx) {
    if (ctx.buffer[ctx.offset] === 0) {
      throw new Error(
        "Protocol error. Deltified instruction starts with a byte with value of 0."
      );
    }
    let isCopy = !!(ctx.buffer[ctx.offset] & 0b10000000);
    if (isCopy) {
      let suboffset = 1;
      let start = 0;
      [0b00000001, 0b00000010, 0b00000100, 0b00001000].forEach(
        (mask, i) =>
          (start +=
            ctx.buffer[ctx.offset] & mask
              ? ctx.buffer[ctx.offset + suboffset++] << (8 * i)
              : 0)
      );
      let size = 0;
      [0b00010000, 0b00100000, 0b01000000].forEach(
        (mask, i) =>
          (size +=
            ctx.buffer[ctx.offset] & mask
              ? ctx.buffer[ctx.offset + suboffset++] << (8 * i)
              : 0)
      );
      if (ctx.offset + suboffset > ctx.buffer.length) {
        throw new Error(
          "Protocol error. Not enough data in buffer to parse a deltified copy instruction."
        );
      }
      if (size === 0) {
        size = 0x10000;
      }
      ctx.offset += suboffset;
      return { copy: { start, size } };
    } else {
      // insert
      return { insert: ctx.buffer[ctx.offset++] };
    }
  }

  undeltify(srcBuffer, deltaBuffer) {
    const delta = { offset: 0, buffer: deltaBuffer };
    const srcLength = this.parseVarint(delta);
    if (srcLength !== srcBuffer.length) {
      throw new Error(
        `Protocol error. The source length in the deltified object is ${srcLength} and does not match the base object's length of ${srcBuffer.length}.`
      );
    }
    const destLength = this.parseVarint(delta);
    const result = Buffer.alloc(destLength);
    let resultOffset = 0;
    while (delta.offset < delta.buffer.length) {
      const instruction = this.parseDeltaInstruction(delta);
      if (instruction.insert) {
        if (delta.offset + instruction.insert > delta.buffer.length) {
          throw new Error(
            "Protocol error. The deltified insert does not contain sufficient data."
          );
        }
        delta.buffer.copy(
          result,
          resultOffset,
          delta.offset,
          delta.offset + instruction.insert
        );
        resultOffset += instruction.insert;
        delta.offset += instruction.insert;
      } else {
        // copy
        if (instruction.copy.start + instruction.copy.size > srcBuffer.length) {
          throw new Error(
            "Protocol error. The deltified copy instruction is outside of the source object."
          );
        }
        srcBuffer.copy(
          result,
          resultOffset,
          instruction.copy.start,
          instruction.copy.start + instruction.copy.size
        );
        resultOffset += instruction.copy.size;
      }
    }
    if (resultOffset !== result.length) {
      throw new Error("Protocol error. Undeltified object is incomplete.");
    }
    debug("UNDELTIFIED", { srcLength, destLength });
    return result;
  }

  parsePackData() {
    if (this.buffer.length < 1) return false; // Not enough data in buffer to start parsing type and length of an object
    // Parse object length and type. First byte is special.
    let moreBytes = !!(this.buffer[0] & 0b10000000); // Bit 8 is 1 if subsequent bytes are part of the size
    let objectType = (this.buffer[0] & 0b01110000) >> 4; // Bits 5-7 encode the object type
    let length = this.buffer[0] & 0b00001111; // Bits 1-4 encode the size
    if (!{ 1: 1, 2: 1, 3: 1, 4: 1, 7: 1 }[objectType]) {
      throw new Error(
        `Protocol error. Server only supports pack object types 1-4, but client sent ${objectType}.`
      );
    }
    // Subsequent bytes contain length information until the most significat bit becomes 0.
    let bufferOffset = 1;
    let bitOffset = 4;
    while (moreBytes) {
      if (bufferOffset >= this.buffer.length) return false; // Not enough data in buffer to continue
      moreBytes = !!(this.buffer[bufferOffset] & 0b10000000); // Bit 8 is 1 if subsequent bytes are part of the size
      length += (this.buffer[bufferOffset] & 0b01111111) << bitOffset; // Bits 1-7 contain length
      bitOffset += 7;
      bufferOffset++;
    }
    debug("PACK OBJECT HEADER", {
      objectType: ObjectTypes[objectType],
      length, // The length is the _uncompressed_ size
      bufferLength: this.buffer.length - bufferOffset,
    });
    // Deltified representation starts with the identifier of the base object; resolve base object
    let baseObject;
    if (objectType === 7) {
      // obj_ref_delta
      if (bufferOffset + 20 >= this.buffer.length) return false; // Not enough data in buffer to continue
      const baseSha = this.buffer
        .subarray(bufferOffset, bufferOffset + 20)
        .toString("hex");
      bufferOffset += 20;
      baseObject = this.objects[baseSha];
      if (!baseObject) {
        throw new Error(
          `Protocol error. Base object ${baseSha} of a deltified object is not present in the pack.`
        );
      }
    }
    // Inflate compressed object data; TODO sync does not scale here
    let data;
    try {
      data = zlib.inflateSync(this.buffer.subarray(bufferOffset), {
        maxOutputLength: length,
        info: true, // Allows us to find out the number of bytes that were in the compressed representation
      });
    } catch (e) {
      if (e.code === "Z_BUF_ERROR") return false; // Not enought data in buffer to inflate the compressed object
      throw e;
    }
    // Undeltify the object
    if (objectType === 7) {
      data.buffer = this.undeltify(baseObject.data, data.buffer);
      objectType = baseObject.objectType;
    }
    this.buffer = this.buffer.slice(bufferOffset + data.engine.bytesWritten); // The .bytesWritten contains the number of bytes of the compressed represenation consumed from the buffer
    const sha1 = crypto
      .createHash("sha1")
      .update(ObjectTypes[objectType])
      .update(" ")
      .update(data.buffer.length.toString())
      .update(Zero)
      .update(data.buffer)
      .digest();
    this.objects[sha1.toString("hex")] = { objectType, data: data.buffer };
    this.emit("object", ObjectTypes[objectType], data.buffer, sha1);
    this.packObjectsLeft--;
    if (this.packObjectsLeft === 0) {
      this.setStage(Stages.PackChecksum);
    }
    return true; // Continue parsing subsequent objects
  }

  parsePackChecksum() {
    if (this.buffer.length < 20) return false; // Not enough data in buffer;
    if (this.buffer.length !== 20) {
      // TODO consider actually validating the checksum
      this.emit(
        "error",
        new Error(
          `Protocol error. Expected a 20 byte checksum at the end of the pack data, but remaining data is ${this.buffer.length} long.`
        )
      );
      this.setStage(Stages.Error);
    } else {
      this.setStage(Stages.Final);
    }
    return false;
  }
}

function collectBuffers(args, start) {
  let length = 0;
  const list = [];
  for (var k = start; k < args.length; k++) {
    let buffer = args[k];
    if (typeof buffer === "string") {
      buffer = Buffer.from(buffer);
    } else if (!Buffer.isBuffer(buffer)) {
      throw new Error("Only strings and buffers can be serialized to pkt-line");
    }
    length += buffer.length;
    list.push(buffer);
  }
  return [list, length];
}

// Side-band encoding of arguments
function toPktLinesWithBand(band) {
  let [list] = collectBuffers(arguments, 1);
  let buffer = Buffer.concat(list);
  let offset = 0;
  let lines = [];
  while (offset < buffer.length) {
    let subbuf = buffer.subarray(offset, offset + 999);
    let length = subbuf.length + 5;
    lines.push(Buffer.from(length.toString(16).padStart(4, "0"))); // pkt-line length
    lines.push(band); // Band id
    lines.push(subbuf); // Up to 999 bytes of payload
    offset += subbuf.length;
  }
  return Buffer.concat(lines);
}

function toPktLine() {
  let [list, length] = collectBuffers(arguments, 0);
  length += 4;
  list.unshift(Buffer.from(length.toString(16).padStart(4, "0")));
  return Buffer.concat(list);
}

function handlePost(repository, service) {
  return async (req, res) => {
    debug("POST", service, req.headers, req.query);
    res.set("content-type", `application/x-${service}-result`);
    res.set("cache-control", "no-cache");
    let commands = [];
    let objects = [];
    let upload = { want: [], have: [] };
    let requestedCapabilities;

    const onError = (e) => {
      parser.removeAllListeners();
      debug("ERROR", e);
      res.write(
        toPktLinesWithBand(
          ErrorBand,
          `Error processing the request: ${e.message}`
        )
      );
      res.write(FlushPkt);
      res.end();
    };

    const onReceivePackPkt = (pkt) => {
      pkt = pkt.toString("utf8").trim();
      debug("PKT", pkt.length);
      if (commands.length === 0) {
        [pkt, requestedCapabilities] = pkt.split("\x00");
      }
      let srcId, destId, ref;
      if (requestedCapabilities) {
        [srcId, destId, ref] = pkt.split(" ");
      } else {
        // Technically this is protocol violation, but this is what the git CLI does
        [srcId, destId, ref, requestedCapabilities] = pkt.split(" ");
      }
      commands.push({ srcId, destId, ref });
      debug("COMMAND", { srcId, destId, ref });
    };

    const onReceivePackObject = (objectType, data, sha) => {
      debug("OBJECT", objectType, sha, data.length, "\n");
      objects.push({ objectType, data, sha });
      debug("OBJECT COUNT", objects.length);
    };

    const onReceivePackEnd = async () => {
      debug("END");
      parser.removeAllListeners();
      try {
        await repository.receivePack(commands, objects);
      } catch (e) {
        return onError(e);
      }
      const message = await repository.getReceivePackSuccessMessage(
        req,
        commands,
        objects
      );
      if (message) {
        res.write(toPktLinesWithBand(ProgressBand, message));
      }
      res.write(FlushPkt);
      res.end();
    };

    const onUploadPackPkt = (pkt) => {
      pkt = pkt.toString("utf8").trim();
      debug("PKT", pkt.length);
      if (pkt === "done") return;
      if (upload.want.length === 0 && upload.have.length === 0) {
        [pkt, requestedCapabilities] = pkt.split("\x00");
      }
      let cmd, sha;
      if (requestedCapabilities) {
        [cmd, sha] = pkt.split(" ");
      } else {
        // Technically this is protocol violation, but this is what the git CLI does
        [cmd, sha, requestedCapabilities] = pkt.split(" ");
      }
      if (cmd !== "want" && cmd !== "have") {
        return onError(
          new Error(
            `Protocol error. Client sent unrecognized command '${cmd}'.`
          )
        );
      }
      if (cmd === "have" && upload.want.length === 0) {
        return onError(
          new Error(
            `Protocol error. Client sent 'have' command without sending any 'want' commands.`
          )
        );
      }
      upload[cmd].push(sha);
      debug("COMMAND", { cmd, sha });
    };

    const getUploadPack = async (request) => {
      const closure = {};
      const queue = [...request.want];

      const enqueue = (sha) => {
        if (sha.length !== 40) {
          throw new Error(
            `Error. Resolving dependency tree resulted in a sha "${sha}" which is not 40 characters long.`
          );
        }
        if (!closure[sha]) {
          closure[sha] = true;
          queue.push(sha);
        }
      };

      const computeClosure = async (sha) => {
        const object = (closure[sha] = await repository.getObject(sha));
        if (object.objectType === "commit") {
          const msg = object.data.toString().split("\n");
          let n = 0;
          while (msg[n] !== "") {
            let match = msg[n++].match(/\s*(tree|parent)\s+(.+)/);
            match && enqueue(match[2]);
          }
        } else if (object.objectType === "tree") {
          let offset = 0;
          while (offset < object.data.length) {
            if (object.data[offset] === 0) {
              enqueue(
                object.data.subarray(offset + 1, offset + 21).toString("hex")
              );
              offset += 21;
            } else {
              offset++;
            }
          }
        }
      };

      while (queue.length > 0) {
        await computeClosure(queue.shift());
      }
      debug("CLOSURE", Object.keys(closure).length, "objects");
      return Object.keys(closure).map((sha) => closure[sha]);
    };

    const onUploadPackEnd = async () => {
      debug("END", upload);
      res.write(toPktLine("NAK\n")); // Ignore 'haves' for now - not efficient
      let objects;
      try {
        objects = await getUploadPack(upload);
      } catch (e) {
        return onError(e);
      }
      const sha1 = crypto.createHash("sha1");
      // PACK header
      const packHeader = Buffer.from("PACK        "); // 12 bytes
      packHeader.writeUInt32BE(2, 4); // version
      packHeader.writeUInt32BE(objects.length, 8); // number of objects in the packfile
      res.write(toPktLinesWithBand(DataBand, packHeader));
      sha1.update(packHeader);
      // Objects
      objects.forEach((object) => {
        let length = object.data.length;
        let firstByte =
          (ObjectNames[object.objectType] << 4) | (length & 0b00001111);
        length = length >> 4;
        firstByte = firstByte | (length > 0 ? 0b10000000 : 0);
        let header = [firstByte];
        while (length > 0) {
          let nextByte = length & 0b01111111;
          length = length >> 7;
          nextByte = nextByte | (length > 0 ? 0b10000000 : 0);
          header.push(nextByte);
        }
        const data = zlib.deflateSync(object.data);
        header = Buffer.from(header);
        res.write(toPktLinesWithBand(DataBand, Buffer.from(header), data));
        sha1.update(header).update(data);
      });
      res.write(toPktLinesWithBand(DataBand, sha1.digest()));
      const message = await repository.getUploadPackSuccessMessage(
        req,
        objects
      );
      if (message) {
        res.write(toPktLinesWithBand(ProgressBand, message));
      }
      res.write(FlushPkt);
      res.end();
    };

    const parser = new GitRequestParser(req, service === "git-upload-pack");

    if (service === "git-receive-pack") {
      parser.on("pkt", onReceivePackPkt);
      parser.on("object", onReceivePackObject);
      parser.on("end", onReceivePackEnd);
    } else {
      // git-upload-pack
      parser.on("pkt", onUploadPackPkt);
      parser.on("end", onUploadPackEnd);
    }

    parser.on("stage", (stage) => {
      debug("STAGE", stage);
    });

    parser.on("error", onError);
  };
}

function handleGetRefs(repository) {
  return async (req, res) => {
    const supportedServices = ["git-receive-pack", "git-upload-pack"];
    if (!req.query.service) {
      return res.status(403).json({
        status: 403,
        message:
          "The service query parameter must be specified - only smart client git protocol is supported.",
      });
    }
    if (supportedServices.indexOf(req.query.service) < 0) {
      return res.status(403).json({
        status: 403,
        message: `Unsupported service '${req.query.service}.`,
      });
    }
    const refs = await repository.getRefs();
    res.status(200);
    res.set("content-type", `application/x-${req.query.service}-advertisement`);
    res.set("cache-control", "no-cache");
    res.write(toPktLine(`# service=${req.query.service}`, LF));
    res.write(FlushPkt);
    let caps = [Capabilities];
    const headRef = await repository.getHeadRef();
    if (headRef) {
      caps.push(`symref=HEAD:${headRef}`);
    }
    caps = caps.join(" ");
    if (!refs || refs.length === 0) {
      res.write(toPktLine(ZeroId, " capabilities^{}", Zero, caps, LF));
    } else {
      res.write(toPktLine(refs[0].sha, " ", refs[0].ref, Zero, caps, LF));
      for (let i = 1; i < refs.length; i++) {
        res.write(toPktLine(refs[i].sha, " ", refs[i].ref, LF));
      }
    }
    res.write(FlushPkt);
    res.end();
  };
}

exports.handlePost = handlePost;
exports.handleGetRefs = handleGetRefs;
exports.ZeroIdStr = ZeroIdStr;
exports.debug = debug;
