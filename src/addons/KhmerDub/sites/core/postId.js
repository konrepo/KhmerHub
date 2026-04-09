const cheerio = require("cheerio");
const axiosClient = require("../../utils/fetch");
const { URL_TO_POSTID, POST_INFO } = require("../../utils/cache");
const { extractMaxEpFromTitle } = require("../../utils/helpers");

/* =========================
   GET POST ID
========================= */
async function getPostId(url) {
  if (URL_TO_POSTID.has(url)) {
    return URL_TO_POSTID.get(url);
  }

  const { data } = await axiosClient.get(url, {
    headers: {
      "User-Agent": "Mozilla/5.0",
      Referer: url
    }
  });

  const $ = cheerio.load(data);

  let postId = null;
  let sourceType = null;

  const urlObj = new URL(url);
  const hostname = urlObj.hostname.replace(/^www\./, "");

  // Prefer VIP WordPress detection on phumikhmer.vip
  if (hostname === "phumikhmer.vip") {
    let match = null;

    const shortlink = $('link[rel="shortlink"]').attr("href") || "";
    match = shortlink.match(/[?&]p=(\d+)/i);

    if (!match) {
      const apiLink =
        $('link[rel="alternate"][type="application/json"]').attr("href") || "";
      match = apiLink.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/i);
    }

    if (!match) {
      const articleId = $("article[id^='post-']").attr("id") || "";
      match = articleId.match(/^post-(\d+)$/i);
    }

    if (!match) {
      const imgPostId = $("img[post-id]").first().attr("post-id");
      if (imgPostId) {
        match = [, imgPostId];
      }
    }

    if (match) {
      postId = match[1];
      sourceType = "vip-wordpress";
    }
  }

  // VIP / iDrama old blogger style
  if (!postId) {
    postId = $("#player").attr("data-post-id");
    if (postId) {
      sourceType = "blogger";
    }
  }

  // SundayDrama
  if (!postId) {
    const fanta = $('div[id="fanta"][data-post-id]').first();
    if (fanta.length) {
      postId = fanta.attr("data-post-id");
      sourceType = "blogger";
    }
  }

  // Blogger fallback from feed url in page source
  if (!postId) {
    const match = data.match(
      /blogger\.com\/feeds\/\d+\/posts\/default\/(\d+)\?alt=json/i
    );
    if (match) {
      postId = match[1];
      sourceType = "blogger";
    }
  }

  // VIP WordPress fallback for non-phumikhmer.vip cases
  if (!postId) {
    let match = null;

    const shortlink = $('link[rel="shortlink"]').attr("href") || "";
    match = shortlink.match(/[?&]p=(\d+)/i);

    if (!match) {
      const apiLink =
        $('link[rel="alternate"][type="application/json"]').attr("href") || "";
      match = apiLink.match(/\/wp-json\/wp\/v2\/posts\/(\d+)/i);
    }

    if (!match) {
      const articleId = $("article[id^='post-']").attr("id") || "";
      match = articleId.match(/^post-(\d+)$/i);
    }

    if (!match) {
      const imgPostId = $("img[post-id]").first().attr("post-id");
      if (imgPostId) {
        match = [, imgPostId];
      }
    }

    if (match) {
      postId = match[1];
      sourceType = "vip-wordpress";
    }
  }

  if (!postId) return null;

  const pageTitle = $("title").text().trim();
  let maxEp = extractMaxEpFromTitle(pageTitle);

  if (!maxEp) {
    const epText = $('b:contains("episode/")').first().text() || "";
    const match = epText.match(/episode\/(?:END\.)?(\d+)/i);
    if (match) maxEp = parseInt(match[1], 10);
  }

  const slug =
    urlObj.pathname
      .split("/")
      .filter(Boolean)
      .pop() || "";

  const cleanTitle =
    $("meta[property='og:title']").attr("content") ||
    $("h1.entry-title, h1.post-title, h1.single-post-title, title")
      .first()
      .text()
      .trim() ||
    "";

  URL_TO_POSTID.set(url, postId);

  POST_INFO.set(postId, {
    ...(POST_INFO.get(postId) || {}),
    maxEp: maxEp || null,
    sourceType: sourceType || "unknown",
    pageHtml: data,
    slug,
    cleanTitle
  });

  return postId;
}

module.exports = {
  getPostId,
};