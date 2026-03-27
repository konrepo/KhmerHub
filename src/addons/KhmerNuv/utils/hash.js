const crypto = require("crypto");

function makeMetaId(prefix, url) {
  if (!url || typeof url !== "string") {
    return `${prefix}:unknown`;
  }

  const cleanUrl = url
    .trim()
    .toLowerCase()
    .replace(/^http:/, "https:")
    .replace(/^https:\/\/www\./, "https://")
    .replace(/\/$/, "");

  const hash = crypto
    .createHash("md5")
    .update(cleanUrl)
    .digest("hex");

  return `${prefix}:${hash}`;
}

module.exports = {
  makeMetaId
};