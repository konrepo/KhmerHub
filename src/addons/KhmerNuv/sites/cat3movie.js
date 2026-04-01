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
    "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Mobile Safari/537.36",
  Referer: `${BASE_URL}/`
};

/* =========================
   HELPERS
========================= */
function absolutize(url, base = BASE_URL) {
  try {
    return new URL(url, base).toString();
  } catch {
    return url || "";
  }
}

function cleanTitle(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
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
  return [...new Set((arr || []).filter(Boolean))];
}

function extractSources(html = "") {
  const sources = [
    ...html.matchAll(/file\s*:\s*["']([^"']+)["']/gi),
    ...html.matchAll(/src\s*:\s*["']([^"']+)["']/gi)
  ]
    .map((m) => String(m[1] || "").trim())
    .filter((url) => {
      return (
        url &&
        url !== "#" &&
        /^https?:\/\//i.test(url) &&
        (/\.(m3u8|mp4)(\?|$)/i.test(url) || /\/video\//i.test(url))
      );
    });

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

  $("iframe").each((_, el) => {
    const src = $(el).attr("src");
    if (src) links.push(absolutize(src, pageUrl));
  });

  return uniq(links);
}

function pickBestSource(sources = []) {
  if (!sources.length) return null;

  const cleaned = uniq(
    sources.map((s) => String(s || "").trim()).filter(Boolean)
  );

  return (
    cleaned.find((s) => /\.m3u8(\?|$)/i.test(s)) ||
    cleaned.find((s) => /\.mp4(\?|$)/i.test(s)) ||
    cleaned.find((s) => /playhydrax\.com/i.test(s)) ||
    cleaned[0] ||
    null
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

    const apiMatch =
      data.match(/url\s*:\s*"([^"]*\/api\/\?[^"]+)"/i) ||
      data.match(/url\s*:\s*'([^']*\/api\/\?[^']+)'/i);

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

    const rawSources = apiRes?.sources || apiRes?.data?.sources || [];

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
   DETAIL
========================= */
async function getDetail(url) {
  try {
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
      $('nav[aria-label="Breadcrumbs"] .bf-breadcrumb-item a').last().text().trim() ||
      $(".term-badges.floated .term-badge a").first().text().trim() ||
      "";

    const sources = extractSources(data);
    const serverLinks = extractServerLinks(data, url);

    return {
      title,
      poster,
      category,
      sources,
      serverLinks
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

    const results = posts
      .map((el) => {
        const $el = $(el);
        const linkEl = $el.find("h2.title a").first();

        const link = absolutize(linkEl.attr("href"), pageUrl);
        const title = cleanMovieTitle(linkEl.attr("title") || linkEl.text());

        if (!link || !title) return null;

        let poster =
          $el.find("a.img-holder").attr("data-src") ||
          $el.find("a.img-holder").attr("src") ||
          $el.find("img").attr("data-src") ||
          $el.find("img").attr("src") ||
          "";

        poster = normalizePoster(absolutize(poster, pageUrl));

        const category = $el
          .find(".featured .term-badges .term-badge a")
          .first()
          .text()
          .trim();

        return {
          id: link,
          name: category ? `[${category}] ${title}` : title,
          poster,
          genres: category ? [category] : []
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
    $("a.next.page-numbers").attr("href") ||
    $('a[rel="next"]').attr("href");

  return next ? absolutize(next, base) : null;
}

/* =========================
   EPISODES (single movie)
========================= */
async function getEpisodes(prefix, seriesUrl) {
  const detail = await getDetail(seriesUrl);
  if (!detail) return [];

  return [
    {
      id: 1,
      url: seriesUrl,
      title: detail.category ? `[${detail.category}] ${detail.title}` : detail.title,
      season: 1,
      episode: 1,
      thumbnail: detail.poster,
      released: new Date().toISOString(),
      description: detail.category ? `Category: ${detail.category}` : "",
      behaviorHints: {
        group: `${prefix}:${encodeURIComponent(seriesUrl)}`
      }
    }
  ];
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, episodeUrl, episode = 1) {
  try {
    if (!episodeUrl) return null;

    const detail = await getDetail(episodeUrl);
    if (!detail) return null;

    const finalSources = [...(detail.sources || [])];

    for (const serverUrl of detail.serverLinks || []) {
      if (!serverUrl) continue;

      if (/\.(m3u8|mp4)(\?|$)/i.test(serverUrl)) {
        finalSources.push(serverUrl);
        continue;
      }

      if (
	    /play\.cat3movie\.club\/embed\//i.test(serverUrl) ||
        /cat3movie\.club\/embed\//i.test(serverUrl)
      ) {
	    const embedSources = await resolveCat3Embed(serverUrl);
		finalSources.push(...embedSources);
        continue;
      }

      if (/playhydrax\.com/i.test(serverUrl)) {
        finalSources.push(serverUrl);
      }
    }

    const source = pickBestSource(finalSources);
    if (!source) return null;

    return buildStream(
      source,
      episode,
      detail.title || "Cat3Movie",
      "Cat3Movie",
      "cat3movie"
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