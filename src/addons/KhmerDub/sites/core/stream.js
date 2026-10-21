const axiosClient = require("../../utils/fetch");
const { POST_INFO, BLOG_IDS } = require("../../utils/cache");
const { extractVideoLinks } = require("../../utils/helpers");
const {
  resolvePlayerUrl,
  resolveOkEmbed,
  resolveNizuEmbed,
  buildStream
} = require("../../utils/streamResolvers");
const { getPostId } = require("./postId");
const { fetchFromBlog } = require("./blogger");
const { fetchVipWordpressDetail } = require("./wordpress");

const FILE_REGEX =
  /file\s*:\s*["'](https?:\/\/[^"']+\.mp4(?:\?[^"']+)?)["']/gi;

function extractKhmerDramaUrl(html = "") {
  const text = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const match = text.match(
    /https?:\/\/(?:video4khmer\.khmerdrama\.org|khmermove\.cinaze\.com)\/(?:tv-series|movies)\/[^"'<>\\\s]+/i
  );

  return match ? match[0] : null;
}

async function fetchKhmerDramaDetail(khmerDramaUrl) {
  const parsedUrl = new URL(khmerDramaUrl);

  const slug = parsedUrl.pathname
    .split("/")
    .filter(Boolean)
    .pop();

  const origin = parsedUrl.origin;

  const apiUrl =
    `${origin}/api/movies.php?find_slug=${encodeURIComponent(slug)}&paginated=1`;

  const { data } = await axiosClient.get(apiUrl, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: khmerDramaUrl
    }
  });

  const found = Array.isArray(data?.data) ? data.data[0] : data?.data;
  if (!found) return null;

  let servers = [];
  try {
    servers = typeof found.servers === "string"
      ? JSON.parse(found.servers)
      : found.servers || [];
  } catch {
    servers = [];
  }

  const episodeMap = new Map();

  servers.forEach((server) => {
    const episodes = Array.isArray(server.episodes) ? server.episodes : [];

    episodes.forEach((ep, index) => {
      const epName =
        typeof ep === "object" && ep?.episode_name
          ? String(ep.episode_name).trim()
          : String(index + 1);

      const epUrl =
        typeof ep === "string"
          ? ep
          : ep?.url || ep?.file || ep?.src || "";

      if (!episodeMap.has(epName)) {
        episodeMap.set(epName, epUrl || "");
      } else if (!episodeMap.get(epName) && epUrl) {
        episodeMap.set(epName, epUrl);
      }
    });
  });

  const urls = [...episodeMap.entries()]
    .sort((a, b) => Number(a[0]) - Number(b[0]))
    .map(([, url]) => url)
    .filter(Boolean);

  if (!urls.length) return null;

  return {
    title: found.phoneticTitle || found.title || "PhumiVIP",
    thumbnail: found.poster || found.backdrop || "",
    urls,
    maxEp: urls.length,
    sourceType: "khmerdrama-api"
  };
}

function extractKhmerMoviePlayerConfig(html = "") {
  const text = String(html || "")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");

  const postId =
    text.match(/data-postid=["'](\d+)["']/i)?.[1] || "";

  const accessToken =
    text.match(/data-access-token=["']([^"']+)["']/i)?.[1] || "";

  const freeEps = parseInt(
    text.match(/data-freeeps=["'](\d+)["']/i)?.[1] || "0",
    10
  );

  const isPremium =
    text.match(/data-premium=["']([^"']+)["']/i)?.[1] === "true";

  const isUnlocked =
    text.match(/data-unlocked=["']([^"']+)["']/i)?.[1] === "true";

  const playerSettingsMatch = text.match(
    /var\s+PLAYER_SETTINGS\s*=\s*(\{.*?\});/is
  );

  let nonce = "";
  let ajaxUrl = "https://khmer-movie.org/wp-admin/admin-ajax.php";

  if (playerSettingsMatch?.[1]) {
    const playerSettingsText = playerSettingsMatch[1];

    nonce =
      playerSettingsText.match(
        /["']nonce["']\s*:\s*["']([^"']+)["']/i
      )?.[1] || "";

    ajaxUrl =
      playerSettingsText.match(
        /["']ajaxUrl["']\s*:\s*["']([^"']+)["']/i
      )?.[1] ||
      ajaxUrl;
  }

  if (!postId || !accessToken || !nonce) {
    return null;
  }

  return {
    postId,
    accessToken,
    freeEps,
    isPremium,
    isUnlocked,
    nonce,
    ajaxUrl
  };
}

async function resolveKhmerMovieEpisode(pageUrl, episode) {
  try {
    const { data: html } = await axiosClient.get(pageUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: pageUrl
      }
    });

    const config = extractKhmerMoviePlayerConfig(html);
    if (!config) return null;

    const episodeIndex = episode - 1;

    if (
      config.isPremium &&
      !config.isUnlocked &&
      episodeIndex >= config.freeEps
    ) {
      return null;
    }

    const body = new URLSearchParams({
      action: "anc_player_resolve_source",
      nonce: config.nonce,
      access_token: config.accessToken,
      post_id: config.postId,
      episode: String(episodeIndex)
    });

    const { data } = await axiosClient.post(
      config.ajaxUrl,
      body.toString(),
      {
        headers: {
          "Content-Type":
            "application/x-www-form-urlencoded; charset=UTF-8",
          "User-Agent": "Mozilla/5.0",
          Referer: pageUrl
        }
      }
    );

    if (!data?.success || !data?.data?.url) {
      return null;
    }

    return data.data.url;
  } catch (err) {
    return null;
  }
}

async function fetchKhmerMovieDetail(seriesUrl) {
  try {
    const parsedUrl = new URL(seriesUrl);

    const slug = parsedUrl.pathname
      .split("/")
      .filter(Boolean)
      .pop();

    if (!slug) return null;

    const baseUrl =
      `https://khmer-movie.org/tv-shows/${encodeURIComponent(slug)}/`;

    const firstEpisodeUrl = `${baseUrl}?ep=1`;

    const { data: html } = await axiosClient.get(firstEpisodeUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: seriesUrl
      }
    });

    const config = extractKhmerMoviePlayerConfig(html);
    if (!config) return null;

    const episodeCount = config.freeEps;

    if (!episodeCount) return null;

    const text = String(html || "")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const title =
      text.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      text.match(/<title>([^<]+)<\/title>/i)?.[1] ||
      slug;

    const thumbnail =
      text.match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']/i)?.[1] ||
      "";

    const urls = Array.from(
      { length: episodeCount },
      (_, index) => `${baseUrl}?ep=${index + 1}`
    );

    return {
      title,
      thumbnail,
      urls,
      maxEp: urls.length,
      sourceType: "khmer-movie"
    };
  } catch {
    return null;
  }
}


/* =========================
   ISOLATED VIP EXTRA SOURCES
   Does not change legacy source selection.
========================= */
async function fetchExtraANCDetail(sourceUrl) {
  try {
    const u = new URL(sourceUrl);
    if (u.hostname.replace(/^www\./, "") !== "sndrama.org" ||
        !u.pathname.startsWith("/tv-shows/")) return null;
    const baseUrl = `${u.origin}${u.pathname.endsWith("/") ? u.pathname : u.pathname + "/"}`;
    const { data: html } = await axiosClient.get(`${baseUrl}?ep=1`);
    const config = extractKhmerMoviePlayerConfig(html);
    if (!config) return null;
    const match = String(html).match(/<span\s+class=["']meta-label["']>\s*Episode:\s*<\/span>\s*<span\s+class=["']meta-value["']>\s*(\d+)\s*<\/span>/i);
    const count = Number(match?.[1]) || config.freeEps || 1;
    if (!Number.isInteger(count) || count < 1 || count > 500) return null;
    return {
      title: String(html).match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || "PhumiVIP",
      thumbnail: String(html).match(/<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)/i)?.[1] || "",
      urls: Array.from({ length: count }, (_, i) => `${baseUrl}?ep=${i + 1}`),
      maxEp: count,
      sourceType: "sndrama-extra"
    };
  } catch (error) {
    console.warn("[VIP SNDrama detail]", error.message);
    return null;
  }
}

async function resolveExtraANCEpisode(pageUrl, episode) {
  try {
    const u = new URL(pageUrl);
    if (u.hostname.replace(/^www\./, "") !== "sndrama.org") return null;
    u.searchParams.set("ep", String(episode));
    const { data: html } = await axiosClient.get(u.toString());
    const config = extractKhmerMoviePlayerConfig(html);
    if (!config || (config.isPremium && !config.isUnlocked && episode - 1 >= config.freeEps)) return null;
    const body = new URLSearchParams({
      action: "anc_player_resolve_source",
      nonce: config.nonce,
      access_token: config.accessToken,
      post_id: config.postId,
      episode: String(episode - 1)
    });
    const { data } = await axiosClient.post(config.ajaxUrl, body.toString(), {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8",
        Referer: u.toString()
      }
    });
    return data?.success && /^https?:\/\//i.test(data?.data?.url || "") ? data.data.url : null;
  } catch (error) {
    console.warn("[VIP SNDrama resolve]", error.message);
    return null;
  }
}

async function fetchExtraLulyDetail(seriesUrl, pageHtml) {
  try {
    const cheerio = require("cheerio");
    const $ = cheerio.load(pageHtml);
    const link = $("a[href*='luly.top/']").map((_, el) => $(el).attr("href")).get()
      .find((href) => {
        try {
          const u = new URL(href);
          return u.hostname === "luly.top" && /^\/[^/]+-\d+\/?$/.test(u.pathname);
        } catch { return false; }
      });
    if (!link) return null;
    const { data: html } = await axiosClient.get(link, { headers: { Referer: seriesUrl } });
    const $$ = cheerio.load(html);
    const episodes = new Map();
    $$(".episodelist a[href]").each((_, el) => {
      const number = Number($$(el).text().match(/(?:Eps?|Episode)\s*0*(\d+)/i)?.[1]);
      if (!Number.isInteger(number) || number < 1) return;
      try {
        const u = new URL($$(el).attr("href"), link);
        if (u.hostname === "luly.top") episodes.set(number, u.toString());
      } catch {}
    });
    if (!episodes.size) return null;
    return {
      title: $$('h2[itemprop="partOfSeries"]').first().text().trim() || "PhumiVIP",
      thumbnail: $$('meta[property="og:image"]').attr("content") || "",
      urls: [...episodes].sort((a, b) => a[0] - b[0]).map(([, url]) => url),
      maxEp: episodes.size,
      sourceType: "luly-extra"
    };
  } catch (error) {
    console.warn("[VIP Luly detail]", error.message);
    return null;
  }
}

async function resolveExtraLulyEpisode(episodeUrl) {
  try {
    const cheerio = require("cheerio");
    const { data } = await axiosClient.get(episodeUrl);
    const iframe = cheerio.load(data)(".player-embed iframe[src]").first().attr("src");
    if (!iframe) return null;
    const u = new URL(iframe, episodeUrl);
    if (!/^s\d+\.nizu\.top$/i.test(u.hostname)) return null;
    return u.toString();
  } catch { return null; }
}

async function discoverExtraVIPDetail(seriesUrl, cachedHtml) {
  try {
    const u = new URL(seriesUrl);
    if (u.hostname.replace(/^www\./, "") === "sndrama.org") {
      return await fetchExtraANCDetail(seriesUrl);
    }
    if (u.hostname.replace(/^www\./, "") !== "phumikhmer.vip") return null;
    const html = cachedHtml || (await axiosClient.get(seriesUrl)).data;
    const sn = String(html).replace(/\\\//g, "/")
      .match(/https?:\/\/(?:www\.)?sndrama\.org\/tv-shows\/[^"'<>\s]+/i)?.[0];
    if (sn) {
      const detail = await fetchExtraANCDetail(sn.replace(/&amp;/g, "&"));
      if (detail) return detail;
    }
    return await fetchExtraLulyDetail(seriesUrl, html);
  } catch { return null; }
}

/* =========================
   STREAM DETAIL
========================= */
async function getStreamDetail(postId, seriesUrl = "") {
  const cached = POST_INFO.get(postId);
  if (cached?.detail?.urls?.length) return cached.detail;

  const sourceType = cached?.sourceType || "blogger";
  let detail = null;

  if (sourceType === "vip-wordpress") {
    detail = await fetchVipWordpressDetail(seriesUrl, postId);
  } else {
    const results = await Promise.all(
      Object.values(BLOG_IDS).map((blogId) =>
        fetchFromBlog(blogId, postId)
      )
    );
    
    const validResults = results.filter(
      (item) => item && Array.isArray(item.urls) && item.urls.length
    );

    if (validResults.length) {
      detail = validResults.sort((a, b) => b.urls.length - a.urls.length)[0];
    }
  }

  if (seriesUrl) {
    try {
      let pageHtml = cached?.pageHtml || "";

      // Only fetch when getPostId did not already cache the page.
      if (!pageHtml) {
        const { data } = await axiosClient.get(seriesUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0",
            Referer: seriesUrl
          }
        });

        pageHtml = data || "";
      }

      const khmerDramaUrl = extractKhmerDramaUrl(pageHtml);

      if (khmerDramaUrl) {
        const kdDetail = await fetchKhmerDramaDetail(khmerDramaUrl);

        if (
          kdDetail &&
          Array.isArray(kdDetail.urls) &&
          (!detail || kdDetail.urls.length > (detail.urls?.length || 0))
        ) {
          detail = kdDetail;
        }
      }
    } catch {}
  }

  // Additional hosts are fallbacks only; do not replace a working legacy source.
  // VIP WordPress pages can link to SNDrama or Luly, so do not exclude them.
  if (!detail && seriesUrl) {
    detail = await discoverExtraVIPDetail(seriesUrl, cached?.pageHtml || "");
  }

  if (!detail && seriesUrl) {
    try {
      const hostname = new URL(seriesUrl).hostname.replace(/^www\./, "");

      if (hostname === "phumikhmer.vip") {
        detail = await fetchKhmerMovieDetail(seriesUrl);
      }
    } catch {}
  }

  if (!detail) {
    return null;
  }

  POST_INFO.set(postId, {
    ...(POST_INFO.get(postId) || {}),
    detail,
    maxEp: detail.maxEp || POST_INFO.get(postId)?.maxEp || null,
    sourceType: detail.sourceType || POST_INFO.get(postId)?.sourceType
  });

  return detail;
}

/* =========================
   STREAM
========================= */
async function getStream(prefix, seriesUrl, episode) {
  const postId = await getPostId(seriesUrl);

  const providerNames = {
    vip: "PhumiVIP",
    sunday: "SundayDrama",
    idrama: "iDramaHD",
    khmerave: "KhmerAve",
    merlkon: "Merlkon",
    phumi2: "PhumiClub",
    cat3movie: "Cat3Movie",
    xvideos: "xVideos"
  };

  const providerName = providerNames[prefix] || "KhmerDub";
  const groupName = prefix || "khmerdub";

  if (prefix === "vip" && /^https?:\/\/(?:www\.)?sndrama\.org\/tv-shows\//i.test(seriesUrl)) {
    const resolved = await resolveExtraANCEpisode(seriesUrl, episode);
    return resolved ? buildStream(resolved, episode, undefined, providerName, groupName, seriesUrl) : null;
  }

  if (prefix === "sunday" && !postId) {
    const { data } = await axiosClient.get(seriesUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: seriesUrl
      }
    });

    const links = extractVideoLinks(data);
    const url = links[episode - 1];
    if (!url) return null;

    return buildStream(
      url,
      episode,
      undefined,
      providerName,
      groupName,
      seriesUrl || "https://phumikhmer.vip/"
    );
  }

  if (!postId) return null;

  let detail = await getStreamDetail(postId, seriesUrl);

  if (!detail && prefix === "vip") {
    try {
      const { data } = await axiosClient.get(seriesUrl, {
        headers: {
          "User-Agent": "Mozilla/5.0",
          Referer: seriesUrl
        }
      });

      const fallbackUrls = extractVideoLinks(data);
      if (fallbackUrls.length) {
        detail = {
          title: "VIP",
          thumbnail: "",
          urls: fallbackUrls
        };
      }
    } catch {}
  }

  if (!detail) return null;

  let url = detail.urls[episode - 1];
  if (!url) return null;

  // Only new sources enter these branches. Legacy playback remains untouched.
  if (/^https?:\/\/(?:www\.)?sndrama\.org\/tv-shows\//i.test(url)) {
    const resolved = await resolveExtraANCEpisode(url, episode);
    if (!resolved) return null;
    return buildStream(resolved, episode, undefined, providerName, groupName, url);
  }

  if (/^https?:\/\/(?:www\.)?luly\.top\//i.test(url)) {
    const embed = await resolveExtraLulyEpisode(url);
    if (!embed) return null;
    const resolved = await resolveNizuEmbed(embed);
    return resolved ? buildStream(resolved, episode, undefined, providerName, groupName, embed) : null;
  }

  if (/https?:\/\/(?:www\.)?khmer-movie\.org\//i.test(url)) {
    const resolved = await resolveKhmerMovieEpisode(url, episode);
    if (!resolved) return null;
    url = resolved;
  }

  if (url.includes("player.php")) {
    const resolved = await resolvePlayerUrl(url);
    if (!resolved) return null;
    url = resolved;
  }

  if (url.includes("ok.ru/videoembed/")) {
    const resolved = await resolveOkEmbed(url);
    if (!resolved) return null;
    url = resolved;
  }

  return buildStream(
    url,
    episode,
    undefined,
    providerName,
    groupName,
    seriesUrl || "https://phumikhmer.vip/"
  );
}

module.exports = {
  FILE_REGEX,
  getStreamDetail,
  getStream,
};