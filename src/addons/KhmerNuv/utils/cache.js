const URL_TO_POSTID = new Map();
const POST_INFO = new Map();
const URL_CACHE = new Map();
const EP_CACHE = new Map();
const CATALOG_CACHE = new Map();

const BLOG_IDS = Object.freeze({
  TVSABAY: "8016412028548971199",
  ONELEGEND: "596013908374331296",
  KOLAB: "7770980406614294729",
  SUNDAY1: "7871281676618369095",
  SUNDAY2: "596013908374331296",
  SUNDAY3: "3148232187236550259",
  SUNDAY4: "3556626157575058125"
});

function getMaxEpFromSeriesPage(postId) {
  const data = POST_INFO.get(postId);
  return Number.isInteger(data?.maxEp) ? data.maxEp : null;
}

module.exports = {
  URL_TO_POSTID,
  POST_INFO,
  BLOG_IDS,
  getMaxEpFromSeriesPage,
  URL_CACHE,
  EP_CACHE,
  CATALOG_CACHE
};