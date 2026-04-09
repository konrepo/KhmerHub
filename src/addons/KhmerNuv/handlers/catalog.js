const { PAGE_TRACKER, PAGE_URL_CACHE } = require("../utils/cache");

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

  builder.defineCatalogHandler(async ({ id, extra = {} }) => {
    try {
      const ctx = getSiteEngine(id);
      if (!ctx) return { metas: [] };

      const { site, engine: siteEngine } = ctx;
      const type = SITE_TYPES[id] || SITE_TYPES.default;

      // KhmerTV
      if (id === "khmertv") {
        const skip = Number(extra?.skip || 0);
        if (skip > 0) return { metas: [] };

        const items = await siteEngine.getCatalogItems(id, site, "");
        return { metas: mapMetas(items, "channel") };
      }

      // KhmerAve / Merlkon genre paging
      if ((id === "khmerave" || id === "merlkon") && extra?.genre) {
        const baseGenreUrl = site.genreUrls?.[extra.genre];
        if (!baseGenreUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = site.pageSize || 18;
        const PAGES_PER_BATCH = 2;
        const SKIP_STEP = 300;

        const skip = Number(extra?.skip || 0);
        const startPage =
          Math.floor(skip / SKIP_STEP) * PAGES_PER_BATCH + 1;

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

        if (!allItems.length) return { metas: [] };

        const uniq = uniqById(allItems);

        return {
          metas: mapMetas(
            uniq.slice(0, WEBSITE_PAGE_SIZE * PAGES_PER_BATCH),
            type
          )
        };
      }

      // KhmerAve / Merlkon search
      if (extra?.search && (id === "khmerave" || id === "merlkon")) {
        const keyword = encodeURIComponent(extra.search);

        const url = id === "merlkon"
          ? `https://www.khmerdrama.com/?s=${keyword}`
          : `https://www.khmeravenue.com/?s=${keyword}`;

        const items = await siteEngine.getCatalogItems(id, site, url);
        return { metas: mapMetas(items, type) };
      }

      // KhmerAve / Merlkon paging
      if (id === "khmerave" || id === "merlkon") {
        const WEBSITE_PAGE_SIZE = site.pageSize || 18;
        const PAGES_PER_BATCH = 2;
        const SKIP_STEP = 300;

        const skip = Number(extra?.skip || 0);
        const startPage =
          Math.floor(skip / SKIP_STEP) * PAGES_PER_BATCH + 1;

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const pages = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
          const url = p === 1 ? `${base}/` : `${base}/page/${p}/`;
          pages.push(siteEngine.getCatalogItems(id, site, url));
        }

        const results = await Promise.all(pages);
        const allItems = results.flat();

        if (!allItems.length) return { metas: [] };

        const uniq = uniqById(allItems);

        return {
          metas: mapMetas(
            uniq.slice(0, WEBSITE_PAGE_SIZE * PAGES_PER_BATCH),
            type
          )
        };
      }

      // SundayDrama genre paging
      if (id === "sunday" && extra?.genre) {
        let url = site.genreUrls?.[extra.genre];
        if (!url) return { metas: [] };

        const skip = Number(extra?.skip || 0);
        const SKIP_STEP = 100;
        const steps = Math.floor(skip / SKIP_STEP);

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
          Referer: `${base}/`,
          Accept: "text/html"
        };

        for (let i = 0; i < steps && url; i++) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);

          const older =
            $("a.blog-pager-older-link").attr("href") ||
            $("#Blog1_blog-pager-older-link").attr("href") ||
            "";

          url = older ? older : null;
        }

        let allItems = [];

        if (url) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);
          const articles = $("article.blog-post").toArray();

          for (const el of articles) {
            const $el = $(el);

            const aImg = $el.find("a.entry-image-wrap").first();
            const link =
              aImg.attr("href") ||
              $el.find("h2.entry-title a").attr("href") ||
              "";

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
        }

        const uniq = uniqById(allItems);
        return { metas: mapMetas(uniq, type) };
      }

      // SundayDrama search + paging
      if (id === "sunday") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");

        let url = extra?.search
          ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=20&m=1`
          : `${base}/?max-results=20&m=1`;

        const skip = Number(extra?.skip || 0);
        const SKIP_STEP = 100;
        const steps = Math.floor(skip / SKIP_STEP);

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10) AppleWebKit/537.36 Chrome/120 Mobile Safari/537.36",
          Referer: `${base}/`,
          Accept: "text/html"
        };

        for (let i = 0; i < steps && url; i++) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);

          const older =
            $("a.blog-pager-older-link").attr("href") ||
            $("#Blog1_blog-pager-older-link").attr("href") ||
            "";

          url = older ? older : null;
        }

        let allItems = [];

        if (url) {
          const { data } = await axiosClient.get(url, { headers });
          const $ = cheerio.load(data);
          const articles = $("article.blog-post").toArray();

          for (const el of articles) {
            const $el = $(el);

            const aImg = $el.find("a.entry-image-wrap").first();
            const link =
              aImg.attr("href") ||
              $el.find("h2.entry-title a").attr("href") ||
              "";

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
        }

        const uniq = uniqById(allItems);
        return { metas: mapMetas(uniq, type) };
      }

      // Phumi2 genre paging
      if (id === "phumi2" && extra?.genre) {
        const startUrl = site.genreUrls?.[extra.genre];
        if (!startUrl) return { metas: [] };

        const skip = Number(extra?.skip || 0);
        const WEBSITE_PAGE_SIZE = site.pageSize || 12;
        const rawTargetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        const pageKeyBase = `phumi2:${id}:${extra?.search || ""}:${extra?.genre || ""}`;
        const lastPage = PAGE_TRACKER.get(pageKeyBase) || 1;

        const targetPage =
          rawTargetPage > lastPage + 1
            ? lastPage + 1
            : rawTargetPage;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        let resumePage = 1;

        for (let p = targetPage; p >= 1; p--) {
          const cachedUrl = PAGE_URL_CACHE.get(`${pageKeyBase}:page:${p}`);
          if (cachedUrl) {
            url = cachedUrl;
            resumePage = p;
            break;
          }
        }

        currentPage = resumePage;

        if (!PAGE_URL_CACHE.has(`${pageKeyBase}:page:1`)) {
          PAGE_URL_CACHE.set(`${pageKeyBase}:page:1`, startUrl);
        }

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          const nextUrl = siteEngine.getNextPageUrl(base, data);

          if (nextUrl) {
            PAGE_URL_CACHE.set(`${pageKeyBase}:page:${currentPage + 1}`, nextUrl);
          }

          url = nextUrl;
          currentPage++;
        }

        if (url) {
          PAGE_URL_CACHE.set(`${pageKeyBase}:page:${targetPage}`, url);
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);
        }

        const uniq = uniqById(allItems);
        PAGE_TRACKER.set(pageKeyBase, targetPage);

        return { metas: mapMetas(uniq, type) };
      }

      // Phumi2 search + paging
      if (id === "phumi2") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");

        const startUrl = extra?.search
          ? `${base}/search?q=${encodeURIComponent(extra.search)}&max-results=12`
          : `${base}/?max-results=12`;

        const WEBSITE_PAGE_SIZE = site.pageSize || 12;

        const skip = Number(extra?.skip || 0);
        const rawTargetPage = Math.floor(skip / WEBSITE_PAGE_SIZE) + 1;

        const pageKeyBase = `phumi2:${id}:${extra?.search || ""}`;
        const lastPage = PAGE_TRACKER.get(pageKeyBase) || 1;

        const targetPage =
          rawTargetPage > lastPage + 1
            ? lastPage + 1
            : rawTargetPage;

        let url = startUrl;
        let currentPage = 1;
        let allItems = [];

        const headers = {
          "User-Agent":
            "Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/137.0.0.0 Mobile Safari/537.36",
          Referer: `${base}/`,
        };

        let resumePage = 1;

        for (let p = targetPage; p >= 1; p--) {
          const cachedUrl = PAGE_URL_CACHE.get(`${pageKeyBase}:page:${p}`);
          if (cachedUrl) {
            url = cachedUrl;
            resumePage = p;
            break;
          }
        }

        currentPage = resumePage;

        if (!PAGE_URL_CACHE.has(`${pageKeyBase}:page:1`)) {
          PAGE_URL_CACHE.set(`${pageKeyBase}:page:1`, startUrl);
        }

        while (currentPage < targetPage && url) {
          const { data } = await axiosClient.get(url, { headers });
          const nextUrl = siteEngine.getNextPageUrl(base, data);

          if (nextUrl) {
            PAGE_URL_CACHE.set(`${pageKeyBase}:page:${currentPage + 1}`, nextUrl);
          }

          url = nextUrl;
          currentPage++;
        }

        if (url) {
          PAGE_URL_CACHE.set(`${pageKeyBase}:page:${targetPage}`, url);
          const items = await siteEngine.getCatalogItems(id, site, url);
          allItems.push(...items);
        }

        const uniq = uniqById(allItems);
        PAGE_TRACKER.set(pageKeyBase, targetPage);

        return { metas: mapMetas(uniq, type) };
      }

      // Cat3Movie paging
      if (id === "cat3movie") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const SKIP_STEP = 100;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / SKIP_STEP) + 1;

        const url = extra?.search
          ? targetPage === 1
            ? `${base}/?s=${encodeURIComponent(extra.search)}`
            : `${base}/page/${targetPage}/?s=${encodeURIComponent(extra.search)}`
          : targetPage === 1
            ? `${base}/`
            : `${base}/page/${targetPage}/`;

        const items = await siteEngine.getCatalogItems(id, site, url);
        if (!items.length) return { metas: [] };

        return { metas: mapMetas(items, "movie") };
      }

      // xVideos paging
      if (id === "xvideos") {
        const base = String(site.baseUrl || "").replace(/\/$/, "");
        const SKIP_STEP = 100;

        const skip = Number(extra?.skip || 0);
        const targetPage = Math.floor(skip / SKIP_STEP) + 1;

        let url;

        if (extra?.search) {
          url = targetPage === 1
            ? `${base}/?k=${encodeURIComponent(extra.search)}`
            : `${base}/?k=${encodeURIComponent(extra.search)}&p=${targetPage}`;
        } else {
          url = targetPage === 1
            ? `${base}/`
            : `${base}/new/${targetPage - 1}`;
        }

        const items = await siteEngine.getCatalogItems(id, site, url);
        if (!items.length) return { metas: [] };

        return { metas: mapMetas(items, "movie") };
      }

      // VIP / iDrama genre paging
      if ((id === "vip" || id === "idrama") && extra?.genre) {
        const baseGenreUrl = site.genreUrls?.[extra.genre];
        if (!baseGenreUrl) return { metas: [] };

        const WEBSITE_PAGE_SIZE = site.pageSize || 30;
        const PAGES_PER_BATCH = 2;
        const SKIP_STEP = 200;

        const skip = Number(extra?.skip || 0);
        const startPage =
          Math.floor(skip / SKIP_STEP) * PAGES_PER_BATCH + 1;

        const genreBase = String(baseGenreUrl).replace(/\/$/, "");
        const pages = [];

        for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
          const url = p === 1 ? `${genreBase}/` : `${genreBase}/page/${p}/`;
          pages.push(siteEngine.getCatalogItems(id, site, url));
        }

        const results = await Promise.all(pages);
        const allItems = results.flat();

        if (!allItems.length) return { metas: [] };

        const uniq = uniqById(allItems);

        return {
          metas: mapMetas(
            uniq.slice(0, WEBSITE_PAGE_SIZE * PAGES_PER_BATCH),
            type
          )
        };
      }

      // VIP / iDrama normal paging
      const WEBSITE_PAGE_SIZE = site.pageSize || 30;
      const PAGES_PER_BATCH = 2;
      const SKIP_STEP = 200;

      const skip = Number(extra?.skip || 0);
      const startPage =
        Math.floor(skip / SKIP_STEP) * PAGES_PER_BATCH + 1;

      const base = String(site.baseUrl || "").replace(/\/$/, "");
      const pages = [];

      for (let p = startPage; p < startPage + PAGES_PER_BATCH; p++) {
        const url = p === 1 ? `${base}/` : `${base}/page/${p}/`;
        pages.push(siteEngine.getCatalogItems(id, site, url));
      }

      const results = await Promise.all(pages);
      const allItems = results.flat();

      if (!allItems.length) return { metas: [] };

      const uniq = uniqById(allItems);

      return {
        metas: mapMetas(
          uniq.slice(0, WEBSITE_PAGE_SIZE * PAGES_PER_BATCH),
          type
        )
      };

    } catch (e) {
      console.error("catalog error:", e);
      return { metas: [] };
    }
  });
};