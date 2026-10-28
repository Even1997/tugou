// Packaged applications dispatch migration helpers before acquiring the app lock.
if(process.argv.includes('--tugou-key-reader')) require('./core/legacy-connection-reader.cjs');
else if(process.argv.includes('--tugou-canvas-reader')) require('./core/legacy-canvas-reader.cjs');
else require('./desktop-main.cjs');
