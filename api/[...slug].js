'use strict';
let _mod;
async function load() {
  if (!_mod) _mod = await import('../artifacts/api-server/dist/vercel.mjs');
  return _mod;
}
module.exports = async (req, res) => {
  const { app, ready } = await load();
  if (ready) await ready;
  return app(req, res);
};
