const { addonBuilder } = require("stremio-addon-sdk");
const manifest = require("./manifest");
const DEBUG = false;

const engine = require("./sites/engine");
const khmerave = require("./sites/khmerave");
const phumi2 = require("./sites/phumi2");
const cat3movie = require("./sites/cat3movie");

const PAGE_TRACKER = new Map();
const PAGE_URL_CACHE = new Map();

const sites = require("./sites/config");

const axiosClient = require("./utils/fetch");
const cheerio = require("cheerio");
const { normalizePoster, mapMetas, uniqById } = require("./utils/helpers");

//const { makeMetaId } = require("./utils/hash");
const { URL_CACHE, EP_CACHE, CATALOG_CACHE } = require("./utils/cache");

function applyMetaId(items, prefix) {
  return items.map(item => {
    const url = item.id || item.url;
    if (typeof url !== "string" || !url.trim()) return null;

    const metaId = `${prefix}:${encodeURIComponent(url)}`;
    URL_CACHE.set(metaId, url);

    return {
      ...item,
      id: metaId
    };
  }).filter(Boolean);
}

const TYPE = "series";

const ENGINES = {
  vip: engine,
  sunday: engine,  
  idrama: engine,
  khmerave,
  merlkon: khmerave,
  phumi2,
  cat3movie
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
    let cacheKey;

    // Phumi2 uses normalized paging -> custom cache key later
    if (id !== "phumi2" && id !== "cat3movie") {
      cacheKey = `catalog:${id}:${JSON.stringify(extra || {})}`;
      const cached = CATALOG_CACHE.get(cacheKey);
      if (cached) return cached;
    }

    const ctx = getSiteEngine(id);
    if (DEBUG) console.log("CATALOG HANDLER DEBUG:", { id, extra });

    if (!ctx) return { metas: [] };

    const { site, engine: siteEngine } = ctx;

    // KhmerAve / Merlkon: search
    if (extra?.search && (id === "khmerave" || id === "merlkon")) {
      const keyword = encodeURIComponent(extra.search);

      const url = id === "merlkon"
        ? `https://www.khmerdrama.com/?s=${keyword}`
        : `https://www.khmeravenue.com/?s=${keyword}`;

      const items = await siteEngine.getCatalogItems(id, site, url);
      const fixed = applyMetaId(items, id);

      const result = { metas: mapMetas(fixed, TYPE) };
      CATALOG_CACHE.set(cacheKey, result);
      return result;
    }

    // KhmerAve / Merlkon: paging
    if (id === "khmerave" || id === "merlkon") {
      const WEBSITE_PAGE_SIZE = site.pageSize || 18;
      const PAGES_PER_BATCH = 2;
      const SKIP_STEP = 300;

      const skip = Number(extra?.skip || 0);

      const startPage =
        Math.floor(skip / SKIP_STEP) * PAGES_PER_BATCH + 1;

      const base = String(site.baseUrl || "").replace(/\/$/, "");
      const pages = [];

      for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
        const url = p === 1 ? `${base}/` : `${base}/page/${p}/`;
        pages.push(siteEngine.getCatalogItems(id, site, url));
      }

      const results = await Promise.all(pages);
      const allItems = results.flat();

      if (!allItems.length) return { metas: [] };

      const uniq = uniqById(allItems);
      const fixed = applyMetaId(uniq, id);

      const result = {
        metas: mapMetas(
          fixed.slice(0, WEBSITE_PAGE_SIZE * PAGES_PER_BATCH),
          TYPE
        ),
        cacheMaxAge: 3600
      };

      CATALOG_CACHE.set(cacheKey, result);
      return result;
    }

    // SundayDrama (Blogger): search + paging
    if (id === "sunday") {
      const base = String(site.baseUrl || "").replace(/\/$/, "");

      let url = extra?.search
        ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=20&m=1`
        : `${base}/?max-results=20&m=1`;

      const skip = Number(extra?.skip || 0);
      const SKIP_STEP = 100;
      const steps = Math.floor(skip / SKIP_STEP);

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
        Referer: `${base}/`,
        Accept: "text/html"
      };

      for (let i = 0; i < steps && url; i++) {
        const { data } = await axiosClient.get(url, { headers });
        const $ = cheerio.load(data);

        const older =
          $("a.blog-pager-older-link").attr("href") ||
          $("#Blog1_blog-pager-older-link").attr("href") ||
          "";

        url = older ? older : null;
      }

      let allItems = [];

      if (url) {
        const { data } = await axiosClient.get(url, { headers });
        const $ = cheerio.load(data);

        const articles = $("article.blog-post").toArray();

        for (const el of articles) {
          const $el = $(el);

          const aImg = $el.find("a.entry-image-wrap").first();
          const link =
            aImg.attr("href") ||
            $el.find("h2.entry-title a").attr("href") ||
            "";

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
            id: link,
            name: title,
            poster: normalizePoster(img),
          });
        }
      }

      const uniq = uniqById(allItems);
      const fixed = applyMetaId(uniq, id);

      const result = {
        metas: mapMetas(fixed, TYPE)
      };

      CATALOG_CACHE.set(cacheKey, result);
      return result;
    }

    // Phumi2 (Blogger): search + paging
    if (id === "phumi2") {
      const base = String(site.baseUrl || "").replace(/\/$/, "");

      const startUrl = extra?.search
        ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=12`
        : `${base}/?max-results=12`;

      const WEBSITE_PAGE_SIZE = site.pageSize || 12;

      const skip = Number(extra?.skip || 0);
      const rawTargetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

      const pageKeyBase = `phumi2:${id}:${extra?.search || ""}`;
      const lastPage = PAGE_TRACKER.get(pageKeyBase) || 1;

      const targetPage =
        rawTargetPage > lastPage + 1
          ? lastPage + 1
          : rawTargetPage;

      const searchKey = extra?.search || "";
      cacheKey = `catalog:${id}:${searchKey}:page:${targetPage}`;

      const cached = CATALOG_CACHE.get(cacheKey);
      if (cached) return cached;

      let url = startUrl;
      let currentPage = 1;
      let allItems = [];

      const headers = {
        "User-Agent":
          "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
        Referer: `${base}/`,
      };

      let resumePage = 1;

      for (let p = targetPage; p >= 1; p--) {
        const cachedUrl = PAGE_URL_CACHE.get(`${pageKeyBase}:page:${p}`);
        if (cachedUrl) {
          url = cachedUrl;
          resumePage = p;
          break;
        }
      }

      currentPage = resumePage;

      if (!PAGE_URL_CACHE.has(`${pageKeyBase}:page:1`)) {
        PAGE_URL_CACHE.set(`${pageKeyBase}:page:1`, startUrl);
      }

      while (currentPage < targetPage && url) {
        const { data } = await axiosClient.get(url, { headers });
        const nextUrl = siteEngine.getNextPageUrl(base, data);

        if (nextUrl) {
          PAGE_URL_CACHE.set(`${pageKeyBase}:page:${currentPage + 1}`, nextUrl);
        }

        url = nextUrl;
        currentPage++;
      }

      if (url) {
        PAGE_URL_CACHE.set(`${pageKeyBase}:page:${targetPage}`, url);
        const items = await siteEngine.getCatalogItems(id, site, url);
        allItems.push(...items);
      }

      const uniq = uniqById(allItems);
      const fixed = applyMetaId(uniq, id);

      const result = {
        metas: mapMetas(fixed, TYPE),
        cacheMaxAge: 3600
      };

      PAGE_TRACKER.set(pageKeyBase, targetPage);
      CATALOG_CACHE.set(cacheKey, result);
      return result;
    }

    // Cat3Movie: custom next-page pagination
    if (id === "cat3movie") {
      const base = String(site.baseUrl || "").replace(/\/$/, "");
      const SKIP_STEP = 100;

      const skip = Number(extra?.skip || 0);
      const targetPage = Math.floor(skip / SKIP_STEP) + 1;

      cacheKey = `catalog:${id}:${extra?.search || ""}:page:${targetPage}`;

      const cached = CATALOG_CACHE.get(cacheKey);
      if (cached) return cached;

      const url = extra?.search
        ? targetPage === 1
          ? `${base}/?s=${encodeURIComponent(extra.search)}`
          : `${base}/page/${targetPage}/?s=${encodeURIComponent(extra.search)}`
        : targetPage === 1
          ? `${base}/`
          : `${base}/page/${targetPage}/`;

      const items = await siteEngine.getCatalogItems(id, site, url);
      if (!items.length) return { metas: [] };

      const fixed = applyMetaId(items, id);

      const result = {
        metas: mapMetas(fixed, "movie"),
        cacheMaxAge: 3600
      };

      CATALOG_CACHE.set(cacheKey, result);
      return result;
    }
	
    // VIP / iDrama: normal paging
    const WEBSITE_PAGE_SIZE = site.pageSize || 30;
    const PAGES_PER_BATCH = 2;
    const SKIP_STEP = 200;

    const skip = Number(extra?.skip || 0);

    const startPage =
      Math.floor(skip / SKIP_STEP) * PAGES_PER_BATCH + 1;

    const base = String(site.baseUrl || "").replace(/\/$/, "");
    const pages = [];

    for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
      const url = p === 1 ? `${base}/` : `${base}/page/${p}/`;
      pages.push(siteEngine.getCatalogItems(id, site, url));
    }

    const results = await Promise.all(pages);
    const allItems = results.flat();

    if (!allItems.length) return { metas: [] };

    const uniq = uniqById(allItems);
    const fixed = applyMetaId(uniq, id);

    const result = {
      metas: mapMetas(
        fixed.slice(0, WEBSITE_PAGE_SIZE * PAGES_PER_BATCH),
        TYPE
      ),
      cacheMaxAge: 3600
    };

    CATALOG_CACHE.set(cacheKey, result);
    return result;

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
    if (DEBUG) console.log("META HANDLER DEBUG:", { id, prefix: id.split(":")[0] });

    const parts = id.split(":");
    const prefix = parts[0];
    const metaType = prefix === "cat3movie" ? "movie" : TYPE;

    const ctx = getSiteEngine(prefix);
    if (!ctx) return { meta: null };

    const { site, engine: siteEngine } = ctx;

    let seriesUrl = URL_CACHE.get(id);

    if (!seriesUrl && parts.length > 1) {
      try {
        seriesUrl = decodeURIComponent(parts.slice(1).join(":"));
      } catch {
        seriesUrl = null;
      }
    }

    if (DEBUG) console.log("META SERIES URL DEBUG:", {
      id,
      prefix,
      seriesUrl
    });

    if (!seriesUrl) return { meta: null };

    let episodes;

    if (prefix === "khmerave" || prefix === "merlkon") {
      episodes = await khmerave.getEpisodes(prefix, seriesUrl);
    } else if (prefix === "phumi2") {
      episodes = await siteEngine.getEpisodes(prefix, seriesUrl);

      if (!episodes.length) {
        if (DEBUG) console.log("PHUMI2 META RETRY:", seriesUrl);
        await new Promise(resolve => setTimeout(resolve, 1200));
        episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
      }
    } else {
      episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
    }

    if (!episodes.length) return { meta: null };

    if (
      episodes.length > 1 &&
      Number.isFinite(episodes[0]?.episode) &&
      Number.isFinite(episodes[episodes.length - 1]?.episode) &&
      episodes[0].episode > episodes[episodes.length - 1].episode
    ) {
      episodes = episodes.reverse();
    }

    EP_CACHE.set(id, episodes);

    const first = episodes[0];
    const cleanName = (first.title || "KhmerDub")
      .replace(/\[.*?\]/g, "")
      .replace(/-\s*$/, "")
      .trim();

    return {
      meta: {
        id,
        type: metaType,
        name: cleanName,
        description: (first.title || "KhmerDub").replace(/\[.*?\]/g, ""),
        poster: first.thumbnail,
        background: first.thumbnail,
        videos: prefix === "cat3movie"
          ? [{
              id: `${id}:1`,
              title: cleanName,
              description: cleanName,
              thumbnail: first.thumbnail
            }]
          : episodes.map((ep) => ({
              id: `${id}:${ep.episode}`,
              title: ep.title || `Episode ${ep.episode}`,
              description: `Episode ${ep.episode}`,
              season: 1,
              episode: ep.episode,
              thumbnail: ep.thumbnail
            })),
      },
    };;
  } catch (err) {
    console.error("meta error:", err);
    return { meta: null };
  }
});

/* =========================
   STREAM
========================= */
builder.defineStreamHandler(async ({ id }) => {
  try {
    const parts = id.split(":");
    if (parts.length < 2) return { streams: [] };

    const episode = parts.pop();
    const metaId = parts.join(":");

    const epNum = Number(episode);
    if (!Number.isInteger(epNum) || epNum <= 0) {
      return { streams: [] };
    }

    const metaParts = metaId.split(":");
    const prefix = metaParts[0];

    const ctx = getSiteEngine(prefix);
    if (!ctx) return { streams: [] };

    const { site, engine: siteEngine } = ctx;

    let seriesUrl = URL_CACHE.get(metaId);

    if (!seriesUrl && metaParts.length > 1) {
      try {
        seriesUrl = decodeURIComponent(metaParts.slice(1).join(":"));
      } catch {
        seriesUrl = null;
      }
    }

    if (!seriesUrl) return { streams: [] };

    let episodes = EP_CACHE.get(metaId);

    if (!episodes) {
      if (prefix === "khmerave" || prefix === "merlkon") {
        episodes = await khmerave.getEpisodes(prefix, seriesUrl);
      } else {
        episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
      }

      if (!episodes.length) return { streams: [] };

      if (
        episodes.length > 1 &&
        Number.isFinite(episodes[0]?.episode) &&
        Number.isFinite(episodes[episodes.length - 1]?.episode) &&
        episodes[0].episode > episodes[episodes.length - 1].episode
      ) {
        episodes = episodes.reverse();
      }

      EP_CACHE.set(metaId, episodes);
    }

    let ep = episodes.find(e => e.episode === epNum);
    if (!ep && epNum - 1 >= 0 && epNum - 1 < episodes.length) {
      ep = episodes[epNum - 1];
    }
    if (!ep) return { streams: [] };

    let stream;

    if (prefix === "khmerave" || prefix === "merlkon") {
      stream = await khmerave.getStream(prefix, ep.url, ep.episode);
    } else {
      stream = await siteEngine.getStream(prefix, ep.url, epNum);
    }

    if (!stream) return { streams: [] };

    return { streams: [stream] };
  } catch (err) {
    console.error("stream error:", err);
    return { streams: [] };
  }
});

module.exports = builder.getInterface();