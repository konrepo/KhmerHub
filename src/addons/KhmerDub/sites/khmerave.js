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
   EPISODE NUMBER HELPER
========================= */
function extractEpisodeNumber(link, text = "") {
  if (!link) return 1;

  if (link.includes("/album/")) return 1;

  const slug = link
    .split("?")[0]
    .replace(/\/+$/, "")
    .split("/")
    .pop() || "";

  let m;

  m = slug.match(/-(\d+)-end$/i);
  if (m) return parseInt(m[1], 10);

  m = slug.match(/-(\d+)e(?:-\d+)?$/i);
  if (m) return parseInt(m[1], 10);

  m = slug.match(/-(\d+)-\d+$/i);
  if (m) return parseInt(m[1], 10);

  m = slug.match(/-(\d+)$/i);
  if (m) return parseInt(m[1], 10);

  m = String(text).match(/Episode\s*0*(\d+)/i);
  if (m) return parseInt(m[1], 10);

  return 1;
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

    $("div.col-6.col-sm-4.thumbnail-container, div.card-content").each((_, el) => {
      const link = $(el).find("a").attr("href");
      const title = cleanTitle($(el).find("h3").text());

      const style =
        $(el).find("div[style]").attr("style") ||
        $(el).find(".card-content-image").attr("style") ||
        "";

      const poster = posterFromStyle(style);

      if (link && title) {
        items.push({
          id: `${prefix}:${encodeURIComponent(link)}`,
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
      headers: { "User-Agent": UA_MOB, Referer: referer(prefix) },
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
    $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]").each(
      (_, el) => {
        const link = $(el).attr("href");
        if (!link) return;
        if (link.includes("?post_type=videos")) return;

        const text = $(el).text().trim();
        const epNumber = extractEpisodeNumber(link, text);

        eps.push({ link, epNumber });
      }
    );

    if (!eps.length) return [];

    eps = [...new Map(eps.map((e) => [e.link, e])).values()];
    eps.sort((a, b) => a.epNumber - b.epNumber);

    return eps.map((e) => ({
      id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${e.epNumber}`,
      title: pageTitle,
      season: 1,
      episode: e.epNumber,
      thumbnail: poster,
      released: new Date().toISOString(),
    }));
  } catch (err) {
    console.error("khmerave meta error:", err.message);
    return [];
  }
}

/* =========================
   STREAM
========================= */
function normalizeOkUrl(url) {
  if (!url) return url;

  let u = url.trim();

  if (u.startsWith("//")) {
    u = "https:" + u;
  }

  // Important: convert mobile domain
  u = u.replace("m.ok.ru", "ok.ru");

  return u;
}

function tryExtractVideoCandidateFromKhmerAvenue(html) {
  // Base64 decode case
  const b64 = html.match(/Base64\.decode\("(.+?)"\)/i);
  if (b64?.[1]) {
    try {
      const decoded = Buffer.from(b64[1], "base64").toString("utf8");
      const iframe = decoded.match(/<iframe[^>]+src=["']([^"']+)["']/i);
      if (iframe?.[1]) return iframe[1];
    } catch {}
  }

  // Standard patterns (covers options.player_list file:)
  const patterns = [
    /['"]?file['"]?\s*:\s*['"]([^'"]+)['"]/i,
    /<iframe[^>]*src=["']([^"']+)["']/i,
    /<source[^>]*src=["']([^"']+)["']/i,
    /playlist:\s*["']([^"']+)["']/i
  ];

  for (const re of patterns) {
    const m = html.match(re);
    if (m?.[1]) return m[1];
  }

  return null;
}

async function resolveOkRuToDirect(iframeUrl, ua) {
  try {
    const okUrl = normalizeOkUrl(iframeUrl);

    const okRes = await axios.get(okUrl, {
      headers: {
        "User-Agent": ua,
        "Referer": "https://ok.ru/"
      },
      timeout: 15000
    });

    let html = okRes.data;
    if (typeof html !== "string") {
      html = String(html);
    }

    // Decode escaped content
    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/");

    const debugKeys = [
      "ondemandHls",
      "hlsMasterPlaylistUrl",
      "hlsManifestUrl",
      "metadataUrl",
      "master.m3u8",
      ".m3u8",
      "videoSrc",
      "flashvars",
      "data-options",
      "playerOptions",
      "metadata"
    ];

    let match = null;

    const patterns = [
      /"ondemandHls"\s*:\s*"([^"]+)"/i,
      /"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)"/i,
      /"hlsManifestUrl"\s*:\s*"([^"]+)"/i,
      /"metadataUrl"\s*:\s*"(https:[^"]+)"/i,
      /"videoSrc"\s*:\s*"(https:[^"]+\.m3u8[^"]*)"/i,
      /"(https:\/\/[^"]+master\.m3u8[^"]*)"/i,
      /"(https:\/\/[^"]+\.m3u8[^"]*)"/i,
      /playerOptions.*?(https:\/\/[^"' ]+\.m3u8[^"' ]*)/i,
      /metadata.*?(https:\/\/[^"' ]+\.m3u8[^"' ]*)/i
    ];

    for (const re of patterns) {
      const m = html.match(re);
      if (m && m[1]) {
        match = m;
        break;
      }
    }

    if (!match || !match[1]) {
      const videoUrlMatches = [
        ...html.matchAll(/"name":"[^"]+","url":"(https:[^"]+)"/gi),
        ...html.matchAll(/"url":"(https:[^"]+)","name":"[^"]+"/gi),
        ...html.matchAll(/&quot;name&quot;:&quot;[^"]+&quot;,&quot;url&quot;:&quot;(https:[^"]+)&quot;/gi),
        ...html.matchAll(/&quot;url&quot;:&quot;(https:[^"]+)&quot;,&quot;name&quot;:&quot;[^"]+&quot;/gi)
      ];

      if (videoUrlMatches.length) {
        const directUrl = videoUrlMatches[videoUrlMatches.length - 1][1]
          .replace(/\\u0026/g, "&")
          .replace(/\\&/g, "&")
          .replace(/\\\//g, "/")
          .replace(/&amp;/g, "&");

        return directUrl;
      }

      return null;
    }

    const cleanUrl = match[1]
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&");

    // If this is a metadata URL, fetch real m3u8
    if (/metadata/i.test(cleanUrl) && /^https?:\/\//i.test(cleanUrl)) {
      try {
        const metaRes = await axios.get(cleanUrl, {
          headers: {
            "User-Agent": ua,
            "Referer": "https://ok.ru/"
          },
          timeout: 15000
        });

        let metaText = metaRes.data;
        if (typeof metaText !== "string") {
          metaText = JSON.stringify(metaText);
        }

        metaText = metaText
          .replace(/\\u0026/g, "&")
          .replace(/\\&/g, "&")
          .replace(/\\\//g, "/");

        const metaMatch =
          metaText.match(/"ondemandHls"\s*:\s*"([^"]+)"/i) ||
          metaText.match(/"hlsMasterPlaylistUrl"\s*:\s*"([^"]+)"/i) ||
          metaText.match(/"(https:\/\/[^"]+\.m3u8[^"]*)"/i);

        if (metaMatch?.[1]) {
          const finalUrl = metaMatch[1]
            .replace(/\\u0026/g, "&")
            .replace(/\\&/g, "&")
            .replace(/\\\//g, "/");

          return finalUrl;
        }
      } catch (e) {
        console.error("OK metadata resolver error:", e.response?.status || e.message);
      }
    }

    return cleanUrl;

  } catch (err) {
    console.error("OK resolver error:", err.response?.status || err.message);
    return null;
  }
}

async function getStream(prefix, seriesUrl, episode) {
  try {
    const providerNames = {
      khmerave: "KhmerAve",
      merlkon: "Merlkon"
    };

    const providerName = providerNames[prefix] || "KhmerDub";
    const groupName = prefix || "khmerdub";

    // Re-scrape series page to find episode link
    const { data } = await axios.get(seriesUrl, {
      headers: { "User-Agent": UA_MOB, Referer: referer(prefix) },
      timeout: 15000,
    });

    const $ = cheerio.load(data);

    let eps = [];
    $("table#latest-videos a[href], div.col-xs-6.col-sm-6.col-md-3 a[href]").each(
      (_, el) => {
        const link = $(el).attr("href");
        if (!link) return;
        if (link.includes("?post_type=videos")) return;

        const text = $(el).text().trim();
        const epNumber = extractEpisodeNumber(link, text);

        eps.push({ link, epNumber });
      }
    );

    eps = [...new Map(eps.map((e) => [e.link, e])).values()];
    eps.sort((a, b) => a.epNumber - b.epNumber);

    const target = eps.find((e) => e.epNumber === episode);
    if (!target) return null;

    const epUrl = target.link;

    const epRes = await axios.get(epUrl, {
      headers: { "User-Agent": UA_MOB, Referer: referer(prefix) },
      timeout: 15000,
    });

    const candidate = tryExtractVideoCandidateFromKhmerAvenue(String(epRes.data || ""));
    if (!candidate) return null;

    const cand = normalizeOkUrl(candidate);

    if (cand.includes("ok.ru")) {
	  
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
              "User-Agent": UA_MOB
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

