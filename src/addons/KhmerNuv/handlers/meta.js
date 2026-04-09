module.exports = (builder, deps) => {
  const { getSiteEngine, SITE_TYPES } = deps;

  /* =========================
     META
  ========================= */
  builder.defineMetaHandler(async ({ id }) => {
    try {
      const parts = id.split(":");
      const prefix = parts[0];
      const encodedUrl = parts.slice(1).join(":");

      if (!prefix || !encodedUrl) return { meta: null };

      const ctx = getSiteEngine(prefix);
      if (!ctx) return { meta: null };

      const { engine: siteEngine } = ctx;
      const siteType = SITE_TYPES[prefix] || SITE_TYPES.default;
      const seriesUrl = decodeURIComponent(encodedUrl);

      const episodes = await siteEngine.getEpisodes(prefix, seriesUrl);
      if (!episodes.length) return { meta: null };

      const first = episodes[0];

      if (siteType === "movie" || siteType === "channel") {
        return {
          meta: {
            id,
            type: siteType,
            name: first.title,
            poster: first.thumbnail,
            background: first.thumbnail,
            description: first.title
          },
        };
      }

      return {
        meta: {
          id,
          type: siteType,
          name: first.title,
          poster: first.thumbnail,
          background: first.thumbnail,
          videos: episodes,
        },
      };
    } catch (err) {
      return { meta: null };
    }
  });
};