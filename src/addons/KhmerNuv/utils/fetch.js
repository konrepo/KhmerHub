const axios = require("axios");
const http = require("http");
const https = require("https");

const USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120 Safari/537.36";

const axiosClient = axios.create({
  timeout: 20000,
  maxRedirects: 5,
  httpAgent: new http.Agent({ keepAlive: true }),
  httpsAgent: new https.Agent({ keepAlive: true }),
  headers: {
    "User-Agent": USER_AGENT,
    "Accept":
      "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9"
  }
});

// Debug interceptor
axiosClient.interceptors.response.use(
  res => res,
  err => {
    if (err.response && err.response.status !== 404) {
      console.error("HTTP Error:", err.response.status, err.config?.url);
  }
    return Promise.reject(err);
  }
);

module.exports = axiosClient;