const axios = require("axios");
const cheerio = require("cheerio");

const UA_WIN =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";
const UA_MOB =
  "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/137 Safari/537.36";

function referer(prefix) {
  return prefix === "merlkon"
    ? "https://www.khmerdrama.com/"
    : "https://www.khmeravenue.com/";
}

function cleanTitle(title) {
  return (title || "")
    .replace(/&#8217;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}

function posterFromStyle(style) {
  const m = (style || "").match(/url\((.*?)\)/i);
  return m ? m[1].replace(/['"]/g, "") : "";
}

/* =========================
   CATALOG
========================= */
async function getCatalogItems(prefix, siteConfig, url) {
  try {
    const { data } = await axios.get(url, {
      headers: { "User-Agent": UA_WIN, Referer: referer(prefix) },
      timeout: 15000,
    });

    const $ = cheerio.load(data);
    const items = [];

    $(".card-content").each((_, el) => {
      const link = $(el).find("a").attr("href");
      const title = cleanTitle($(el).find("h3").first().text());

      const style =
        $(el).find(".card-content-image").attr("style") || "";

      const poster = posterFromStyle(style);

      if (link && title) {
        items.push({
          id: link, // raw URL (hashed later in index.js)
          name: title,
          poster,
        });
      }
    });

    return items;
  } catch (err) {
    console.error("khmerave catalog error:", err.message);
    return [];
  }
}

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  try {
    const { data } = await axios.get(seriesUrl, {
      headers: { 
        "User-Agent": prefix === "khmerave" ? UA_WIN : UA_MOB,
        Referer: referer(prefix),
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9"
      },
      timeout: 15000,
    });

    const $ = cheerio.load(data);

    const pageTitle = $("h1").first().text().trim() || seriesUrl;

    let poster = "";
    const imgDiv = $(".album-content-image");
    if (imgDiv.length) {
      poster = posterFromStyle(imgDiv.attr("style") || "");
    }

    let eps = [];

    const cleanSeries = seriesUrl.replace(/\/$/, "");
    const seriesSlug = cleanSeries.split("/").filter(Boolean).pop();

    function escapeRegExp(str) {
      return String(str).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }

    $("a[href]").each((_, el) => {
      let link = $(el).attr("href");
      if (!link) return;

      const safeLink = link.split("#")[0].split("?")[0];
      const cleanLink = safeLink.replace(/\/$/, "");

      if (!cleanLink.includes("/videos/") && cleanLink !== cleanSeries) return;
      if (safeLink.includes("?post_type=videos")) return;

      let epNumber = null;

      if (cleanLink === cleanSeries) {
        const linkText = $(el).text().replace(/\s+/g, " ").trim();
        const m = linkText.match(/episode\s*(\d+)/i);

        if (m) {
          epNumber = parseInt(m[1], 10);
        } else {
          epNumber = 1;
        }
      } else {
        const slug = cleanLink.split("/").filter(Boolean).pop() || "";

        let rest = slug.replace(
          new RegExp("^" + escapeRegExp(seriesSlug) + "-?", "i"),
          ""
        );

        let m = rest.match(/^(\d+)/);
        if (!m) m = slug.match(/-(\d+)[^-]*$/);
        if (m) epNumber = parseInt(m[1], 10);
      }

      if (!epNumber) return;

      eps.push({ link: safeLink, epNumber });
    });

    if (!eps.length) return [];

    eps = [...new Map(eps.map((e) => [e.epNumber, e])).values()];
    eps.sort((a, b) => a.epNumber - b.epNumber);

    return eps.map((e) => ({
      id: e.epNumber,
      url: e.link,
      title: pageTitle,
      season: 1,
      episode: e.epNumber,
      thumbnail: poster,
      released: new Date().toISOString(),
      behaviorHints: {
        group: `${prefix}:${encodeURIComponent(seriesUrl)}`,
      },
    }));

  } catch (err) {
    console.error("khmerave meta error:", err.message);
    return [];
  }
}

/* =========================
   STREAM HELPERS
========================= */
function normalizeOkUrl(url) {
  if (!url) return url;

  let u = url.trim();

  if (u.startsWith("//")) {
    u = "https:" + u;
  }

  return u.replace("m.ok.ru", "ok.ru");
}

function tryExtractVideoCandidateFromKhmerAvenue(html) {
  if (!html) return null;

  const b64 = html.match(/Base64\.decode\("(.+?)"\)/i);
  if (b64?.[1]) {
    try {
      const decoded = Buffer.from(b64[1], "base64").toString("utf8");
      const iframe = decoded.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframe?.[1]) return iframe[1];
    } catch {}
  }

  const patterns = [
    /['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/i,
    /<iframe[^>]*src=["']([^"']+)["']/i,
    /<source[^>]*src=["']([^"']+)["']/i,
    /playlist:\s*["']([^"']+)["']/i,
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }

  const playerListMatch = html.match(/player_list\s*=\s*(\[[\s\S]*?\]);/i);
  if (playerListMatch?.[1]) {
    try {
      const cleaned = playerListMatch[1].replace(/,\s*]/g, "]");
      const list = JSON.parse(cleaned);
      const first = Array.isArray(list) ? list[0] : null;
      if (first?.file) return first.file;
    } catch {}
  }

  const externalOk = html.match(/https?:\/\/m\.ok\.ru\/video\/\d+/i);
  if (externalOk?.[0]) return externalOk[0];

  return null;
}

async function resolveOkRuToDirect(iframeUrl, ua) {
  function getOkId(url) {
    const m =
      String(url).match(/ok\.ru\/videoembed\/(\d+)/i) ||
      String(url).match(/ok\.ru\/video\/(\d+)/i) ||
      String(url).match(/m\.ok\.ru\/video\/(\d+)/i);
    return m ? m[1] : null;
  }

  function extractDirect(html) {
    let text = String(html || "");

    text = text
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\u003d/g, "=")
      .replace(/\\u002F/gi, "/")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/");

    const patterns = [
      /"ondemandHls"\s*:\s*"([^"]+)"/i,
      /"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)"/i,
      /"hlsManifestUrl"\s*:\s*"([^"]+)"/i,
      /"master[mM]3u8Url"\s*:\s*"([^"]+)"/i,
      /"(https:[^"]+\.m3u8[^"]*)"/i,
      /(https:\/\/[^"'\\\s]+\.m3u8[^"'\\\s]*)/i,
    ];

    for (const re of patterns) {
      const m = text.match(re);
      const found = m?.[1];
      if (found) {
        return found
          .replace(/\\u0026/g, "&")
          .replace(/\\u003d/g, "=")
          .replace(/\\u002F/gi, "/")
          .replace(/\\&/g, "&")
          .replace(/\\\//g, "/")
          .replace(/&amp;/g, "&");
      }
    }

    const videoUrlMatches = [
      ...text.matchAll(/"name":"[^"]+","url":"(https:[^"]+)"/gi),
      ...text.matchAll(/"url":"(https:[^"]+)","name":"[^"]+"/gi),
      ...text.matchAll(/&quot;name&quot;:&quot;[^"]+&quot;,&quot;url&quot;:&quot;(https:[^"]+)&quot;/gi),
      ...text.matchAll(/&quot;url&quot;:&quot;(https:[^"]+)&quot;,&quot;name&quot;:&quot;[^"]+&quot;/gi)
    ];

    if (videoUrlMatches.length) {
      return videoUrlMatches[videoUrlMatches.length - 1][1]
        .replace(/\\u0026/g, "&")
        .replace(/\\u003d/g, "=")
        .replace(/\\u002F/gi, "/")
        .replace(/\\&/g, "&")
        .replace(/\\\//g, "/")
        .replace(/&amp;/g, "&");
    }

    return null;
  }

  try {
    const original = String(iframeUrl || "").trim();
    const normalized = normalizeOkUrl(original);
    const id = getOkId(original);

    const urlsToTry = [];

    if (original) urlsToTry.push(original);
    if (normalized && normalized !== original) urlsToTry.push(normalized);

    if (id) {
      urlsToTry.push(`https://ok.ru/videoembed/${id}`);
      urlsToTry.push(`https://ok.ru/video/${id}`);
      urlsToTry.push(`https://m.ok.ru/video/${id}`);
    }

    const uniqueUrls = [...new Set(urlsToTry)];

    for (const okUrl of uniqueUrls) {
      try {
        const okRes = await axios.get(okUrl, {
          headers: {
            "User-Agent": ua,
            Referer: "https://ok.ru/",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
          },
          timeout: 15000,
        });

        const direct = extractDirect(okRes.data);
        if (direct) return direct;
      } catch (err) {
        console.error("OK resolver try failed:", okUrl, err.message);
      }
    }

    return null;
  } catch (err) {
    console.error("OK resolver error:", err.message);
    return null;
  }
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, episodeUrl, episode) {
  try {
    const providerNames = {
      khmerave: "KhmerAve",
      merlkon: "Merlkon"
    };

    const providerName = providerNames[prefix] || "KhmerDub";
    const groupName = `${prefix}:${encodeURIComponent(episodeUrl)}`;

    const epRes = await axios.get(episodeUrl, {
      headers: { 
        "User-Agent": prefix === "khmerave" ? UA_WIN : UA_MOB,
        Referer: referer(prefix),
      },
      timeout: 15000,
    });

    const html = String(epRes.data || "");

    const candidate = tryExtractVideoCandidateFromKhmerAvenue(html);
    if (!candidate) return null;

    const cand = normalizeOkUrl(candidate);

    if (/ok\.ru/.test(cand)) {
      const direct = await resolveOkRuToDirect(cand, UA_MOB);
      if (!direct) return null;

      return {
        name: providerName,
        title: `Episode ${String(episode).padStart(2, "0")}`,
        url: direct,
        behaviorHints: {
          group: groupName,
          notWebReady: true,
          proxyHeaders: {
            request: {
              Referer: "https://ok.ru/",
              "User-Agent": UA_MOB,
            },
          },
        },
      };
    }

    if (/\.(m3u8|mp4)(\?|$)/i.test(cand)) {
      return {
        name: providerName,
        title: `Episode ${String(episode).padStart(2, "0")}`,
        url: cand,
        behaviorHints: {
          group: groupName
        }
      };
    }

    return null;
  } catch (err) {
    console.error("khmerave stream error:", err.message);
    return null;
  }
}

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
};