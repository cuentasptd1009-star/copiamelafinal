'use strict';
const path = require('path');
const { pathToFileURL } = require('url');
let _mod;
async function load() {
  if (!_mod) {
    const p = path.resolve(__dirname, '../artifacts/api-server/dist/vercel.mjs');
    _mod = await import(pathToFileURL(p).href);
  }
  return _mod;
}
module.exports = async (req, res) => {
  const { app, ready } = await load();
  if (ready) await ready;
  return app(req, res);
};
