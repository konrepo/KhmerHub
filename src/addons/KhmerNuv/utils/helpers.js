function normalizePoster(url) {
  if (!url || typeof url !== "string") return "";

  let u = url.trim();

  if (u.startsWith("//")) {
    u = "https:" + u;
  }

  u = u.replace(/^http:/, "https:");

  return u
    .replace(/\/s\d+(-[a-z0-9-]+)?\//gi, "/s0/")
    .replace(/=s\d+(-[a-z0-9-]+)?/gi, "=s0")
    .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/");
}

const DIRECT_REGEX =
  /https?:\/\/[^\s"';<> ]+\.(?:m3u8|mp4)(?:\?[^\s"';<> ]+)?/gi;

const OK_REGEX =
  /https?:\/\/ok\.ru\/(?:videoembed|video)\/\d+/gi;

const PLAYER_REGEX =
  /https?:\/\/phumikhmer\.vip\/player\.php\?(?:id|stream)=[^"'\s<>]+/gi;

const FILE_REGEX =
  /file\s*:\s*["'](https?:\/\/[^"']+\.mp4(?:\?[^"']+)?)["']/gi;

function extractEpisodeNumber(url, index = 0, maxEp = null) {
  if (!url || typeof url !== "string") return index + 1;

  const patterns = [
    /[?&](?:episode|ep)=(\d{1,4})(?:\D|$)/i,
    /(?:episode|ep)[^\d]{0,3}(\d{1,4})(?:\D|$)/i,
    /(?:^|[\/_.-])e(\d{1,4})(?:\D|$)/i,
    /(?:^|[\/_.-])(\d{1,4})(?:\.m3u8|\.mp4)(?:\?|$)/i,
    /-(\d{1,4})(?:\D|$)/i
  ];

  for (const re of patterns) {
    const m = url.match(re);
    if (!m) continue;

    const ep = parseInt(m[1], 10);
    if (!Number.isFinite(ep) || ep <= 0) continue;

    if (maxEp && ep > maxEp) continue;
    if (!maxEp && ep > 500) continue;

    return ep;
  }

  return index + 1;
}

function isProbablyVideoUrl(url) {
  if (!url || typeof url !== "string") return false;

  return (
    /\.m3u8(\?|$)/i.test(url) ||
    /\.mp4(\?|$)/i.test(url) ||
    /ok\.ru\/videoembed\//i.test(url) ||
    /phumikhmer\.vip\/player\.php\?(?:id|stream)=/i.test(url) ||
    /sooplive\.co\.kr/i.test(url) ||
    /dailymotion\.com\/embed\/video\//i.test(url) ||
    /drive\.google\.com\/file\/d\//i.test(url)
  );
}

function extractVideoLinks(text) {
  if (!text) return [];

  const directMatches = text.match(DIRECT_REGEX) || [];
  const okMatches = (text.match(OK_REGEX) || [])
    .map((u) => u.replace("/video/", "/videoembed/"));
  const playerMatches = text.match(PLAYER_REGEX) || [];

  FILE_REGEX.lastIndex = 0;

  const fileMatches = [];
  let match;
  while ((match = FILE_REGEX.exec(text)) !== null) {
    fileMatches.push(match[1]);
  }

  return Array.from(new Set([
    ...directMatches,
    ...okMatches,
    ...playerMatches,
    ...fileMatches
  ]))
    .map((u) => u.trim())
    .filter(isProbablyVideoUrl);
}

function extractSpecialEmbedUrls(text) {
  if (!text || typeof text !== "string") return [];

  const urls = [];
  let match;

  const patterns = [
    {
      re: /\{ok\s*=\s*([0-9]{6,})\}/gi,
      map: (id) => `https://ok.ru/videoembed/${id}`
    },
    {
      re: /\{dm\s*=\s*([a-zA-Z0-9]+)\}/gi,
      map: (id) => `https://www.dailymotion.com/embed/video/${id}`
    },
    {
      re: /\{gd\s*=\s*([a-zA-Z0-9_-]+)\}/gi,
      map: (id) => `https://drive.google.com/file/d/${id}/preview`
    },
    {
      re: /\{GDEmk\s*=\s*([a-zA-Z0-9_-]+)\}/gi,
      map: (id) => `https://drive.google.com/file/d/${id}/preview`
    }
  ];

  for (const { re, map } of patterns) {
    re.lastIndex = 0;
    while ((match = re.exec(text)) !== null) {
      urls.push(map(match[1]));
    }
  }

  return [...new Set(urls)].filter(isProbablyVideoUrl);
}

function extractMaxEpFromTitle(title) {
  if (!title) return null;

  const match =
    title.match(/\[(?:EP\s*)?(\d+)\s*END\]/i) ||
    title.match(/\[(?:EP\s*)?(\d+)\]/i) ||
    title.match(/\bEP\.?\s*-?\s*(\d+)\b/i) ||
    title.match(/\bEpisode\s*-?\s*(\d+)\b/i);

  return match ? parseInt(match[1], 10) : null;
}

function extractOkIds(text) {
  if (!text) return [];

  const idRegex = /(^|[\s;])(\d{10,})(?=\s*;|\s|$)/g;

  const ids = [];
  let m;
  while ((m = idRegex.exec(text)) !== null) {
    ids.push(m[2]);
  }

  return Array.from(new Set(ids));
}

function mapMetas(items, type = "series") {
  return items.map((item) => ({
    id: item.id,
    type,
    name: item.name,
    poster: item.poster || "",
    posterShape: "poster"
  }));
}

function uniqById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

module.exports = {
  normalizePoster,
  extractEpisodeNumber,
  isProbablyVideoUrl,
  extractVideoLinks,
  extractSpecialEmbedUrls,
  extractMaxEpFromTitle,
  extractOkIds,
  mapMetas,
  uniqById
};
