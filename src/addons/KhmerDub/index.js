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

const sites = require("./sites/config");

const axiosClient = require("./utils/fetch");
const cheerio = require("cheerio");
const { normalizePoster, mapMetas, uniqById } = require("./utils/helpers");

const SITE_TYPES = {
  cat3movie: "movie",
  khmertv: "movie",
  default: "series"
};

const ENGINES = {
  vip: engine,
  sunday: engine,
  idrama: engine,
  khmerave,
  merlkon: khmerave,
  phumi2,
  cat3movie,
  khmertv
};

function getSiteEngine(id) {
  if (!enabledSites.has(id)) return null;

  const site = sites[id];
  const engine = ENGINES[id];

  if (!site || !engine) return null;

  return { site, engine };
}

const builder = new addonBuilder(manifest);

/* =========================
   CATALOG
========================= */
builder.defineCatalogHandler(async ({ id, extra }) => {
  try {
    const ctx = getSiteEngine(id);
    if (!ctx) return { metas: [] };

    const { site, engine: siteEngine } = ctx;
	
	if (id === "khmertv") {
      const skip = Number(extra?.skip || 0);
      if (skip > 0) return { metas: [] };

      const items = await siteEngine.getCatalogItems(id, site, "");
      return { metas: mapMetas(items, "movie") };
	}

    if (extra?.search && (id === "khmerave" || id === "merlkon")) {
      const keyword = encodeURIComponent(extra.search);

      const url = id === "merlkon"
        ? `https://www.khmerdrama.com/?s=${keyword}`
        : `https://www.khmeravenue.com/?s=${keyword}`;

      const items = await siteEngine.getCatalogItems(id, site, url);

      const type = SITE_TYPES[id] || SITE_TYPES.default;
      return { metas: mapMetas(items, type) };
    }

    if (id === "khmerave" || id === "merlkon") {
      const WEBSITE_PAGE_SIZE = site.pageSize || 18;
      const PAGES_PER_BATCH = 3;

      const skip = Number(extra?.skip || 0);
      const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

      const base = String(site.baseUrl || "").replace(/\/$/, "");
      const pages = [];

      for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
        const url = p === 1
          ? `${base}/`
          : `${base}/page/${p}/`;

        pages.push(siteEngine.getCatalogItems(id, site, url));
      }

      const results = await Promise.all(pages);
      const allItems = results.flat();
      const uniq = uniqById(allItems);

      const type = SITE_TYPES[id] || SITE_TYPES.default;
      return { metas: mapMetas(uniq, type) };
    }

    if (id === "sunday") {
      const base = String(site.baseUrl || "").replace(/\/$/, "");

      const startUrl = extra?.search
        ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=20`
        : `${base}/?max-results=20`;

      const WEBSITE_PAGE_SIZE = 20;
      const PAGES_PER_BATCH = 3;

      const skip = Number(extra?.skip || 0);
      const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

      let url = startUrl;
      let currentPage = 1;
      let allItems = [];

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        Referer: `${base}/`,
      };

      while (currentPage < targetPage && url) {
        const { data } = await axiosClient.get(url, { headers });
        const $ = cheerio.load(data);

        const older =
          $("a.blog-pager-older-link").attr("href") ||
          $("#Blog1_blog-pager-older-link").attr("href") ||
          "";

        url = older ? older : null;
        currentPage++;
      }

      for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
        const { data } = await axiosClient.get(url, { headers });
        const $ = cheerio.load(data);

        const articles = $("article.blog-post").toArray();

        for (const el of articles) {
          const $el = $(el);

          const aImg = $el.find("a.entry-image-wrap").first();
          const link = aImg.attr("href") || $el.find("h2.entry-title a").attr("href") || "";
          const title =
            (aImg.attr("title") || "").trim() ||
            ($el.find("h2.entry-title a").first().text() || "").trim();

          if (!title || !link) continue;

          const img =
            $el.find("img.entry-thumb").attr("src") ||
            aImg.find("span[data-src]").attr("data-src") ||
            aImg.find("img").attr("src") ||
            "";

          allItems.push({
            id: `sunday:${encodeURIComponent(link)}`,
            name: title,
            poster: normalizePoster(img),
          });
        }

        const older =
          $("a.blog-pager-older-link").attr("href") ||
          $("#Blog1_blog-pager-older-link").attr("href") ||
          "";

        url = older ? older : null;
      }

      const uniq = uniqById(allItems);

      const type = SITE_TYPES[id] || SITE_TYPES.default;
      return { metas: mapMetas(uniq, type) };
    }

    if (id === "phumi2" || id === "cat3movie") {
      const base = String(site.baseUrl || "").replace(/\/$/, "");

      const startUrl = extra?.search
	  ? id === "cat3movie"
        ? `${base}/?s=${encodeURIComponent(extra.search)}`
        : `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=12`
	  : id === "cat3movie"
        ? `${base}/`
        : `${base}/?max-results=12`;

      const WEBSITE_PAGE_SIZE = site.pageSize || (id === "cat3movie" ? 40 : 12);
      const PAGES_PER_BATCH = 3;

      const skip = Number(extra?.skip || 0);
      const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

      let url = startUrl;
      let currentPage = 1;
      let allItems = [];

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        Referer: `${base}/`,
      };

      while (currentPage < targetPage && url) {
        const { data } = await axiosClient.get(url, { headers });
        url = siteEngine.getNextPageUrl(base, data);
        currentPage++;
      }

      for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
        const items = await siteEngine.getCatalogItems(id, site, url);
        allItems.push(...items);

        const { data } = await axiosClient.get(url, { headers });
        url = siteEngine.getNextPageUrl(base, data);
      }

      const uniq = uniqById(allItems);
      const type = SITE_TYPES[id] || SITE_TYPES.default;
      return { metas: mapMetas(uniq, type) };
    }

    const pageSize = site.pageSize || 30;
    const skip = Number(extra?.skip || 0);
    const page = Math.floor(skip / pageSize) + 1;

    const base = String(site.baseUrl || "").replace(/\/$/, "");

    const url = extra?.search
      ? `${base}/?s=${encodeURIComponent(extra.search)}`
      : page === 1
        ? `${base}/`
        : `${base}/page/${page}/`;

    const items = await siteEngine.getCatalogItems(id, site, url);

    const type = SITE_TYPES[id] || SITE_TYPES.default;
    return { metas: mapMetas(items, type) };

  } catch (e) {
    console.error("catalog error:", e);
    return { metas: [] };
  }
});

/* =========================
   META
========================= */
builder.defineMetaHandler(async ({ id }) => {
  try {
    const parts = id.split(":");
    const prefix = parts[0];
    const encodedUrl = parts.slice(1).join(":");

    if (!prefix || !encodedUrl) return { meta: null };

    const ctx = getSiteEngine(prefix);
    if (!ctx) return { meta: null };

    const { engine: siteEngine } = ctx;
    const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
    const seriesUrl = decodeURIComponent(encodedUrl);

    const episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
    if (!episodes.length) return { meta: null };

    const first = episodes[0];

    if (siteType === "movie") {
      return {
        meta: {
          id,
          type: "movie",
          name: first.title,
          poster: first.thumbnail,
          background: first.thumbnail,
          description: first.title
        },
      };
    }

    return {
      meta: {
        id,
        type: siteType,
        name: first.title,
        poster: first.thumbnail,
        background: first.thumbnail,
        videos: episodes,
      },
    };
  } catch (err) {
    return { meta: null };
  }
});

/* =========================
   STREAM
========================= */
builder.defineStreamHandler(async ({ id }) => {
  try {
    const parts = id.split(":");
    const prefix = parts[0];
    const encodedUrl = parts[1];

    if (!prefix || !encodedUrl) {
      return { streams: [] };
    }

    const isMovie = (SITE_TYPES[prefix] || SITE_TYPES.default) === "movie";
    const epNum = isMovie ? 1 : Number(parts[parts.length - 1]);

    if (!isMovie && (!Number.isInteger(epNum) || epNum <= 0)) {
      return { streams: [] };
    }

    const ctx = getSiteEngine(prefix);
    if (!ctx) return { streams: [] };

    const { engine: siteEngine } = ctx;
    const seriesUrl = decodeURIComponent(encodedUrl);

    const stream = await siteEngine.getStream(prefix, seriesUrl, epNum);
    if (!stream) return { streams: [] };

    return {
      streams: Array.isArray(stream) ? stream : [stream]
    };
  } catch (err) {
    console.error("[defineStreamHandler]", err);
    return { streams: [] };
  }
  
});

module.exports = builder.getInterface();