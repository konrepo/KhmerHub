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
      const seriesName = first.seriesTitle || first.name || first.title;
      
      if (siteType === "movie" || siteType === "channel") {
        return {
          meta: {
            id,
            type: siteType,
            name: seriesName,
            poster: first.thumbnail,
            background: first.thumbnail,
            description: seriesName
          },
        };
      }
      
      return {
        meta: {
          id,
          type: siteType,
          name: seriesName,
          poster: first.thumbnail,
          background: first.thumbnail,
          description: seriesName,
          videos: episodes,
        },
      };
    } catch (err) {
      console.error("[meta] failed:", {
        id,
        message: err?.message,
        status: err?.response?.status,
        url: err?.config?.url
      });

      return { meta: null };
    }
  });
};
