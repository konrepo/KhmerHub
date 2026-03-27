// phumi2.js

const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");
const {
  normalizePoster,
  uniqById
} = require("../utils/helpers");

const {
  resolvePlayerUrl,
  resolveOkEmbed,
  buildStream
} = require("../utils/streamResolvers");

const DEBUG = false;

/* =========================
   CONFIG
========================= */
const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9"
};

const DETAIL_CACHE = new Map();
const DETAIL_TTL = 5 * 60 * 1000;
const DETAIL_PENDING = new Map();

/* =========================
   HELPERS
========================= */
function absolutizeUrl(url, baseUrl) {
  if (!url) return "";
  try {
    return new URL(url, baseUrl).toString();
  } catch {
    return url;
  }
}

function cleanTitle(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function normalizePhumiPoster(url) {
  if (!url) return "";
  return normalizePoster(
    url
      .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/")
      .replace(/\/s\d+(-c)?\//gi, "/s0/")
      .replace(/=w\d+-h\d+[^&]*/gi, "=s0")
      .replace(/=s\d+(-c)?/gi, "=s0")
  );
}

function normalizeEpisodeTitle(title, index) {
  if (!title) return `Episode ${index + 1}`;

  let t = String(title).trim();

  t = t.replace(/^EP\s*/i, "Episode ");
  t = t.replace(/^Episode\s*(\d+)E$/i, "Episode $1 End");
  t = t.replace(/^Episode\s*(\d+)\s*E$/i, "Episode $1 End");

  return t;
}

function getCachedDetail(url) {
  const cached = DETAIL_CACHE.get(url);
  if (!cached) return null;

  if (Date.now() - cached.time > DETAIL_TTL) {
    DETAIL_CACHE.delete(url);
    return null;
  }

  return cached.data;
}

function getNextPageUrl(base, html) {
  const $ = cheerio.load(html);

  const older =
    $("a.blog-pager-older-link").attr("href") ||
    $("#Blog1_blog-pager-older-link").attr("href") ||
    $(".blog-pager-older-link").attr("href") ||
    $('a[rel="next"]').attr("href") ||
    "";

  if (older) {
    return absolutizeUrl(older, base);
  }

  const articles = $("article.blog-post").toArray();
  if (!articles.length) return null;

  const last = $(articles[articles.length - 1]);

  const published =
    last.find('meta[itemprop="datePublished"]').attr("content") ||
    last.find('time[datetime]').attr("datetime") ||
    last.find(".published").attr("datetime") ||
    "";

  if (!published) return null;

  return `${base}/search?updated-max=${encodeURIComponent(published)}&max-results=12`;
}

function parseVideosArray(html) {
  try {
    const match =
      html.match(/const\s+videos\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/i) ||
      html.match(/const\s+videos\s*=\s*(\[[\s\S]*?\]);/i) ||
      html.match(/let\s+videos\s*=\s*(\[[\s\S]*?\]);/i) ||
      html.match(/var\s+videos\s*=\s*(\[[\s\S]*?\]);/i);

    if (DEBUG) console.log("PHUMI2 parseVideosArray MATCH FOUND:", !!match);

    if (!match || !match[1]) return [];

    let raw = match[1].trim();

    if (DEBUG) console.log("PHUMI2 RAW:", raw.slice(0, 200));

    raw = raw
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");

    const parsed = JSON.parse(raw);

    if (DEBUG) console.log("PHUMI2 PARSED LENGTH:", parsed.length);

    return parsed
      .map((item, index) => ({
        title: normalizeEpisodeTitle(item?.title, index),
        file: String(item?.file || "").trim()
      }))
      .filter((item) => item.file);

  } catch (err) {
    console.error("PHUMI2 parseVideosArray ERROR:", err.message);
    return [];
  }
}

async function fetchWithRetry(url, headers, retries = 3) {
  let lastErr;

  for (let i = 0; i < retries; i++) {
    try {
      const retryHeaders = {
        ...headers,
        Referer: i === 0
          ? "https://www.phumikhmer1.club/"
          : url
      };

      const res = await axiosClient.get(url, { headers: retryHeaders });
      return res.data;
    } catch (err) {
      lastErr = err;

      const status = err.response?.status || 0;
      if (DEBUG) console.log("PHUMI2 FETCH RETRY:", {
        attempt: i + 1,
        status,
        url
      });

      if (status !== 429 && status !== 403 && status !== 503) {
        throw err;
      }

      const waitMs = 1500 * (i + 1);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }

  throw lastErr;
}

async function getPageDetail(url) {
  try {
    const cached = getCachedDetail(url);
    if (cached) {
      if (DEBUG) console.log("PHUMI2 getPageDetail CACHE HIT:", url);
      return cached;
    }

    const pending = DETAIL_PENDING.get(url);
    if (pending) {
      if (DEBUG) console.log("PHUMI2 getPageDetail PENDING HIT:", url);
      return await pending;
    }

    const requestPromise = (async () => {
      if (DEBUG) console.log("PHUMI2 getPageDetail URL:", url);

      const data = await fetchWithRetry(url, {
        ...PAGE_HEADERS,
        Referer: "https://www.phumikhmer1.club/"
      });

      if (DEBUG) console.log("PHUMI2 HTML LENGTH:", data?.length || 0);

      const html = String(data || "");
      const videos = parseVideosArray(html);

      if (DEBUG) console.log("PHUMI2 VIDEOS PARSED:", videos.length);

      if (!videos.length) {
        if (DEBUG) console.log("PHUMI2: FAILED TO PARSE VIDEOS");
        return null;
      }

      const $ = cheerio.load(html);

      const title =
        cleanTitle($("h1.entry-title").first().text()) ||
        cleanTitle($('meta[property="og:title"]').attr("content")) ||
        cleanTitle($("title").text());

      let thumbnail =
        $('meta[property="og:image"]').attr("content") ||
        $('meta[name="twitter:image"]').attr("content") ||
        $("#postimg img").first().attr("src") ||
        $("meta[itemprop='image']").attr("content") ||
        "";

      thumbnail = normalizePhumiPoster(thumbnail);

      const detail = {
        title,
        thumbnail,
        videos
      };

      DETAIL_CACHE.set(url, {
        time: Date.now(),
        data: detail
      });

      return detail;
    })();

    DETAIL_PENDING.set(url, requestPromise);

    const result = await requestPromise;
    DETAIL_PENDING.delete(url);
    return result;

  } catch (err) {
    DETAIL_PENDING.delete(url);
    console.error("PHUMI2 getPageDetail ERROR:", err.message);
    return null;
  }
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    const { data } = await axiosClient.get(url, {
      headers: {
        ...PAGE_HEADERS,
        Referer: siteConfig.baseUrl || url
      }
    });

    const $ = cheerio.load(data);
    const posts = $("div.blog-posts div.grid-posts article.blog-post").toArray();

    const results = posts.map((post) => {
      const $el = $(post);

      const a =
        $el.find("div.post-filter-image a.post-filter-link").first().length
          ? $el.find("div.post-filter-image a.post-filter-link").first()
          : $el.find("h2.entry-title a").first();

      const titleEl = $el.find("h2.entry-title").first();
      const imgEl = $el.find("img.snip-thumbnail").first();

      const title =
        cleanTitle(a.attr("title")) ||
        cleanTitle(titleEl.text()) ||
        cleanTitle(a.text());

      const link = absolutizeUrl(a.attr("href") || "", url);
      if (!title || !link) return null;

      let poster =
        imgEl.attr("data-src") ||
        imgEl.attr("src") ||
        a.find("img").attr("data-src") ||
        a.find("img").attr("src") ||
        "";

      poster = normalizePhumiPoster(poster);

      return {
        id: link,
        name: title,
        poster
      };
    });

    return uniqById(results.filter(Boolean));
  } catch (err) {
    console.error("phumi2 catalog error:", err.message);
    return [];
  }
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  try {
    if (DEBUG) console.log("PHUMI2 getEpisodes START:", {
      prefix,
      seriesUrl
    });

    const detail = await getPageDetail(seriesUrl);

    if (DEBUG) console.log("PHUMI2 getEpisodes DETAIL:", {
      hasDetail: !!detail,
      videoCount: detail?.videos?.length || 0
    });

    if (!detail?.videos?.length) {
      if (DEBUG) console.log("PHUMI2 getEpisodes: NO VIDEOS FOUND");
      return [];
    }

    const episodes = detail.videos.map((v, index) => ({
      id: index + 1,
      url: seriesUrl,
      title: detail.title || `Episode ${index + 1}`,
      season: 1,
      episode: index + 1,
      thumbnail: detail.thumbnail || "",
      released: new Date().toISOString(),
      behaviorHints: {
        group: `${prefix}:${encodeURIComponent(seriesUrl)}`
      }
    }));

    if (DEBUG) console.log("PHUMI2 getEpisodes SUCCESS:", episodes.length);

    return episodes;

  } catch (err) {
    console.error("PHUMI2 getEpisodes ERROR:", err.message);
    return [];
  }
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  try {
    if (!seriesUrl) return null;

    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return null;

    const v = detail.videos[episode - 1];
    if (!v?.file) return null;

    let url = String(v.file).trim();

    if (url.startsWith("//")) {
      url = "https:" + url;
    }

    url = url.replace(/^http:/i, "https:");

    if (url.includes("player.php")) {
      const resolved = await resolvePlayerUrl(url);
      if (!resolved) return null;
      url = resolved;
    }

    if (/ok\.ru\/(?:videoembed|video)\//i.test(url)) {
      const resolved = await resolveOkEmbed(url);
      if (!resolved) return null;
      url = resolved;
    }

    return buildStream(url, episode, v.title, "PhumiClub", "phumi2");
  } catch (err) {
    console.error("phumi2 getStream error:", err.message);
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};
