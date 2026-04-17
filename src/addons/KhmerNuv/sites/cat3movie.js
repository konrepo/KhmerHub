const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");

const { normalizePoster, uniqById } = require("../utils/helpers");
const { buildStream } = require("../utils/streamResolvers");

const DEBUG = false;
const log = (...args) => DEBUG && log(...args);

/* =========================
   CONFIG
========================= */
const BASE_URL = "https://www.cat3movie.club";

const HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Mobile Safari/537.36"
};

/* =========================
   HELPERS
========================= */
function absolutize(url, base = BASE_URL) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function cleanTitle(text) {
  return (text || "").replace(/\s+/g, " ").trim();
}

function cleanMovieTitle(title) {
  return cleanTitle(title)
    .replace(/\|\s*Free Sexy Movies.*$/i, "")
    .replace(/\|\s*Full\s+.*$/i, "")
    .replace(/\bFull\s+.*Movie.*$/i, "")
    .replace(/\bOnline\s+Free.*$/i, "")
    .trim();
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function isDirectVideoUrl(url = "") {
  return (
    /^https?:\/\//i.test(url) &&
    (/\.(mp4|m3u8)(\?|$)/i.test(url) ||
      /\/video\//i.test(url) ||
      /master\.m3u8/i.test(url))
  );
}

function isLikelyPlayableHost(url = "") {
  return (
    /play\.cat3movie\.club\/embed\//i.test(url) ||
    /playhydrax\.com/i.test(url) ||
    /hydrax/i.test(url) ||
    /ok\.ru\/videoembed\//i.test(url) ||
    isDirectVideoUrl(url)
  );
}

async function resolveCat3Embed(embedUrl) {
  try {
    const { data } = await axiosClient.get(embedUrl, {
      headers: {
        ...HEADERS,
        Referer: embedUrl
      }
    });

    const html = String(data || "")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const directSources = extractSources(html);
    if (directSources.length) {
      return uniq(directSources);
    }

    const apiMatch =
      html.match(/url\s*:\s*"([^"]*\/api\/\?[^"]+)"/i) ||
      html.match(/url\s*:\s*'([^']*\/api\/\?[^']+)'/i) ||
      html.match(/["'](https?:\/\/[^"']*\/api\/\?[^"']+)["']/i);

    if (!apiMatch || !apiMatch[1]) {
      return [];
    }

    const apiUrl = apiMatch[1].replace(/\\\//g, "/");

    const { data: apiRes } = await axiosClient.get(apiUrl, {
      headers: {
        ...HEADERS,
        Referer: embedUrl,
        Origin: "https://play.cat3movie.club",
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    const rawSources =
      apiRes?.sources ||
      apiRes?.data?.sources ||
      [];

    const sources = Array.isArray(rawSources)
      ? rawSources
          .map((s) => {
            if (typeof s === "string") return s;
            return s?.file || s?.src || s?.url || "";
          })
          .filter(Boolean)
      : [];

    return uniq(sources);
  } catch {
    return [];
  }
}

/* =========================
   JWPLAYER PARSER
========================= */
function extractSources(html) {
  const text = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const matches = [
    ...text.matchAll(/file\s*:\s*["']([^"']+)["']/gi),
    ...text.matchAll(/src\s*:\s*["']([^"']+)["']/gi),
    ...text.matchAll(/["'](https?:\/\/[^"']+\.m3u8[^"']*)["']/gi),
    ...text.matchAll(/["'](https?:\/\/[^"']+\.mp4[^"']*)["']/gi)
  ];

  const sources = matches
    .map((m) => String(m[1] || "").trim())
    .filter((url) => url && url !== "#" && isDirectVideoUrl(url));

  return uniq(sources);
}

function extractServerLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  $("iframe").each((_, el) => {
    const src = $(el).attr("src") || $(el).attr("data-src");
    if (src) links.push(absolutize(src, pageUrl));
  });

  $("a, button, div").each((_, el) => {
    const attrs = ["href", "data-src", "data-link", "data-url", "data-embed"];
    for (const attr of attrs) {
      const val = $(el).attr(attr);
      if (val && /^(https?:)?\/\//i.test(val)) {
        links.push(absolutize(val, pageUrl));
      }
    }
  });

  const regexLinks = [...String(html || "").matchAll(/https?:\/\/[^"'<> ]+/gi)].map(
    (m) => m[0]
  );

  links.push(...regexLinks);

  return uniq(
    links.filter(
      (link) =>
        link &&
        !/google|facebook|twitter|instagram|pinterest|doubleclick|schema\.org/i.test(
          link
        )
    )
  );
}

/* =========================
   DETAIL
========================= */
async function getDetail(url) {
  try {
    const { data } = await axiosClient.get(url, {
      headers: {
        ...HEADERS,
        Referer: BASE_URL + "/"
      }
    });

    const $ = cheerio.load(data);

    const title = cleanMovieTitle(
      $("h1.single-post-title").text() ||
        $('meta[property="og:title"]').attr("content") ||
        $("title").text()
    );

    let poster =
      $('meta[property="og:image"]').attr("content") ||
      $('meta[name="twitter:image"]').attr("content") ||
      "";

    poster = normalizePoster(absolutize(poster, url));

    const category =
      $('nav[aria-label="Breadcrumbs"] .bf-breadcrumb-item a').last().text().trim() ||
      $(".term-badges.floated .term-badge a").first().text().trim() ||
      "";

    const sources = extractSources(data);

    return {
      title,
      poster,
      category,
      sources
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
    const pageUrl = url || BASE_URL;

    const { data } = await axiosClient.get(pageUrl, {
      headers: {
        ...HEADERS,
        Referer: BASE_URL + "/"
      }
    });

    const $ = cheerio.load(data);

    const posts = $("article[class*='listing-item']").toArray();

    const results = posts.map((el) => {
      const $el = $(el);

      const linkEl = $el.find("h2.title a").first();

      const link = absolutize(linkEl.attr("href"), pageUrl);
      const title = cleanMovieTitle(linkEl.attr("title") || linkEl.text());

      if (!link || !title) return null;

      let poster =
        $el.find("a.img-holder").attr("data-src") ||
        $el.find("a.img-holder").attr("src") ||
        $el.find("img").attr("data-src") ||
        $el.find("img").attr("src");

      poster = normalizePoster(absolutize(poster, pageUrl));

      const category = $el
        .find(".featured .term-badges .term-badge a")
        .first()
        .text()
        .trim();

      return {
        id: `${prefix}:${encodeURIComponent(link)}`,
        name: category ? `[${category}] ${title}` : title,
        poster,
        genres: category ? [category] : []
      };
    });

    return uniqById(results.filter(Boolean));
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
    $("a.next.page-numbers").attr("href") ||
    $('a[rel="next"]').attr("href");

  return next ? absolutize(next, base) : null;
}

/* =========================
   EPISODES (single movie)
========================= */
async function getEpisodes(prefix, url) {
  const detail = await getDetail(url);

  log("[CAT3] getEpisodes", {
    prefix,
    url,
    hasDetail: !!detail,
    title: detail?.title
  });

  if (!detail) return [];

  const episode = {
    id: `${prefix}:${encodeURIComponent(url)}`,
    title: detail.category ? `[${detail.category}] ${detail.title}` : detail.title,
    season: 1,
    episode: 1,
    thumbnail: detail.poster,
    description: detail.category ? `Category: ${detail.category}` : "",
    genres: detail.category ? [detail.category] : []
  };

  log("[CAT3] getEpisodes return", episode);

  return [episode];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, url, epNum = 1) {
  try {
    log("[CAT3] getStream start", { url, epNum });

    const detail = await getDetail(url);
    log("[CAT3] detail", {
      hasDetail: !!detail,
      sources: detail?.sources?.length || 0,
      title: detail?.title,
      sample: detail?.sources?.slice(0, 5) || []
    });

    // Fast path: direct JWPlayer sources already found on page
    if (detail?.sources?.length) {
      log("[CAT3] using direct detail.sources");

      return uniq(detail.sources).map((src, index) =>
        buildStream(
          src,
          epNum,
          detail?.title || "Cat3Movie",
          detail.sources.length > 1 ? `Server ${index + 1}` : "Cat3Movie",
          "cat3",
          url
        )
      );
    }

    const { data } = await axiosClient.get(url, {
      headers: {
        ...HEADERS,
        Referer: BASE_URL + "/"
      }
    });
    log("[CAT3] page fetched");

    const serverLinks = extractServerLinks(data, url);
    log("[CAT3] serverLinks", {
      count: serverLinks.length,
      sample: serverLinks.slice(0, 5)
    });

    const finalSources = [];

    for (const serverUrl of serverLinks) {
      log("[CAT3] processing", serverUrl);

      if (!serverUrl) continue;

      if (isDirectVideoUrl(serverUrl)) {
        finalSources.push(serverUrl);
        continue;
      }

      if (/play\.cat3movie\.club\/embed\//i.test(serverUrl)) {
        const embedSources = await resolveCat3Embed(serverUrl);
        log("[CAT3] embedSources", {
          serverUrl,
          count: embedSources.length,
          sample: embedSources.slice(0, 5)
        });
        finalSources.push(...embedSources);
        continue;
      }

      if (/playhydrax\.com|hydrax|ok\.ru\/videoembed\//i.test(serverUrl)) {
        finalSources.push(serverUrl);
        continue;
      }
    }

    log("[CAT3] finalSources BEFORE uniq", {
      count: finalSources.length,
      sample: finalSources.slice(0, 10)
    });

    const uniqueSources = uniq(finalSources);

    log("[CAT3] finalSources AFTER uniq", {
      count: uniqueSources.length,
      sample: uniqueSources.slice(0, 10)
    });

    if (!uniqueSources.length) {
      log("[CAT3] NO STREAM FOUND");
      return null;
    }

    log("[CAT3] returning fallback streams", uniqueSources.length);

    return [buildStream(
      uniqueSources[0],
      epNum,
      detail?.title || "Cat3Movie",
      "Cat3Movie",
      "cat3",
      url
    )];
  } catch (e) {
    log("[CAT3] getStream ERROR", e?.message || String(e));
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};