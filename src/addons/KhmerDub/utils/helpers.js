function normalizePoster(url) {
  if (!url) return "";
  return url
    .replace(/\/s\d+(-[a-z0-9-]+)?\//gi, "/s0/")
    .replace(/=s\d+(-[a-z0-9-]+)?/gi, "=s0")
    .replace(/\/w\d+-h\d+[^/]*\//gi, "/s0/");
}

const DIRECT_REGEX =
  /https?:\/\/[^\s"';<> ]+\.(?:m3u8|mp4)(?:\?[^\s"';<> ]+)?/gi;

const OK_REGEX =
  /https?:\/\/ok\.ru\/(?:videoembed|video)\/\d+/gi;

const PLAYER_REGEX =
  /https?:\/\/phumikhmer\.vip\/player\.php\?(?:id=\d+|stream=[^"'<> ]+)/gi;

const FILE_REGEX =
  /file\s*:\s*["'](https?:\/\/[^"']+\.mp4(?:\?[^"']+)?)["']/gi;

function extractVideoLinks(text) {
  if (!text) return [];

  const directMatches = text.match(DIRECT_REGEX) || [];

  const okMatches = (text.match(OK_REGEX) || []).map((u) =>
    u.replace("/video/", "/videoembed/")
  );

  const playerMatches = text.match(PLAYER_REGEX) || [];

  FILE_REGEX.lastIndex = 0;
  const fileMatches = [];
  let match;

  while ((match = FILE_REGEX.exec(text)) !== null) {
    fileMatches.push(match[1]);
  }

  return Array.from(
    new Set([
      ...directMatches,
      ...okMatches,
      ...playerMatches,
      ...fileMatches
    ])
  );
}

function extractMaxEpFromTitle(title) {
  if (!title) return null;

  const match =
    title.match(/\[EP\.?\s*(\d+)\]/i) ||
    title.match(/\bEP\.?\s*(\d+)\b/i) ||
    title.match(/\bEpisode\s*(\d+)\b/i) ||
    title.match(/\[(\d+)\s*END\]/i) ||
    title.match(/\[(\d+)\s*(?:End|EP)\]/i) ||
    title.match(/episode\/(?:END\.)?(\d+)/i);

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
    poster: item.poster,
    posterShape: "poster",
	background: item.background || item.fanart || item.poster,
    genres: item.genres || [],
    description: item.genres?.length
      ? `Category: ${item.genres.join(", ")}`
      : ""
  }));
}

function uniqById(items) {
  return [...new Map(items.map((item) => [item.id, item])).values()];
}

module.exports = {
  normalizePoster,
  extractVideoLinks,
  extractMaxEpFromTitle,
  extractOkIds,
  mapMetas,
  uniqById

};