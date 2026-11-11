const { applyLeanSettings } = require('../shared/lean-settings.cjs');
applyLeanSettings(process.argv[2], process.argv[3]?.toLowerCase() === 'true' ? 'max' : 'on', process.argv[4]);
