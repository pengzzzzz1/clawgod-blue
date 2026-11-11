const { applyLeanSettings } = require('../shared/lean-settings.cjs');
applyLeanSettings(process.argv[2], 'off', process.argv[3]);
