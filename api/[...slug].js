'use strict';
const path = require('path');
// Load the compiled Express app for Vercel serverless
const { app, ready } = require('../artifacts/api-server/dist/vercel.js');

module.exports = async (req, res) => {
  await ready;
  return app(req, res);
};
