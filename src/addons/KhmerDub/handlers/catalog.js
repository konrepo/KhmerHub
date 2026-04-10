module.exports = (builder, deps) => {
  const {
    getSiteEngine,
    SITE_TYPES,
    axiosClient,
    cheerio,
    normalizePoster,
    mapMetas,
    uniqById
  } = deps;

  /* =========================
     CATALOG
  ========================= */
  builder.defineCatalogHandler(async ({ id, extra }) => {
    try {
      const ctx = getSiteEngine(id);
      if (!ctx) return { metas: [] };

      const { site, engine: siteEngine } = ctx;
      
	  // VIP / iDrama
      if ((id === "vip" || id === "idrama") && extra?.genre) {
        const baseGenreUrl = site.genreUrls?.[extra.genre];
        if (!baseGenreUrl) return { metas: [] };

        const pageSize = site.pageSize || 30;
        const skip = Number(extra?.skip || 0);
        const page = Math.floor(skip / pageSize) + 1;

        const genreBase = String(baseGenreUrl).replace(/\/$/, "");
        const url = page === 1
          ? `${genreBase}/`
          : `${genreBase}/page/${page}/`;

        const items = await siteEngine.getCatalogItems(id, site, url);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(items, type) };
      }

      // KhmetTv
      if (id === "khmertv") {
        const skip = Number(extra?.skip || 0);
        if (skip > 0) return { metas: [] };

        const items = await siteEngine.getCatalogItems(id, site, "");
        return { metas: mapMetas(items, "channel") };
      }
	  
	  // KhmerAve / Merlkon
      if ((id === "khmerave" || id === "merlkon") && extra?.genre) {
        const baseGenreUrl = site.genreUrls?.[extra.genre];
        if (!baseGenreUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = site.pageSize || 18;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        const genreBase = String(baseGenreUrl).replace(/\/$/, "");
        const pages = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
          const url = p === 1
            ? `${genreBase}/`
            : `${genreBase}/page/${p}/`;

          pages.push(siteEngine.getCatalogItems(id, site, url));
        }

        const results = await Promise.all(pages);
        const allItems = results.flat();
        const uniq = uniqById(allItems);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }	  
	  
      if (extra?.search && (id === "khmerave" || id === "merlkon")) {
        const keyword = encodeURIComponent(extra.search);

        const url = id === "merlkon"
          ? `https://www.khmerdrama.com/?s=${keyword}`
          : `https://www.khmeravenue.com/?s=${keyword}`;

        const items = await siteEngine.getCatalogItems(id, site, url);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(items, type) };
      }

      if (id === "khmerave" || id === "merlkon") {
        const WEBSITE_PAGE_SIZE = site.pageSize || 18;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const startPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pages = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
          const url = p === 1
            ? `${base}/`
            : `${base}/page/${p}/`;

          pages.push(siteEngine.getCatalogItems(id, site, url));
        }

        const results = await Promise.all(pages);
        const allItems = results.flat();
        const uniq = uniqById(allItems);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }
	  
	  // Sunday
      if (id === "sunday" && extra?.genre) {
        const startUrl = site.genreUrls?.[extra.genre];
        if (!startUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = 30;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);

          const older =
            $("a.blog-pager-older-link").attr("href") ||
            $("#Blog1_blog-pager-older-link").attr("href") ||
            "";

          url = older ? older : null;
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);

          const articles = $("article.blog-post").toArray();

          for (const el of articles) {
            const $el = $(el);

            const aImg = $el.find("a.entry-image-wrap").first();
            const link = aImg.attr("href") || $el.find("h2.entry-title a").attr("href") || "";
            const title =
              (aImg.attr("title") || "").trim() ||
              ($el.find("h2.entry-title a").first().text() || "").trim();

            if (!title || !link) continue;

            const img =
              $el.find("img.entry-thumb").attr("src") ||
              aImg.find("span[data-src]").attr("data-src") ||
              aImg.find("img").attr("src") ||
              "";

            allItems.push({
              id: `sunday:${encodeURIComponent(link)}`,
              name: title,
              poster: normalizePoster(img),
            });
          }

          const older =
            $("a.blog-pager-older-link").attr("href") ||
            $("#Blog1_blog-pager-older-link").attr("href") ||
            "";

          url = older ? older : null;
        }

        const uniq = uniqById(allItems);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }

      if (id === "sunday") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");

        const startUrl = extra?.search
          ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=20`
          : `${base}/?max-results=20`;

        const WEBSITE_PAGE_SIZE = 20;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);

          const older =
            $("a.blog-pager-older-link").attr("href") ||
            $("#Blog1_blog-pager-older-link").attr("href") ||
            "";

          url = older ? older : null;
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);

          const articles = $("article.blog-post").toArray();

          for (const el of articles) {
            const $el = $(el);

            const aImg = $el.find("a.entry-image-wrap").first();
            const link = aImg.attr("href") || $el.find("h2.entry-title a").attr("href") || "";
            const title =
              (aImg.attr("title") || "").trim() ||
              ($el.find("h2.entry-title a").first().text() || "").trim();

            if (!title || !link) continue;

            const img =
              $el.find("img.entry-thumb").attr("src") ||
              aImg.find("span[data-src]").attr("data-src") ||
              aImg.find("img").attr("src") ||
              "";

            allItems.push({
              id: `sunday:${encodeURIComponent(link)}`,
              name: title,
              poster: normalizePoster(img),
            });
          }

          const older =
            $("a.blog-pager-older-link").attr("href") ||
            $("#Blog1_blog-pager-older-link").attr("href") ||
            "";

          url = older ? older : null;
        }

        const uniq = uniqById(allItems);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }

      // xVideos genre
      if (id === "xvideos" && extra?.genre) {
        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pageSize = site.pageSize || 27;
        const skip = Number(extra?.skip || 0);
        const page = Math.floor(skip / pageSize) + 1;

        const categoryPath = site.categoryMap?.[extra.genre];
        if (!categoryPath) return { metas: [] };

        const normalizedPath = String(categoryPath).startsWith("http")
          ? String(categoryPath).replace(/\/$/, "")
          : `${base}${String(categoryPath)}`.replace(/\/$/, "");

        const url = page === 1
          ? normalizedPath
          : normalizedPath.includes("?")
            ? `${normalizedPath}&p=${page}`
            : `${normalizedPath}/${page - 1}`;

        const items = await siteEngine.getCatalogItems(id, site, url);

        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(items, type) };
      }

      // Phumi2
      if (id === "phumi2" && extra?.genre) {
        const startUrl = site.genreUrls?.[extra.genre];
        if (!startUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = 24;
        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);

          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
        }

        const uniq = uniqById(allItems);
        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }	  
	  
      if (id === "phumi2" || id === "cat3movie" || id === "xvideos") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");

        const startUrl = extra?.search
          ? id === "cat3movie"
            ? `${base}/?s=${encodeURIComponent(extra.search)}`
            : id === "xvideos"
              ? `${base}/?k=${encodeURIComponent(extra.search)}`
              : `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=12`
          : id === "cat3movie"
            ? `${base}/`
            : id === "xvideos"
              ? `${base}/`
              : `${base}/?max-results=12`;

        const WEBSITE_PAGE_SIZE =
          site.pageSize || (id === "cat3movie" ? 40 : id === "xvideos" ? 27 : 12);

        const PAGES_PER_BATCH = 3;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
          currentPage++;
        }

        for (let i = 0; i < PAGES_PER_BATCH && url; i++) {
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);

          const { data } = await axiosClient.get(url, { headers });
          url = siteEngine.getNextPageUrl(base, data);
        }

        const uniq = uniqById(allItems);
        const type = SITE_TYPES[id] || SITE_TYPES.default;
        return { metas: mapMetas(uniq, type) };
      }

      const pageSize = site.pageSize || 30;
      const skip = Number(extra?.skip || 0);
      const page = Math.floor(skip / pageSize) + 1;

      const base = String(site.baseUrl || "").replace(/\/$/, "");

      const url = extra?.search
        ? `${base}/?s=${encodeURIComponent(extra.search)}`
        : page === 1
          ? `${base}/`
          : `${base}/page/${page}/`;

      const items = await siteEngine.getCatalogItems(id, site, url);

      const type = SITE_TYPES[id] || SITE_TYPES.default;
      return { metas: mapMetas(items, type) };

    } catch (e) {
      console.error("catalog error:", e);
      return { metas: [] };
    }
  });
};