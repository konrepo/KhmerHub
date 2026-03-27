const express = require("express");
const { getRouter } = require("stremio-addon-sdk");

const khmerDubAddon = require("./addons/KhmerDub");
const khmerNuvAddon = require("./addons/KhmerNuv");

const app = express();
const port = process.env.PORT || 7000;

app.get("/", (req, res) => {
  res.send("KhmerHub is running");
});

app.use("/khmerdub", getRouter(khmerDubAddon));
app.use("/khmernuv", getRouter(khmerNuvAddon));

app.listen(port, () => {
  console.log("KhmerHub running on port", port);
  console.log(`KhmerDub:  http://127.0.0.1:${port}/khmerdub/manifest.json`);
  console.log(`KhmerNuv:  http://127.0.0.1:${port}/khmernuv/manifest.json`);
});