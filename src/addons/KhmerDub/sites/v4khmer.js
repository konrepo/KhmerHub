const axios = require("axios");
const cheerio = require("cheerio");

const UA_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const UA_MOB =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36";

const BASE = "https://video4khmer.cam/";

function cleanTitle(title) {
  return (title || "")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function absUrl(url) {
  if (!url) return "";
  try {
    return new URL(url, BASE).toString();
  } catch {
    return url;
  }
}

function extractPlayerList(html = "") {
  const listMatch = html.match(/options\.player_list\s*=\s*\[([\s\S]*?)\]\s*;?/i);
  if (!listMatch?.[1]) return [];

  const raw = listMatch[1];
  const items = [];
  const re =
    /\{\s*['"]?file['"]?\s*:\s*['"]([^'"]+)['"]\s*,\s*['"]?title['"]?\s*:\s*['"]([^'"]*)['"]/gi;

  let m;
  while ((m = re.exec(raw)) !== null) {
    items.push({
      file: m[1].trim(),
      title: cleanTitle(m[2])
    });
  }

  return items;
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    const finalUrl = url || siteConfig.baseUrl || BASE;

    const { data } = await axios.get(finalUrl, {
      headers: { "User-Agent": UA_WIN, Referer: BASE },
      timeout: 15000
    });

    const $ = cheerio.load(data);
    const items = [];

    $("a.box1[href]").each((_, el) => {
      const link = absUrl($(el).attr("href"));
      const title =
        cleanTitle($(el).attr("aria-label")) ||
        cleanTitle($(el).find("h2").first().text());

      const poster = absUrl(
        $(el).find("img.thumnail").attr("src") ||
        $(el).find("img").first().attr("src") ||
        ""
      );

      if (!link || !title) return;

      items.push({
        id: `${prefix}:${encodeURIComponent(link)}`,
        name: title,
        poster,
        background: poster
      });
    });

    return items;
  } catch (err) {
    console.error("v4khmer catalog error:", err.message);
    return [];
  }
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  try {
    const { data } = await axios.get(seriesUrl, {
      headers: { "User-Agent": UA_MOB, Referer: BASE },
      timeout: 15000
    });

    const $ = cheerio.load(data);

    const pageTitle =
      cleanTitle($(".viewer .dt h3").first().text().replace(/^.*Video Title:\s*/i, "")) ||
      cleanTitle($("h1").first().text()) ||
      cleanTitle($("title").text()) ||
      seriesUrl;

    const poster = absUrl(
      $("meta[property='og:image']").attr("content") ||
      $(".content-right img").first().attr("src") ||
      ""
    );

    const players = extractPlayerList(String(data || ""));
    if (!players.length) return [];

    return players.map((item, index) => ({
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
      title: item.title || `Episode ${String(index + 1).padStart(2, "0")}`,
      seriesTitle: pageTitle,
      season: 1,
      episode: index + 1,
      thumbnail: poster,
      released: new Date().toISOString()
    }));
  } catch (err) {
    console.error("v4khmer episodes error:", err.message);
    return [];
  }
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  try {
    const { data } = await axios.get(seriesUrl, {
      headers: { "User-Agent": UA_MOB, Referer: BASE },
      timeout: 15000
    });

    const players = extractPlayerList(String(data || ""));
    const target = players[episode - 1];

    if (!target?.file) return null;

    const url = target.file.trim();

    return {
      name: "Video4Khmer",
      title: target.title || `Episode ${String(episode).padStart(2, "0")}`,
      url,
      behaviorHints: {
        group: prefix || "v4khmer",
        notWebReady: true
      }
    };
  } catch (err) {
    console.error("v4khmer stream error:", err.message);
    return null;
  }
}

function getNextPageUrl(base, html) {
  const $ = cheerio.load(html);

  const next =
    $("ul.pagination a")
      .filter((_, el) => /next/i.test($(el).text()))
      .first()
      .attr("href") ||
    "";

  return next ? absUrl(next) : null;
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
  getNextPageUrl
};
