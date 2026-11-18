const fs = require('node:fs');
const path = require('node:path');

const KEEP_LOCALES = new Set(['es.pak', 'es-419.pak', 'en-US.pak']);

async function afterPack(context) {
  const appOutDir = context && context.appOutDir;
  if (!appOutDir) return;

  const localesDir = path.join(appOutDir, 'locales');
  if (fs.existsSync(localesDir)) {
    for (const file of fs.readdirSync(localesDir)) {
      if (file.endsWith('.pak') && !KEEP_LOCALES.has(file)) {
        fs.unlinkSync(path.join(localesDir, file));
      }
    }
  }

  const licensesFile = path.join(appOutDir, 'LICENSES.chromium.html');
  if (fs.existsSync(licensesFile)) {
    fs.unlinkSync(licensesFile);
  }
}

module.exports = afterPack;
module.exports.default = afterPack;
