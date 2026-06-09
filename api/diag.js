'use strict';
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');

module.exports = async (req, res) => {
  try {
    const distDir = path.resolve(__dirname, '../artifacts/api-server/dist');
    const exists = fs.existsSync(distDir);
    const files = exists ? fs.readdirSync(distDir) : [];
    const vercelMjs = path.resolve(distDir, 'vercel.mjs');
    const mExists = fs.existsSync(vercelMjs);
    
    // Try to import
    let importError = null;
    try {
      const mod = await import(pathToFileURL(vercelMjs).href);
      const { app, ready } = mod;
      if (ready) await ready;
      return app(req, res);
    } catch(e) {
      importError = { message: e.message, code: e.code, stack: e.stack?.split('\n').slice(0,5) };
    }
    
    res.status(500).json({ distDir, exists, files, mExists, importError });
  } catch(e) {
    res.status(500).json({ fatal: e.message, stack: e.stack?.split('\n').slice(0,5) });
  }
};
