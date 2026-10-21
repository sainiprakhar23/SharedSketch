const fs = require('fs');
const path = require('path');

const srcDir = path.join(__dirname, '..', 'client');
const destDir = path.join(__dirname, '..', 'server', 'public');

if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
}

const files = fs.readdirSync(srcDir);
files.forEach((file) => {
    const srcPath = path.join(srcDir, file);
    const destPath = path.join(destDir, file);
    const stat = fs.statSync(srcPath);
    if (stat.isFile()) {
        fs.copyFileSync(srcPath, destPath);
        console.log(`Synced: client/${file} -> server/public/${file}`);
    }
});
console.log('Asset synchronization complete.');
