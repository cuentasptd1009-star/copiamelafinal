'use strict';
const { app, ready } = require('../../artifacts/api-server/dist/vercel.js');

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
