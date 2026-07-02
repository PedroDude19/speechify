const Jimp = require('jimp');
const fs = require('fs');
const path = require('path');

async function createIcon(size, filename) {
  const image = new Jimp(size, size, 0x00000000);
  const centerX = size / 2;
  const centerY = size / 2;
  const radius = size * 0.46;
  
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - centerX;
      const dy = y - centerY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      
      if (dist <= radius) {
        const ratio = (x + (size - y)) / (size * 2);
        const r = Math.round(123 + ratio * (58 - 123));
        const g = Math.round(44 + ratio * (134 - 44));
        const b = Math.round(191 + ratio * (200 - 191));
        
        const barWidth = Math.max(1, Math.round(0.06 * size));
        const spacing = Math.round(0.12 * size);
        
        let isWave = false;
        const waveHeights = [0.25, 0.50, 0.70, 0.50, 0.25];
        const numWaves = waveHeights.length;
        
        for (let i = 0; i < numWaves; i++) {
          const waveX = centerX + (i - (numWaves - 1) / 2) * spacing;
          const height = waveHeights[i] * size * 0.8;
          if (Math.abs(x - waveX) < barWidth / 2 && Math.abs(y - centerY) < height / 2) {
            const capRadius = barWidth / 2;
            const distToTopCap = Math.sqrt((x - waveX) ** 2 + (y - (centerY - height / 2)) ** 2);
            const distToBottomCap = Math.sqrt((x - waveX) ** 2 + (y - (centerY + height / 2)) ** 2);
            
            if (Math.abs(y - centerY) <= height / 2 || distToTopCap <= capRadius || distToBottomCap <= capRadius) {
              isWave = true;
              break;
            }
          }
        }
        
        if (isWave) {
          image.setPixelColor(Jimp.rgbaToInt(255, 255, 255, 255), x, y);
        } else {
          const borderProximity = dist / radius;
          const alpha = borderProximity > 0.95 
            ? Math.round(255 * (1 - (borderProximity - 0.95) / 0.05)) 
            : 255;
          image.setPixelColor(Jimp.rgbaToInt(r, g, b, alpha), x, y);
        }
      }
    }
  }
  
  await image.writeAsync(filename);
  console.log(`Saved ${filename}`);
}

async function main() {
  const iconsDir = path.join(__dirname, 'icons');
  if (!fs.existsSync(iconsDir)) {
    fs.mkdirSync(iconsDir);
  }
  await createIcon(16, path.join(iconsDir, 'icon16.png'));
  await createIcon(48, path.join(iconsDir, 'icon48.png'));
  await createIcon(128, path.join(iconsDir, 'icon128.png'));
}

main().catch(console.error);
