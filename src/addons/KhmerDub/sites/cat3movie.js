const cheerio = require("cheerio");
const axiosClient = require("../utils/fetch");

const { normalizePoster, uniqById } = require("../utils/helpers");
const { buildStream } = require("../utils/streamResolvers");

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
    if (!url) return "";
    return new URL(url, base).toString();
  } catch {
    return url;
  }
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
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

function normalizeStreamSource(src) {
  if (!src) return null;

  if (typeof src === "string") {
    return {
      url: src.trim()
    };
  }

  if (src.url) {
    return {
      url: String(src.url).trim(),
      subtitle: src.subtitle,
      language: src.language
    };
  }

  return null;
}

function uniqStreamSources(items) {
  const seen = new Set();
  const out = [];

  for (const item of items) {
    const src = normalizeStreamSource(item);
    if (!src?.url) continue;
    if (seen.has(src.url)) continue;

    seen.add(src.url);
    out.push(src);
  }

  return out;
}

async function resolveCat3Embed(embedUrl) {
  try {
    embedUrl = safeDecode(embedUrl);

    const { data } = await axiosClient.get(embedUrl, {
      headers: {
        ...HEADERS,
        Referer: embedUrl
      }
    });

    let html = String(data || "")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const direct = [
      ...html.matchAll(/https?:\/\/[^"'<> ]+\.(?:m3u8|mp4)(?:\?[^"'<> ]*)?/gi)
    ].map(m => m[0]);

    if (direct.length) return uniq(direct);

    const apiMatch =
      html.match(/url\s*:\s*"([^"]*\/api\/\?[^"]+)"/i) ||
      html.match(/url\s*:\s*'([^']*\/api\/\?[^']+)'/i);

    if (!apiMatch?.[1]) return [];

    const apiUrl = absolutize(apiMatch[1], embedUrl);

    const { data: apiRes } = await axiosClient.get(apiUrl, {
      headers: {
        ...HEADERS,
        Referer: embedUrl,
        Origin: new URL(embedUrl).origin,
        Accept: "application/json, text/plain, */*",
        "X-Requested-With": "XMLHttpRequest"
      }
    });

    const rawSources =
      apiRes?.sources ||
      apiRes?.data?.sources ||
      apiRes?.result?.sources ||
      [];

    const sources = Array.isArray(rawSources)
      ? rawSources
          .map(s => {
            if (typeof s === "string") return s;
            return s?.file || s?.src || s?.url || "";
          })
          .filter(Boolean)
      : [];

    return uniq(sources);
  } catch (e) {
    console.log("[cat3] embed error:", e.message);
    return [];
  }
}

async function resolveVivamaxMovie(movieUrl) {
  try {
    movieUrl = safeDecode(movieUrl);

    const slug = movieUrl
      .replace(/\/$/, "")
      .split("/")
      .pop();

    if (!slug) return [];

    const apiUrl =
      `https://vivamax.cam/api/movies.php?find_slug=${encodeURIComponent(slug)}&paginated=1`;

    console.log("[cat3] vivamax api:", apiUrl);

    const { data } = await axiosClient.get(apiUrl, {
      headers: {
        ...HEADERS,
        Referer: "https://vivamax.cam/",
        Origin: "https://vivamax.cam",
        Accept: "application/json, text/plain, */*"
      }
    });

    const movie = data?.data?.[0];

    if (!movie) {
      console.log("[cat3] vivamax no movie:", slug);
      return [];
    }

    let servers = movie.servers;

    if (typeof servers === "string") {
      servers = JSON.parse(servers);
    }

    const sources = [];

    for (const server of servers || []) {
      for (const ep of server.episodes || []) {
        if (!ep.url) continue;

        const [videoUrl, language, subtitleUrl] = String(ep.url).split("|");

        if (videoUrl) {
          sources.push({
            url: videoUrl.trim(),
            subtitle: subtitleUrl?.trim(),
            language: language || "English"
          });
        }
      }
    }

    console.log("[cat3] vivamax sources:", sources.length);

    return sources;
  } catch (e) {
    console.log("[cat3] vivamax error:", e.message);
    return [];
  }
}

/* =========================
   JWPLAYER PARSER
========================= */
function extractSources(html) {
  const sources = [
    ...String(html || "").matchAll(/file\s*:\s*["']([^"']+)["']/gi)
  ]
    .map(m => String(m[1] || "").trim())
    .filter(url =>
      url &&
      url !== "#" &&
      /^https?:\/\//i.test(url) &&
      (
        /\.(mp4|m3u8)(\?|$)/i.test(url) ||
        /[?&]type=\.(?:mp4|m3u8)(?:&|$)/i.test(url) ||
        /\/video\//i.test(url)
      )
    );

  return uniq(sources);
}

function extractServerLinks(html, pageUrl) {
  const $ = cheerio.load(html);
  const links = [];

  const iframeSrc = $("#movie-player iframe").attr("src");
  if (iframeSrc) links.push(absolutize(iframeSrc, pageUrl));

  $("#server-list a").each((_, el) => {
    const href = $(el).attr("href");
    if (href) links.push(absolutize(href, pageUrl));
  });

  return uniq(links);
}

/* =========================
   DETAIL
========================= */
async function getDetail(url) {
  try {
    url = safeDecode(url);

    const { data } = await axiosClient.get(url, {
      headers: HEADERS
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
      $('nav[aria-label="Breadcrumbs"] .bf-breadcrumb-item a')
        .last()
        .text()
        .trim() ||
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
      headers: HEADERS
    });

    const $ = cheerio.load(data);

    const posts = $("article[class*='listing-item']").toArray();

    const results = posts.map(el => {
      const $el = $(el);

      const linkEl = $el.find("h2.title a").first();

      const link = absolutize(linkEl.attr("href"), pageUrl);
      const title = cleanMovieTitle(
        linkEl.attr("title") || linkEl.text()
      );

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
   EPISODES
========================= */
async function getEpisodes(prefix, url) {
  url = safeDecode(url);

  const detail = await getDetail(url);

  if (!detail) return [];

  return [
    {
      id: `${prefix}:${encodeURIComponent(url)}`,
      title: detail.category ? `[${detail.category}] ${detail.title}` : detail.title,
      season: 1,
      episode: 1,
      thumbnail: detail.poster,
      description: detail.category ? `Category: ${detail.category}` : ""
    }
  ];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, url, epNum = 1) {
  try {
    url = safeDecode(url);

    const res = await axiosClient.get(url, {
      headers: HEADERS,
      maxRedirects: 5
    });

    const data = res.data;

    const finalPageUrl = safeDecode(
      res.request?.res?.responseUrl ||
      res.request?.responseURL ||
      url
    );

    const detail = await getDetail(finalPageUrl);

    const serverLinks = extractServerLinks(data, finalPageUrl);

    const finalSources = [...(detail?.sources || [])];

    const vivamaxLinks = [
      ...String(data || "").matchAll(/https?:\/\/vivamax\.cam\/movies\/[^"'<> ]+/gi)
    ].map(m => m[0]);

    for (const vivamaxUrl of uniq(vivamaxLinks)) {
      const sources = await resolveVivamaxMovie(vivamaxUrl);
      finalSources.push(...sources);
    }

    if (/vivamax\.cam\/movies\//i.test(finalPageUrl)) {
      const sources = await resolveVivamaxMovie(finalPageUrl);
      finalSources.push(...sources);
    }

    for (const serverUrl of serverLinks) {
      if (/\.(m3u8|mp4)(\?|$)/i.test(serverUrl)) {
        finalSources.push(serverUrl);
        continue;
      }

      if (/vivamax\.cam\/movies\//i.test(serverUrl)) {
        const sources = await resolveVivamaxMovie(serverUrl);
        finalSources.push(...sources);
        continue;
      }

      if (
        /play\.cat3movie\.club\/embed\//i.test(serverUrl) ||
        /vivamax\.cam\/(embed|player|api)\//i.test(serverUrl)
      ) {
        const embedSources = await resolveCat3Embed(serverUrl);
        finalSources.push(...embedSources);
        continue;
      }

      if (/playhydrax\.com/i.test(serverUrl)) {
        finalSources.push(serverUrl);
        continue;
      }
    }

    if (!finalSources.length) {
      const slug = url
        .replace(/\/$/, "")
        .split("/")
        .pop();

      const fallbackSources = await resolveVivamaxMovie(
        `https://vivamax.cam/movies/${slug}`
      );

      finalSources.push(...fallbackSources);
    }

    const uniqueSources = uniqStreamSources(finalSources);

    console.log("[cat3] total sources:", uniqueSources.length);

    if (!uniqueSources.length) return null;

    return uniqueSources.map((src, index) => {
        const referer =
            /1a-1791\.com/i.test(src.url) ? "https://vivamax.cam/" :
            /nizu\.top/i.test(src.url) ? "https://www.cat3movie.club/" :
            null;

        return {
            ...buildStream(
                src.url,
                epNum,
                detail?.title || "Cat3Movie",
                uniqueSources.length > 1 ? `Server ${index + 1}` : "Cat3Movie",
                "cat3",
                referer
            ),
            subtitles: src.subtitle
                ? [
                    {
                        url: src.subtitle,
                        lang: src.language || "English"
                    }
                ]
                : undefined
        };
    });
  } catch (e) {
    console.log("[cat3] stream error:", e.message);
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};
