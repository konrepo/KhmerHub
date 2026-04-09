const URL_TO_POSTID = new Map(); // seriesUrl -> postId
const POST_INFO = new Map();     // postId -> { maxEp?, detail?, sourceType?, pageHtml?, playerPostId?, wpPostId? }

const BLOG_IDS = {
  TVSABAY: "8016412028548971199",
  ONELEGEND: "596013908374331296",
  KOLAB: "7770980406614294729",

  SUNDAY1: "7871281676618369095",
  SUNDAY2: "596013908374331296",
  SUNDAY3: "3148232187236550259",
  SUNDAY4: "3556626157575058125"
};

function getMaxEpFromSeriesPage(postId) {
  return POST_INFO.get(postId)?.maxEp || null;
}

module.exports = {
  URL_TO_POSTID,
  POST_INFO,
  BLOG_IDS,
  getMaxEpFromSeriesPage
};

