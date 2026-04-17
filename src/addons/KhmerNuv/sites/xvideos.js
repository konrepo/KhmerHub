const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");

const { normalizePoster, uniqById } = require("../utils/helpers");
const { buildStream } = require("../utils/streamResolvers");

const DEBUG = false;
const log = (...args) => DEBUG && console.log(...args);
  
/* =========================
   CONFIG
========================= */
const BASE_URL = "https://www.xvideos.com";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36",
  Referer: `${BASE_URL}/`
};

/* =========================
   HELPERS
========================= */
function absolutize(url) {
  try {
    return new URL(url, BASE_URL).toString();
  } catch {
    return url || "";
  }
}

function cleanTitle(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function decodeEscapedUrl(url = "") {
  return String(url || "")
    .replace(/\\u0026/g, "&")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&")
    .trim();
}

function uniq(arr = []) {
  return [...new Set(arr.filter(Boolean))];
}

/* =========================
   EXTRACT SOURCES
========================= */
function extractJsonLdContentUrl(html = "") {
  try {
    const matches = [
      ...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/gi)
    ];

    for (const m of matches) {
      const raw = m[1];
      const json = JSON.parse(raw);
      if (json?.contentUrl) {
        return decodeEscapedUrl(json.contentUrl);
      }
    }
  } catch {}

  return null;
}

function extractPlayerSources(html = "") {
  const found = [];

  const patterns = [
    /html5player\.setVideoHLS\(['"]([^'"]+)['"]\)/gi,
    /html5player\.setVideoUrlHigh\(['"]([^'"]+)['"]\)/gi,
    /html5player\.setVideoUrlLow\(['"]([^'"]+)['"]\)/gi
  ];

  for (const re of patterns) {
    let match;
    while ((match = re.exec(html)) !== null) {
      found.push(decodeEscapedUrl(match[1]));
    }
  }

  const jsonLd = extractJsonLdContentUrl(html);
  if (jsonLd) found.push(jsonLd);

  return uniq(found);
}

function getQualityScore(url = "") {
  const u = String(url || "").toLowerCase();

  if (/\.m3u8(\?|$)/i.test(u)) return 1000;

  if (/2160|4k/.test(u)) return 900;
  if (/1440/.test(u)) return 800;
  if (/1080/.test(u)) return 700;
  if (/720/.test(u)) return 600;
  if (/480/.test(u)) return 500;
  if (/360/.test(u)) return 400;
  if (/240/.test(u)) return 300;

  if (/mp4_hd/.test(u)) return 650;
  if (/mp4_hq/.test(u)) return 625;
  if (/mp4_sd/.test(u)) return 450;
  if (/\.mp4(\?|$)/i.test(u)) return 425;

  return 0;
}

function pickHighestQualitySource(sources = []) {
  if (!sources.length) return null;

  return [...sources]
    .filter(Boolean)
    .sort((a, b) => getQualityScore(b) - getQualityScore(a))[0] || null;
}

/* =========================
   DETAIL
========================= */
async function getDetail(url) {
  try {
    const { data } = await axiosClient.get(url, { headers: HEADERS });
    const $ = cheerio.load(data);

    const title = cleanTitle(
      $("h2.page-title").text() ||
      $('meta[property="og:title"]').attr("content") ||
      $("title").text()
    );

    let poster = $('meta[property="og:image"]').attr("content") || "";
    poster = normalizePoster(poster);

    const sources = extractPlayerSources(data);
    const bestSource = pickHighestQualitySource(sources);

    return {
      title,
      poster,
      sources,
      videoUrl: bestSource
    };
  } catch {
    return null;
  }
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    const pageUrl = url || `${BASE_URL}/`;

    const { data } = await axiosClient.get(pageUrl, {
      headers: HEADERS
    });

    const $ = cheerio.load(data);

    const items = $(".thumb-block")
      .not(".video-suggest")
      .toArray();

    const results = items
      .map((el) => {
        const $el = $(el);

        const titleEl = $el.find("p.title a").first();
        const imgEl = $el.find("img").first();

        const link = titleEl.attr("href") || $el.find("a").first().attr("href") || "";
        const title = cleanTitle(
          titleEl.attr("title") ||
          titleEl.text()
        );
        const poster =
          imgEl.attr("data-src") ||
          imgEl.attr("src") ||
          "";

        if (!link || !title) return null;

        return {
          id: `xvideos:${encodeURIComponent(absolutize(link))}`,
          name: title,
          poster: normalizePoster(poster)
        };
      })
      .filter(Boolean);

    return uniqById(results);
  } catch {
    return [];
  }
}

/* =========================
   NEXT PAGE
========================= */
function getNextPageUrl(base, html) {
  const $ = cheerio.load(html);

  const next =
    $(".pagination .next-page").attr("href") ||
    $(".pagination a[rel='next']").attr("href");

  return next ? absolutize(next) : null;
}

/* =========================
   EPISODES (single video)
========================= */
async function getEpisodes(prefix, seriesUrl) {
  const detail = await getDetail(seriesUrl);
  if (!detail) return [];

  return [
    {
      id: `${prefix}:${encodeURIComponent(seriesUrl)}`, 
      title: detail.title,
      season: 1,
      episode: 1,
      thumbnail: detail.poster,
      description: detail.title
    }
  ];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, episodeUrl, episode = 1) {
  try {
    const detail = await getDetail(episodeUrl);
    if (!detail || !detail.videoUrl) return null;

    return buildStream(
      detail.videoUrl,
      episode,
      detail.title || "xVideos",
      "xVideos",
      "xvideos"
    );
  } catch {
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl

};