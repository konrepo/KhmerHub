const { addonBuilder } = require("stremio-addon-sdk");
const manifest = require("./manifest");

const engine = require("./sites/engine");
const khmerave = require("./sites/khmerave");
const phumi2 = require("./sites/phumi2");

const sites = require("./sites/config");

const axiosClient = require("./utils/fetch");
const cheerio = require("cheerio");
const { normalizePoster, mapMetas, uniqById } = require("./utils/helpers");

const TYPE = "series";

const ENGINES = {
  vip: engine,
  sunday: engine,
  idrama: engine,
  khmerave,
  merlkon: khmerave,
  phumi2
};

function getSiteEngine(id) {
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

    if (extra?.search && (id === "khmerave" || id === "merlkon")) {
      const keyword = encodeURIComponent(extra.search);

      const url = id === "merlkon"
        ? `https://www.khmerdrama.com/?s=${keyword}`
        : `https://www.khmeravenue.com/?s=${keyword}`;

      const items = await siteEngine.getCatalogItems(id, site, url);

      return { metas: mapMetas(items, TYPE) };
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

      return { metas: mapMetas(uniq, TYPE) };
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

      return { metas: mapMetas(uniq, TYPE) };
    }

    if (id === "phumi2") {
      const base = String(site.baseUrl || "").replace(/\/$/, "");

      const startUrl = extra?.search
        ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=12`
        : `${base}/?max-results=12`;

      const WEBSITE_PAGE_SIZE = site.pageSize || 12;
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
      return { metas: mapMetas(uniq, TYPE) };
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

    return { metas: mapMetas(items, TYPE) };

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
    const firstColon = id.indexOf(":");
    if (firstColon === -1) return { meta: null };

    const prefix = id.slice(0, firstColon);
    const encodedUrl = id.slice(firstColon + 1);

    const ctx = getSiteEngine(prefix);
    if (!ctx) return { meta: null };

    const { engine: siteEngine } = ctx;

    const seriesUrl = decodeURIComponent(encodedUrl);

    const episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
    if (!episodes.length) return { meta: null };

    const first = episodes[0];

    return {
      meta: {
        id,
        type: TYPE,
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

    let prefix, encodedUrl, episode;

    if (parts.length === 3) {
      [prefix, encodedUrl, episode] = parts;
    } else if (parts.length === 4) {
      prefix = parts[0];
      encodedUrl = parts[1];
      episode = parts[3];
    } else {
      return { streams: [] };
    }

    const ctx = getSiteEngine(prefix);
    if (!ctx) return { streams: [] };

    const { engine: siteEngine } = ctx;

    const epNum = Number(episode);
    if (!Number.isInteger(epNum) || epNum <= 0) {
      return { streams: [] };
    }

    const seriesUrl = decodeURIComponent(encodedUrl);

    const stream = await siteEngine.getStream(prefix, seriesUrl, epNum);
    if (!stream) return { streams: [] };

    return { streams: [stream] };

  } catch {
    return { streams: [] };
  }
});

module.exports = builder.getInterface();