const TYPES = ["series", "movie", "channel"];
const EXTRA = ["search", "skip"];
const config = require("./sites/config");

const sites = [
  { id: "khmertv", name: "KhmerTV", type: "channel", enabled: true }, 
  { id: "vip", name: "PhumiVip", type: "series", enabled: true },
  { id: "sunday", name: "SundayDrama", type: "series", enabled: true },
  { id: "phumi2", name: "PhumiClub", type: "series", enabled: true },
  { id: "khmerave", name: "KhmerAve", type: "series", enabled: true },
  { id: "merlkon", name: "Merlkon", type: "series", enabled: true },
  { id: "idrama", name: "iDramaHD", type: "series", enabled: true }, 
  { id: "cat3movie", name: "Cat3Movie", type: "movie", enabled: false },
  { id: "xvideos", name: "xvideos", type: "movie", enabled: false }  
];

module.exports = {
  id: "community.khmer.nuvio",
  version: "4.5.0",
  name: "KhmerNuv",
  description: "Stream Asian dramas dubbed in Khmer (Nuvio App) | By: TheDevilz.",
  logo: "https://avatars.githubusercontent.com/u/32822347?v=4",

  resources: ["catalog", "meta", "stream"],
  types: TYPES,

  catalogs: sites
    .filter(site => site.enabled !== false)
    .map(site => {
      if (site.id === "vip" || site.id === "idrama" || site.id === "sunday") {
        return {
          type: site.type,
          id: site.id,
          name: site.name,
          extra: [
            { name: "search", isRequired: false },
            { name: "skip", isRequired: false },
            { name: "genre", isRequired: false, options: ["Thai", "China", "Korean"] }
          ]
        };
      }

      if (site.id === "phumi2") {
        return {
          type: site.type,
          id: site.id,
          name: site.name,
          extra: [
            { name: "search", isRequired: false },
            { name: "skip", isRequired: false },
            { name: "genre", isRequired: false, options: ["Khmer", "China", "Korean"] }
          ]
        };
      }

      if (site.id === "khmerave") {
        return {
          type: site.type,
          id: site.id,
          name: site.name,
          extra: [
            { name: "search", isRequired: false },
            { name: "skip", isRequired: false },
            { name: "genre", isRequired: false, options: ["Classic", "HK", "Chinese", "Modern", "China", "Korean", "Kon"] }
          ]
        };
      }

      if (site.id === "merlkon") {
        return {
          type: site.type,
          id: site.id,
          name: site.name,
          extra: [
            { name: "search", isRequired: false },
            { name: "skip", isRequired: false },
            { name: "genre", isRequired: false, options: ["Khmer", "Thai", "Indian", "Philippines", "Boran", "Horror", "Kon"] }
          ]
        };
      }

      if (site.id === "xvideos") {
        return {
          type: site.type,
          id: site.id,
          name: site.name,
          extra: [
            { name: "search", isRequired: false },
            { name: "skip", isRequired: false },
            { name: "genre", isRequired: false, options: Object.keys(config.xvideos.categoryMap || {}) }
          ]
        };
      }

      return {
        type: site.type,
        id: site.id,
        name: site.name,
        extra: [
          { name: "search", isRequired: false },
          { name: "skip", isRequired: false }
        ]
      };
    }),

  behaviorHints: {
    configurable: false
  }

}; 