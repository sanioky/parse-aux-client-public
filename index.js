#!/usr/bin/env node

const fs = require("fs");
const https = require("https");
const crypto = require("crypto");
const zlib = require("zlib");
const util = require("util");
const walk = require("walk");
const zip = require("adm-zip");
const concat = require("concat-stream");
const async = require("async");
const mime = require("mime-types");
const readChunk = require("read-chunk");
const fileType = require("file-type");
const validator = require("validator");
const commandLineArgs = require("command-line-args");
const _ = require("lodash");
const azure = require("azure-storage");
const request = require("request");

const aux = "https://aux.parse.buddy.com/";

// Delete this when the certificate is arranged!
const agent = new https.Agent({ rejectUnauthorized: false });

function listBlobs(service, container, listing, continuationToken, callback) {
  service.listBlobsSegmented(container, continuationToken, null, function(error, result, response) {
    if (error) {
      callback(error);
    } else {
      _.forEach(result.entries, function(item) { listing.push(item.name); });

      if (result.continuationToken !== null) {
        listBlobs(service, container, listing, result.continuationToken, callback);
      } else {
        callback(null, listing);
      }
    }
  });
}

function list(appID, secret, callback) {
  console.log("Listing existing hash blobs...");

  var listing = [];

  request.get(aux + "hosting",
    { json: true, agent: agent, auth: { user: appID, password: secret } }, function(error, response, body) {
      if (error !== null) {
        callback(error);
      } else {
        const service = azure.createBlobServiceWithSas(body.uri, body.token);

        listBlobs(service, appID + "-public", listing, null, callback);
      }
    });
}

function getCurrentVersion(appID, secret, callback) {
  console.log("Fetching current version...");

  request.get(aux + "app/current",
    { agent: agent, auth: { user: appID, password: secret } }, callback);
}

function uploadFile(appID, secret, hash, filename, callback) {
  request.post(aux + "hosting/" + hash,
    { json: true, agent: agent, auth: { user: appID, password: secret } }, function(error, response, body) {
      if (error !== null) {
        callback(error);
      } else {
        var options = {};
        var mimeLookup = mime.lookup(filename);
        if (mimeLookup !== false) {
          options = { contentSettings: { contentType: mimeLookup }};
        } else {
          const buffer = readChunk.sync(filename, 0, 1024);
          const type = fileType(buffer);

          if (type !== null) {
            options = { contentSettings: { contentType: type.mime }};
          } else {
            if (validator.isAscii(buffer.toString())) {
              options = { contentSettings: { contentType: "text/plain" }};
            }
          }
        }

        const service = azure.createBlobServiceWithSas(body.uri, body.token);

        service.createBlockBlobFromLocalFile(appID + "-public", hash, filename, options, callback);
      }
    });
}

function uploadMapping(appID, secret, version, mapping, callback) {
  console.log("Uploading name → hash mapping...");

  const stripPrefix = new RegExp("^public/");

  mapping = _.mapKeys(mapping, function(value, key) {
    return key.replace(stripPrefix, "");
  });

  request.post(aux + "app/map/" + version,
    { json: true, agent: agent, auth: { user: appID, password: secret }, body: mapping }, callback);
}

function setVersion(appID, secret, version, callback) {
  console.log("Setting active version...");

  request.post(aux + "app/current",
    { json: true, agent: agent, auth: { user: appID, password: secret }, body: { version: version } }, callback);
}

function uploadCloudCode(appID, secret, version, callback) {
  console.log("Uploading cloud code...");

  const zipFile = new zip();
  zipFile.addLocalFolder("cloud");
  const zipBuffer = zipFile.toBuffer();

  request.post(aux + "app/cloudcode/" + version + ".zip",
    { agent: agent, auth: { user: appID, password: secret }, body: zipBuffer }, callback);
}

function hashWalk(directory, callback) {
  console.log("Walking local public directory subtree...");

  const hashes = {};

  const walker = walk.walk(directory);

  walker.on("file", function(root, stats, next) {
    const fullName = root + "/" + stats.name;

    const hash = crypto.createHash("sha256");
    hash.setEncoding("hex");

    const input = fs.createReadStream(fullName);
    const output = concat(function(data) {
      hashes[fullName] = data;
    });

    input.pipe(hash).pipe(output);

    next();
  });

  walker.on("end", function() {
    callback(null, hashes);
  });
}

function uploadMissing(appID, secret, local, remote, callback) {
  const invertedHashes = _.invert(local);
  const missing = _.difference(_.keys(invertedHashes), remote);

  const localCount = _.keys(local).length;

  if (missing.length > 0) {
    console.log(util.format("Uploading %d (of %d) public asset(s)...", missing.length, localCount));
  } else {
    console.log(util.format("%d public assets already synchronized!", localCount));
    return callback();
  }

  const filenames = [];
  _.forEach(missing, function(hash) {
    filenames.push(invertedHashes[hash]);
  });

  function doUpload(filename, callback) {
    uploadFile(appID, secret, local[filename], filename, callback);
  }

  async.eachLimit(filenames, 16, doUpload, callback);
}

function bail(error) {
  if (error !== null) {
    console.error(error);
  }
  process.exit(1);
}

function createVersionExecute(appID, secret, version, local, remote) {
  async.parallel({
    sync: function(callback) { uploadMissing(appID, secret, local, remote, callback); },
    cloudCode: function(callback) { uploadCloudCode(appID, secret, version, callback); },
    mapping: function(callback) { uploadMapping(appID, secret, version, local, callback); }
  }, function(error, results) {
    if (error !== null) {
      bail(error);
    } else {
      setVersion(appID, secret, version, function(error) {
        if (error !== null) {
          bail(error);
        } else {
          console.log("All done!")
        }
      });
    }
  });
}

function createVersion(appID, secret, version) {
  async.parallel({
      local: function(callback) { hashWalk("public", callback); },
      remote: function(callback) { list(appID, secret, callback); }
    }, function(error, results) {
      if (error !== null) {
        bail(error);
      } else {
        createVersionExecute(appID, secret, version, results.local, results.remote);
      }
  });
}

function listVersions(appID, secret, callback) {
  console.log("Listing application versions...");

  request.get(aux + "app/versions",
    { json: true, agent: agent, auth: { user: appID, password: secret } }, callback);
}

function printStatus(selection) {
  return function(error, response) {
    if (error !== null) {
      console.log(error);
    } else {
      if ((response.statusCode >= 200) && (response.statusCode < 300)) {
        console.log(selection(response));
      } else {
        console.log("HTTP error:", response.statusCode, response.statusMessage);
      }
    }
  };
}

const cli = commandLineArgs([
  { name: "listVersions", alias: "l", type: Boolean },
  { name: "createVersion", alias: "c", type: Number, multiple: false },
  { name: "activateVersion", alias: "a", type: Number, multiple: false },
  { name: "currentVersion", alias: "v", type: Boolean }
]);

var options = cli.parse()

if (_.keys(options).length == 0) {
  console.log(cli.getUsage());
  process.exit(1);
}

if (!(("BUDDY_PARSE_APP_ID" in process.env) && ("BUDDY_PARSE_MASTER_KEY" in process.env))) {
  console.log("Required environment variables: BUDDY_PARSE_APP_ID, BUDDY_PARSE_MASTER_KEY");
  process.exit(1);
}

const requirements = [
  fs.existsSync("cloud") && fs.statSync("cloud").isDirectory(),
  fs.existsSync("public") && fs.statSync("public").isDirectory(),
  fs.existsSync("cloud/main.js") && fs.statSync("cloud/main.js").isFile()
]

if (_.includes(requirements, false)) {
  console.log("Required directories: cloud, public");
  console.log("The cloud directory must contain a main.js cloud code file.");
  process.exit(1);
}

config = {
  appID: process.env.BUDDY_PARSE_APP_ID,
  secret: process.env.BUDDY_PARSE_MASTER_KEY
}

if ("listVersions" in options) {
  listVersions(config.appID, config.secret, printStatus(function(r) {
    return r.body.versions.sort();
  }));
} else if ("createVersion" in options) {
  if (options.createVersion === null) {
    console.log("Error: version required.");
    process.exit(1);
  }

  createVersion(config.appID, config.secret, options.createVersion);
} else if ("currentVersion" in options) {
  getCurrentVersion(config.appID, config.secret, printStatus(function(r) {
    return r.body;
  }));
} else if ("activateVersion" in options) {
  if (options.activateVersion === null) {
    console.log("Error: version required.");
    process.exit(1);
  }

  setVersion(config.appID, config.secret, options.activateVersion, printStatus(function(r) {
    return "done"
  }));
} else {
  console.log("No valid instruction given; exiting.");
}
