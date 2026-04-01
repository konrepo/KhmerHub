const EXTRA = ["search", "skip"];

const sites = [
  { id: "vip", name: "PhumiVip", type: "series" },
  { id: "sunday", name: "SundayDrama", type: "series" },
  { id: "phumi2", name: "PhumiClub", type: "series" },
  { id: "khmerave", name: "KhmerAve", type: "series" },
  { id: "merlkon", name: "Merlkon", type: "series" },
  { id: "idrama", name: "iDramaHD", type: "series" },
  { id: "cat3movie", name: "Cat3Movie", type: "movie" }
];

module.exports = {
  id: "community.khmer.nuvio",
  version: "4.1.0",
  name: "KhmerNuv",
  description: "Stream Asian dramas dubbed in Khmer (Nuvio App) | By: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",

  resources: ["catalog", "meta", "stream"],
  types: ["series", "movie"],
  idPrefixes: sites.map((s) => s.id),

  catalogs: sites.map((site) => ({
    type: site.type,
    id: site.id,
    name: site.name,
    extraSupported: EXTRA
  })),

  behaviorHints: {
    configurable: false
  }
};