const axiosClient = require("./fetch");

/* =========================
   PLAYER RESOLVE
========================= */
async function resolvePlayerUrl(playerUrl) {
  try {
    const { data } = await axiosClient.get(playerUrl);

    const html = data
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&");

    const match = html.match(
      /https?:\/\/phumikhmer\.vip\/player\.php\?stream=[^"'<> ]+/i
    );

    return match ? match[0] : null;
  } catch {
    return null;
  }
}

/* =========================
   RESOLVE OK
========================= */
async function resolveOkEmbed(embedUrl) {
  try {
    const { data } = await axiosClient.get(embedUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0",
        Referer: "https://ok.ru/"
      }
    });

    const hlsMatch =
      data.match(/\\&quot;ondemandHls\\&quot;:\\&quot;(https:\/\/[^"]+?\.m3u8)/) ||
      data.match(/&quot;ondemandHls&quot;:&quot;(https:\/\/[^"]+?\.m3u8)/);

    if (!hlsMatch) {
      return null;
    }

    return hlsMatch[1]
      .replace(/\\u0026/g, "&")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .replace(/\\&quot;.*/g, "");
  } catch {
    return null;
  }
}

/* =========================
   BUILD STREAM
========================= */
function buildStream(url, episode, title, name = "KhmerDub", group = "khmerdub") {
  const isOk = /ok\.ru|okcdn\.ru/i.test(url);

  return {
    url,
    name,
    title: title || `Episode ${episode}`,
    type: url.includes(".m3u8") ? "hls" : undefined,
    behaviorHints: isOk
      ? {
          group,
          proxyHeaders: {
            request: {
              Referer: "https://ok.ru/",
              Origin: "https://ok.ru"
            }
          }
        }
      : { group }
  };
}

module.exports = {
  resolvePlayerUrl,
  resolveOkEmbed,
  buildStream
};