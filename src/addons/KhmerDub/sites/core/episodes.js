const { POST_INFO } = require("../../utils/cache");
const { getPostId } = require("./postId");
const { getStreamDetail } = require("./stream");

/* =========================
   EPISODES
========================= */
async function getEpisodes(prefix, seriesUrl) {
  let postId = null;

  if (prefix === "sunday") {
    try {
      postId = await getPostId(seriesUrl);
    } catch (err) {
      const status = err?.response?.status;

      if (status !== 429) {
        console.log(
          "[sunday] getPostId failed:",
          status || err?.message
        );
      }

      return [];
    }
  } else {
    postId = await getPostId(seriesUrl);
  }

  if (!postId) {
    return [];
  }

  const detail = await getStreamDetail(postId, seriesUrl);

  if (!detail) {
    return [];
  }

  const cached = POST_INFO.get(postId);
  // Reuse the original series poster when the selected video host has no thumbnail.
  const episodeThumbnail = cached?.poster || detail.thumbnail || "";
  const maxEp = cached?.maxEp || null;

  let urls = Array.isArray(detail.urls)
    ? detail.urls.filter(Boolean)
    : [];

  if (maxEp && urls.length > maxEp) {
    urls = urls.slice(0, maxEp);
  }

  return urls.map((url, index) => ({
    id: `${prefix}:${encodeURIComponent(seriesUrl)}:1:${index + 1}`,
    title: `Episode ${String(index + 1).padStart(2, "0")}`,
    seriesTitle: detail.title,
    season: 1,
    episode: index + 1,
    thumbnail: episodeThumbnail,
    released: new Date().toISOString(),
  }));
}

module.exports = {
  getEpisodes,
};
