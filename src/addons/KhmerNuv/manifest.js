const EXTRA = ["search", "skip"];

const sites = [
  { id: "khmertv", name: "KhmerTV", type: "movie", enabled: true },
  { id: "vip", name: "PhumiVip", type: "series", enabled: true },
  { id: "sunday", name: "SundayDrama", type: "series", enabled: true },
  { id: "phumi2", name: "PhumiClub", type: "series", enabled: true },
  { id: "khmerave", name: "KhmerAve", type: "series", enabled: true },
  { id: "merlkon", name: "Merlkon", type: "series", enabled: true },
  { id: "idrama", name: "iDramaHD", type: "series", enabled: true },
  { id: "cat3movie", name: "Cat3Movie", type: "movie", enabled: false } // disabled
];

const enabled = sites.filter(site => site.enabled !== false);

module.exports = {
  id: "community.khmer.nuvio",
  version: "4.1.0",
  name: "KhmerNuv",
  description: "Stream Asian dramas dubbed in Khmer (Nuvio App) | By: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",

  resources: ["catalog", "meta", "stream"],
  types: ["series", "movie"],

  idPrefixes: enabled.map(s => s.id),

  catalogs: enabled.map(site => ({
    type: site.type,
    id: site.id,
    name: site.name,
    extraSupported: EXTRA
  })),

  behaviorHints: {
    configurable: false
  }
};