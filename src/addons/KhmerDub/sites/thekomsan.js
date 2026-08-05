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

/* =========================
   CONFIG
========================= */
const SITE_ID = "thekomsan";
const SITE_NAME = "TheKomsan";
const BASE_URL = "https://www.thekomsan.com";

const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 " +
    "(KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
  Accept:
    "text/html,application/xhtml+xml,application/xml;q=0.9," +
    "image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Cache-Control": "no-cache",
  Pragma: "no-cache"
};

/* =========================
   BASIC HELPERS
========================= */
function absolutizeUrl(url, baseUrl = BASE_URL) {
  if (!url) return "";

  try {
    return new URL(String(url).trim(), baseUrl).toString();
  } catch {
    return String(url).trim();
  }
}

function cleanTitle(text) {
  return String(text || "")
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtmlEntities(value) {
  if (!value) return "";

  return String(value)
    .replace(/&quot;/gi, '"')
    .replace(/&#34;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeTheKomsanPoster(url) {
  if (!url) return "";

  let poster = decodeHtmlEntities(String(url).trim());

  if (poster.startsWith("//")) {
    poster = `https:${poster}`;
  }

  poster = poster
    .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/")
    .replace(/\/s\d+(?:-c|-rw)?\//gi, "/s0/")
    .replace(/=w\d+-h\d+[^&"']*/gi, "=s0")
    .replace(/=s\d+(?:-c|-rw)?/gi, "=s0");

  return normalizePoster(poster);
}

function normalizeVideoUrl(url, baseUrl = BASE_URL) {
  if (!url) return "";

  let value = decodeHtmlEntities(String(url).trim())
    .replace(/\\\//g, "/")
    .replace(/^['"]|['"]$/g, "");

  if (value.startsWith("//")) {
    value = `https:${value}`;
  } else if (value.startsWith("/")) {
    value = absolutizeUrl(value, baseUrl);
  }

  return value;
}

function normalizeEpisodeTitle(title, index) {
  const fallback = `Episode ${index + 1}`;
  const value = cleanTitle(title);

  if (!value) return fallback;

  const match = value.match(
    /^(?:EPISODE|EP)[.\s_-]*(\d+)\s*(E|END)?$/i
  );

  if (!match) return value;

  const episodeNumber = Number(match[1]);
  const isEnd = Boolean(match[2]);

  return `Episode ${episodeNumber}${isEnd ? " End" : ""}`;
}

function extractYouTubeId(url) {
  if (!url) return "";

  return (
    url.match(/youtu\.be\/([^?&/]+)/i)?.[1] ||
    url.match(/[?&]v=([^&]+)/i)?.[1] ||
    url.match(/youtube\.com\/embed\/([^?&/]+)/i)?.[1] ||
    url.match(/youtube\.com\/shorts\/([^?&/]+)/i)?.[1] ||
    ""
  );
}

/* =========================
   JAVASCRIPT ARRAY PARSING
========================= */
function findBalancedArray(source, startIndex) {
  if (!source || startIndex < 0 || source[startIndex] !== "[") {
    return "";
  }

  let quote = "";
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  let depth = 0;

  for (let i = startIndex; i < source.length; i += 1) {
    const char = source[i];
    const next = source[i + 1] || "";

    if (lineComment) {
      if (char === "\n" || char === "\r") {
        lineComment = false;
      }
      continue;
    }

    if (blockComment) {
      if (char === "*" && next === "/") {
        blockComment = false;
        i += 1;
      }
      continue;
    }

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === "/" && next === "/") {
      lineComment = true;
      i += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      blockComment = true;
      i += 1;
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "[") {
      depth += 1;
      continue;
    }

    if (char === "]") {
      depth -= 1;

      if (depth === 0) {
        return source.slice(startIndex, i + 1);
      }
    }
  }

  return "";
}

function extractVideosArraySource(html) {
  if (!html) return "";

  const decoded = decodeHtmlEntities(html);

  const assignmentPatterns = [
    /(?:const|let|var)\s+videos\s*=\s*/gi,
    /window\.videos\s*=\s*/gi,
    /options\.player_list\s*=\s*/gi,
    /(?:const|let|var)\s+list_vdoiframe\s*=\s*/gi,
    /window\.list_vdoiframe\s*=\s*/gi,
    /player_list\s*:\s*/gi
  ];

  for (const pattern of assignmentPatterns) {
    pattern.lastIndex = 0;

    let match;

    while ((match = pattern.exec(decoded)) !== null) {
      const bracketIndex = decoded.indexOf("[", pattern.lastIndex);

      if (bracketIndex < 0) continue;

      const between = decoded.slice(pattern.lastIndex, bracketIndex);
      if (between.length > 100 || /[;{}]/.test(between)) continue;

      const arraySource = findBalancedArray(decoded, bracketIndex);
      if (arraySource) return arraySource;
    }
  }

  return "";
}

function splitJavaScriptObjects(arraySource) {
  if (!arraySource) return [];

  const objects = [];
  let quote = "";
  let escaped = false;
  let depth = 0;
  let start = -1;

  for (let i = 0; i < arraySource.length; i += 1) {
    const char = arraySource[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (quote) {
      if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }

    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }

    if (char === "{") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }

    if (char === "}") {
      depth -= 1;

      if (depth === 0 && start >= 0) {
        objects.push(arraySource.slice(start, i + 1));
        start = -1;
      }
    }
  }

  return objects;
}

function decodeJavaScriptString(value, quote = '"') {
  if (value == null) return "";

  let result = String(value)
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\x([0-9a-f]{2})/gi, (_, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    )
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\\//g, "/")
    .replace(/\\\\/g, "\\");

  if (quote === '"') {
    result = result.replace(/\\"/g, '"');
  } else if (quote === "'") {
    result = result.replace(/\\'/g, "'");
  }

  return result;
}

function readObjectStringProperty(objectText, propertyName) {
  const escapedName = propertyName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pattern = new RegExp(
    `(?:^|[,\\s{])["']?${escapedName}["']?\\s*:\\s*(["'\`])([\\s\\S]*?)\\1`,
    "i"
  );

  const match = objectText.match(pattern);
  if (!match) return "";

  return decodeJavaScriptString(match[2], match[1]);
}

function parseVideosArray(html, pageUrl = BASE_URL) {
  try {
    const arraySource = extractVideosArraySource(html);

    if (!arraySource) {
      return [];
    }

    const objectSources = splitJavaScriptObjects(arraySource);

    const videos = objectSources
      .map((objectText, index) => {
        const rawTitle =
          readObjectStringProperty(objectText, "title") ||
          readObjectStringProperty(objectText, "label") ||
          readObjectStringProperty(objectText, "name");

        const rawFile =
          readObjectStringProperty(objectText, "file") ||
          readObjectStringProperty(objectText, "url") ||
          readObjectStringProperty(objectText, "src");

        const file = normalizeVideoUrl(rawFile, pageUrl);
        if (!file) return null;

        return {
          title: normalizeEpisodeTitle(rawTitle, index),
          file
        };
      })
      .filter(Boolean);

    const seen = new Set();
    const uniqueVideos = videos.filter((video) => {
      if (seen.has(video.file)) return false;
      seen.add(video.file);
      return true;
    });

    return uniqueVideos;
  } catch {
    return [];
  }
}

/* =========================
   PAGE DETAIL
========================= */
function extractPageTitle($) {
  return (
    cleanTitle($("h1.entry-title").first().text()) ||
    cleanTitle($('meta[property="og:title"]').attr("content")) ||
    cleanTitle($('meta[name="twitter:title"]').attr("content")) ||
    cleanTitle($("title").text())
  );
}

function extractPagePoster($) {
  const poster =
    $('meta[property="og:image"]').attr("content") ||
    $('meta[name="twitter:image"]').attr("content") ||
    $('meta[itemprop="image"]').attr("content") ||
    $("#my-poster img").first().attr("data-src") ||
    $("#my-poster img").first().attr("src") ||
    $(".post-body img").first().attr("data-src") ||
    $(".post-body img").first().attr("src") ||
    "";

  return normalizeTheKomsanPoster(poster);
}

async function getPageDetail(url) {
  try {
    const { data } = await axiosClient.get(url, {
      headers: {
        ...PAGE_HEADERS,
        Referer: BASE_URL
      }
    });

    const $ = cheerio.load(data);
    const title = extractPageTitle($);
    const thumbnail = extractPagePoster($);
    const videos = parseVideosArray(data, url);

    if (!videos.length) {
      return null;
    }

    return {
      title,
      thumbnail,
      videos
    };
  } catch {
    return null;
  }
}

/* =========================
   CATALOG HELPERS
========================= */
function findCatalogPosts($) {
  const selectors = [
    "div.blog-posts div.grid-posts article.blog-post",
    "div.grid-posts article.blog-post",
    "article.blog-post",
    ".grid-posts .post-filter",
    "article.hentry"
  ];

  for (const selector of selectors) {
    const posts = $(selector).toArray();
    if (posts.length) return posts;
  }

  return [];
}

function extractCatalogLink($post, pageUrl) {
  const href =
    $post.find("h2.entry-title a").first().attr("href") ||
    $post.find("h3.entry-title a").first().attr("href") ||
    $post.find("a.post-filter-link").first().attr("href") ||
    $post.find("a[href]").first().attr("href") ||
    "";

  return absolutizeUrl(href, pageUrl);
}

function extractCatalogTitle($post) {
  const titleLink =
    $post.find("h2.entry-title a").first().length
      ? $post.find("h2.entry-title a").first()
      : $post.find("a.post-filter-link").first();

  return (
    cleanTitle(titleLink.attr("title")) ||
    cleanTitle($post.find("h2.entry-title").first().text()) ||
    cleanTitle($post.find("h3.entry-title").first().text()) ||
    cleanTitle(titleLink.text()) ||
    cleanTitle($post.find("img").first().attr("alt"))
  );
}

function extractCatalogPoster($post) {
  const image = $post.find("img.snip-thumbnail, img").first();

  return normalizeTheKomsanPoster(
    image.attr("data-src") ||
    image.attr("data-original") ||
    image.attr("data-lazy-src") ||
    image.attr("src") ||
    ""
  );
}

/* =========================
   PAGINATION
========================= */
function getNextPageUrl(base, html) {
  try {
    const $ = cheerio.load(html);

    const dataLoad =
      $("#load-more-link").first().attr("data-load") ||
      $("a.blog-pager-older-link[data-load]").first().attr("data-load") ||
      "";

    if (dataLoad) {
      return absolutizeUrl(dataLoad, base || BASE_URL);
    }

    const href =
      $("#Blog1_blog-pager-older-link").attr("href") ||
      $("a.blog-pager-older-link").first().attr("href") ||
      $("#blog-pager-older-link").attr("href") ||
      "";

    if (href && !/^javascript:/i.test(href) && href !== "#") {
      return absolutizeUrl(href, base || BASE_URL);
    }

    return null;
  } catch {
    return null;
  }
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, initialUrl, skip = 0) {
  try {
    if (!initialUrl) return [];

    const pageSize = Number(siteConfig.pageSize || 20);
    const pageNumber = Math.floor(Number(skip || 0) / pageSize);

    let pageUrl = initialUrl;
    let html = "";

    for (let page = 0; page <= pageNumber; page += 1) {
      const response = await axiosClient.get(pageUrl, {
        headers: {
          ...PAGE_HEADERS,
          Referer: siteConfig.baseUrl || BASE_URL
        }
      });

      html = response.data;

      if (page < pageNumber) {
        const nextUrl = getNextPageUrl(pageUrl, html);

        if (!nextUrl || nextUrl === pageUrl) {
          return [];
        }

        pageUrl = nextUrl;
      }
    }

    const $ = cheerio.load(html);
    const posts = findCatalogPosts($);

    const results = posts.map((post) => {
      const $post = $(post);
      const title = extractCatalogTitle($post);
      const link = extractCatalogLink($post, pageUrl);

      if (!title || !link) return null;

      return {
        id: `${prefix}:${encodeURIComponent(link)}`,
        name: title,
        poster: extractCatalogPoster($post)
      };
    });

    return uniqById(results.filter(Boolean));
  } catch {
    return [];
  }
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  try {
    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return [];

    return detail.videos.map((video, index) => ({
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
      title: video.title || `Episode ${index + 1}`,
      seriesTitle: detail.title,
      season: 1,
      episode: index + 1,
      thumbnail: detail.thumbnail || "",
      released: new Date().toISOString()
    }));
  } catch {
    return [];
  }
}

/* =========================
   STREAM HELPERS
========================= */
async function resolveStreamUrl(inputUrl, seriesUrl) {
  let url = normalizeVideoUrl(inputUrl, seriesUrl);
  if (!url) return "";

  if (/player\.php/i.test(url)) {
    const resolved = await resolvePlayerUrl(url);

    if (resolved) {
      url = normalizeVideoUrl(resolved, seriesUrl);
    }
  }

  if (/ok\.ru\/videoembed\//i.test(url)) {
    const cleaned = url
      .replace(/([?&])autoplay=1(?:&|$)/gi, "$1")
      .replace(/[?&]$/, "");

    const resolved = await resolveOkEmbed(cleaned);
    url = normalizeVideoUrl(resolved || cleaned, seriesUrl);
  }

  return url;
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  try {
    const episodeNumber = Number.parseInt(episode, 10);

    if (!Number.isFinite(episodeNumber) || episodeNumber < 1) {
      return null;
    }

    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return null;

    const video = detail.videos[episodeNumber - 1];
    if (!video?.file) return null;

    let url = normalizeVideoUrl(video.file, seriesUrl);
    if (!url) return null;

    if (/youtu\.be|youtube\.com/i.test(url)) {
      const ytId = extractYouTubeId(url);
      if (!ytId) return null;

      return {
        ytId,
        name: SITE_NAME,
        title: video.title || `Episode ${episodeNumber} (YouTube)`,
        behaviorHints: {
          group: SITE_ID
        }
      };
    }

    url = await resolveStreamUrl(url, seriesUrl);
    if (!url) return null;

    return buildStream(
      url,
      episodeNumber,
      video.title || `Episode ${episodeNumber}`,
      SITE_NAME,
      SITE_ID,
      seriesUrl
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
