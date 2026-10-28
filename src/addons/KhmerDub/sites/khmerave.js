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

async function testKhmerAveFeed() {
  try {
    const { data } = await axios.get(
      "https://www.khmeravenue.com/album/feed/",
      {
        headers: {
          "User-Agent": UA_WIN,
          Accept: "application/rss+xml, application/xml, text/xml, */*",
          Referer: "https://www.khmeravenue.com/"
        },
        timeout: 15000
      }
    );

    console.log("[KhmerAve RSS test]", {
      isXml: typeof data === "string" && data.includes("<rss"),
      hasMakeAWish:
        typeof data === "string" && data.includes("Make a Wish")
    });
  } catch (err) {
    console.error("[KhmerAve RSS test]", {
      status: err.response?.status,
      message: err.message
    });
  }
}

async function testKhmerAveMediaApi() {
  const tests = [
    ["album", "https://www.khmeravenue.com/wp-json/wp/v2/album/269426"],
    ["media", "https://www.khmeravenue.com/wp-json/wp/v2/media/269427"]
  ];

  for (const [label, url] of tests) {
    try {
      const { data } = await axios.get(url, {
        headers: {
          "User-Agent": UA_WIN,
          Referer: "https://www.khmeravenue.com/"
        },
        timeout: 15000
      });

      console.log(
        `[KhmerAve ${label} test] OK`,
        label === "album"
          ? String(data?.title?.rendered || "no title")
          : String(data?.source_url || "no image URL")
      );
    } catch (err) {
      console.log(
        `[KhmerAve ${label} test] FAILED`,
        String(err.response?.status || err.code || err.message)
      );
    }
  }
}

/* =========================
   EPISODE NUMBER HELPER
========================= */
function extractEpisodeNumber(link, text = "") {
  if (!link) return 1;

  if (link.includes("/album/")) return 1;

  let m;

  const textMatch = String(text).match(/Episode\s*0*(\d+)/i);
  if (textMatch) {
    const n = parseInt(textMatch[1], 10);
    if (n > 0) return n;
  }

  const slug = link
    .split("?")[0]
    .replace(/\/+$/, "")
    .split("/")
    .pop() || "";

  m = slug.match(/-(\d+)-end$/i);
  if (m) return parseInt(m[1], 10);

  m = slug.match(/-(\d+)e(?:-\d+)?$/i);
  if (m) return parseInt(m[1], 10);

  m = slug.match(/-(\d+)$/i);
  if (m) return parseInt(m[1], 10);

  m = slug.match(/-(\d+)-\d+$/i);
  if (m) return parseInt(m[1], 10);

  return 1;
}

/* =========================
   CATALOG
========================= */
const KHMERAVE_API = "https://www.khmeravenue.com/wp-json/wp/v2";

function parseKhmerAveCatalogRequest(url, pageSize) {
  const parsed = new URL(url);
  const parts = parsed.pathname.split("/").filter(Boolean);
  let page = 1;

  const pageIndex = parts.findIndex(
    (part, index) => part === "page" && /^\d+$/.test(parts[index + 1] || "")
  );
  if (pageIndex >= 0) page = Math.max(1, Number(parts[pageIndex + 1]) || 1);

  const taxonomySlugs = new Set([
    "feature",
    "country",
    "genre",
    "videostags",
    "dubbed",
    "albumcategory"
  ]);

  let taxonomy = "";
  let termSlug = "";
  if (parts.length >= 2 && taxonomySlugs.has(parts[0])) {
    taxonomy = parts[0];
    termSlug = parts[1];
  }

  return {
    page,
    perPage: Math.min(100, Math.max(1, Number(pageSize) || 18)),
    taxonomy,
    termSlug,
    search: (parsed.searchParams.get("s") || parsed.searchParams.get("search") || "").trim()
  };
}

async function getKhmerAveApiCatalogItems(url, siteConfig) {
  const request = parseKhmerAveCatalogRequest(url, siteConfig?.pageSize || 18);
  const params = {
    per_page: request.perPage,
    page: request.page
  };

  if (request.search) params.search = request.search;

  if (request.taxonomy && request.termSlug) {
    const termUrl = `${KHMERAVE_API}/${request.taxonomy}`;
    const { data: terms } = await axios.get(termUrl, {
      params: { slug: request.termSlug },
      headers: { "User-Agent": UA_WIN, Referer: "https://www.khmeravenue.com/" },
      timeout: 15000
    });

    const term = Array.isArray(terms) ? terms[0] : null;
    if (!term?.id) {
      console.warn("[KhmerAve API] taxonomy term not found", {
        taxonomy: request.taxonomy,
        slug: request.termSlug
      });
      return [];
    }
    params[request.taxonomy] = term.id;
  }

  const { data: albums } = await axios.get(`${KHMERAVE_API}/album`, {
    params,
    headers: { "User-Agent": UA_WIN, Referer: "https://www.khmeravenue.com/" },
    timeout: 15000
  });

  if (!Array.isArray(albums) || albums.length === 0) return [];

  // KhmerAvenue stores its poster attachment ID in acf.video_image, not featured_media.
  const imageIds = [...new Set(
    albums
      .map((album) => Number(album?.acf?.video_image))
      .filter((id) => Number.isInteger(id) && id > 0)
  )];

  const imagesById = new Map();
  if (imageIds.length) {
    try {
      const { data: media } = await axios.get(`${KHMERAVE_API}/media`, {
        params: { include: imageIds.join(","), per_page: Math.min(100, imageIds.length) },
        headers: { "User-Agent": UA_WIN, Referer: "https://www.khmeravenue.com/" },
        timeout: 15000
      });

      if (Array.isArray(media)) {
        for (const image of media) {
          const sizes = image?.media_details?.sizes || {};
          const poster =
            sizes.medium_large?.source_url ||
            sizes.medium?.source_url ||
            sizes.thumbnail?.source_url ||
            image?.source_url ||
            "";
          if (image?.id && poster) imagesById.set(Number(image.id), poster);
        }
      }
    } catch (err) {
      // Keep catalog titles/links available if image metadata temporarily fails.
      console.error("[KhmerAve API] media lookup failed:", err.response?.status || err.message);
    }
  }

  return albums
    .map((album) => {
      const title = cleanTitle(album?.title?.rendered || "");
      const link = album?.link || "";
      const imageId = Number(album?.acf?.video_image);
      const poster = imagesById.get(imageId) || "";

      if (!title || !link) return null;
      return {
        id: `khmerave:${encodeURIComponent(link)}`,
        name: title,
        poster,
        background: poster
      };
    })
    .filter(Boolean);
}

async function getCatalogItems(prefix, siteConfig, url) {
  // KhmerAvenue blocks Render's HTML requests with Cloudflare 403, but its public
  // WordPress REST API is accessible. Keep Merlkon on its existing HTML parser.
  if (prefix === "khmerave") {
    try {
      return await getKhmerAveApiCatalogItems(url, siteConfig);
    } catch (err) {
      console.error("[KhmerAve API catalog error]", {
        status: err.response?.status,
        url: err.config?.url,
        message: err.message
      });
      return [];
    }
  }

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
      title: `Episode ${String(e.epNumber).padStart(2, "0")}`,
      seriesTitle: pageTitle,
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

async function pickHighestHlsVariant(masterUrl, ua) {
  try {
    const { data } = await axios.get(masterUrl, {
      headers: {
        "User-Agent": ua,
        Referer: "https://ok.ru/"
      },
      timeout: 15000
    });

    const lines = String(data || "").split(/\r?\n/);
    let best = null;

    for (let i = 0; i < lines.length; i++) {
      const info = lines[i];
      if (!info.startsWith("#EXT-X-STREAM-INF")) continue;

      const next = lines[i + 1];
      if (!next || next.startsWith("#")) continue;

      const res = info.match(/RESOLUTION=(\d+)x(\d+)/i);
      const height = res ? parseInt(res[2], 10) : 0;

      let variantUrl;
      try {
        variantUrl = new URL(next.trim(), masterUrl).toString();
      } catch {
        continue;
      }

      if (!best || height > best.height) {
        best = { height, url: variantUrl };
      }
    }

    return best?.url || masterUrl;
  } catch {
    return masterUrl;
  }
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

    html = html
      .replace(/\\&quot;/g, '"')
      .replace(/&quot;/g, '"')
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/");

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

        const picked = await pickHighestHlsVariant(directUrl, ua);
        console.log("OKRU_PICKED_HIGHEST =", picked);

        return picked;
      }

      return null;
    }

    let cleanUrl = match[1]
      .replace(/\\u0026/g, "&")
      .replace(/\\&/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

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
          cleanUrl = metaMatch[1]
            .replace(/\\u0026/g, "&")
            .replace(/\\&/g, "&")
            .replace(/\\\//g, "/")
            .replace(/&amp;/g, "&");
        }
      } catch (e) {
        console.error("OK metadata resolver error:", e.response?.status || e.message);
      }
    }

    const picked = await pickHighestHlsVariant(cleanUrl, ua);
    console.log("OKRU_PICKED_HIGHEST =", picked);

    return picked;
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

testKhmerAveFeed();
testKhmerAveMediaApi();

module.exports = {
  getCatalogItems,
  getEpisodes,
  getStream,
};
