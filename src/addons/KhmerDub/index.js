const { addonBuilder } = require("stremio-addon-sdk");
const manifest = require("./manifest");

const enabledSites = new Set(
  manifest.catalogs.map(c => c.id)
);

const engine = require("./sites/engine");
const khmerave = require("./sites/khmerave");
const phumi2 = require("./sites/phumi2");
const cat3movie = require("./sites/cat3movie");
const khmertv = require("./sites/khmertv");
const xvideos = require("./sites/xvideos");

const sites = require("./sites/config");

const axiosClient = require("./utils/fetch");
const cheerio = require("cheerio");
const { normalizePoster, mapMetas, uniqById } = require("./utils/helpers");

const SITE_TYPES = {
  cat3movie: "movie",
  khmertv: "channel",
  xvideos: "movie",
  default: "series"
};

const ENGINES = {
  khmertv,
  vip: engine,
  sunday: engine,
  idrama: engine,
  khmerave,
  merlkon: khmerave,
  phumi2,
  cat3movie,
  xvideos
};

function getSiteEngine(id) {
  if (!enabledSites.has(id)) return null;

  const site = sites[id];
  const engine = ENGINES[id];

  if (!site || !engine) return null;

  return { site, engine };
}

const builder = new addonBuilder(manifest);

const deps = {
  getSiteEngine,
  SITE_TYPES,
  sites,
  axiosClient,
  cheerio,
  normalizePoster,
  mapMetas,
  uniqById
};

require("./handlers/catalog")(builder, deps);
require("./handlers/meta")(builder, deps);
require("./handlers/stream")(builder, deps);

module.exports = builder.getInterface();