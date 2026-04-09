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
const PAGE_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36"
};

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

  let t = title.trim();

  // EP 1 → Episode 1
  t = t.replace(/^EP\s*/i, "Episode ");

  // EP30 → Episode 30
  t = t.replace(/^Episode\s*(\d+)E$/i, "Episode $1 End");

  // EP 30E → Episode 30 End
  t = t.replace(/^Episode\s*(\d+)\s*E$/i, "Episode $1 End");

  return t;
}

function normalizeVideoUrl(url, baseUrl = "") {
  if (!url) return "";

  let u = String(url).trim();

  if (u.startsWith("//")) {
    u = "https:" + u;
  } else if (u.startsWith("/")) {
    u = absolutizeUrl(u, baseUrl || "https://www.phumikhmer1.club");
  }

  return u;
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
    let match =
      html.match(/options\.player_list\s*=\s*(\[[\s\S]*?\])\s*;/i) ||
      html.match(/const\s+videos\s*=\s*(\[[\s\S]*?\]);\s*<\/script>/i) ||
      html.match(/const\s+videos\s*=\s*(\[[\s\S]*?\]);/i);

    if (!match || !match[1]) return [];

    let raw = match[1].trim();

    raw = raw
      .replace(/([{,]\s*)([A-Za-z0-9_]+)\s*:/g, '$1"$2":')
      .replace(/'/g, '"')
      .replace(/,\s*]/g, "]")
      .replace(/,\s*}/g, "}");

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];

    return parsed
      .map((item, index) => ({
        title: normalizeEpisodeTitle(item.title, index),
        file: normalizeVideoUrl(item.file)
      }))
      .filter((item) => item.file);
  } catch (err) {
    console.log("[phumi2] parseVideosArray failed:", err.message);
    return [];
  }
}

async function getPageDetail(url) {
  try {
    const { data } = await axiosClient.get(url, {
      headers: {
        ...PAGE_HEADERS,
        Referer: url
      }
    });

    const $ = cheerio.load(data);

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

    const videos = parseVideosArray(data);
    if (!videos.length) return null;

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
        id: `${prefix}:${encodeURIComponent(link)}`,
        name: title,
        poster
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

    return detail.videos.map((v, index) => ({
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
      title: detail.title || v.title || `Episode ${index + 1}`,
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
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  try {
    const detail = await getPageDetail(seriesUrl);
    if (!detail?.videos?.length) return null;

    const v = detail.videos[episode - 1];
    if (!v?.file) return null;

    let url = normalizeVideoUrl(v.file, seriesUrl);

    if (url.includes("player.php")) {
      const resolved = await resolvePlayerUrl(url);
      if (!resolved) return null;
      url = resolved;
    }

    if (url.includes("ok.ru/videoembed/")) {
      const cleaned = url.replace(/[?&]autoplay=1\b/g, "").replace(/\?$/, "");
      const resolved = await resolveOkEmbed(cleaned);
      url = resolved || cleaned;
    }

    return buildStream(url, episode, v.title, "PhumiClub", "phumi2");
  } catch (err) {
    console.log("[phumi2] getStream failed:", err.message);
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};

