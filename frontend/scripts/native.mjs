import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) throw new Error('Choose android or ios.');
if (platform === 'ios' && process.platform !== 'darwin') throw new Error('iOS generation requires macOS.');

function cap(...args) {
  const command = spawnSync(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', ...args], { stdio: 'inherit' });
  if (command.error || command.status !== 0) throw command.error || new Error('Capacitor command failed.');
}

if (!existsSync(platform)) {
  cap('add', platform, ...(platform === 'ios' ? ['--packagemanager', 'SPM'] : []));
}
cap('sync', platform);

const icon = readFileSync('public/mark.svg', 'utf8').replace(' rx="16"', '');
if (platform === 'android') {
  const gradle = 'android/app/build.gradle';
  const build = readFileSync(gradle, 'utf8')
    .replace(/^\s*versionCode 1$/m, '\n        versionCode((project.findProperty("bankVersionCode") ?: "1").toInteger())')
    .replace(/^\s*versionName "1.0"$/m, '\n        versionName(project.findProperty("bankVersion") ?: "1.0.0")');
  if (!build.includes('bankVersionCode')) throw new Error('Android version configuration was not applied.');
  writeFileSync(gradle, build);
  const resources = 'android/app/src/main/res';
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(densities)) {
    for (const name of ['ic_launcher', 'ic_launcher_round', 'ic_launcher_foreground']) {
      const file = `${resources}/mipmap-${density}/${name}.png`;
      if (existsSync(file)) await sharp(Buffer.from(icon)).resize(size, size).png().toFile(file);
    }
  }
  for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const path = `${resources}/mipmap-anydpi-v26/${file}`;
    if (existsSync(path)) {
      writeFileSync(path, readFileSync(path, 'utf8').replace(/@drawable\/ic_launcher_background/g, '@color/bank_launcher_background'));
    }
  }
  writeFileSync(`${resources}/values/bank.xml`, '<resources><color name="bank_launcher_background">#132a57</color></resources>\n');
} else {
  const folder = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  for (const file of readdirSync(folder).filter(name => name.endsWith('.png'))) {
    const path = `${folder}/${file}`;
    const { width, height } = await sharp(path).metadata();
    await sharp(Buffer.from(icon)).resize(width, height).removeAlpha().png().toFile(path);
  }
}

