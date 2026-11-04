import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import sharp from 'sharp';

if (existsSync('.env')) process.loadEnvFile('.env');
const platform = process.argv[2];
if (!['android', 'ios'].includes(platform)) throw new Error('Choose android or ios.');
if (platform === 'ios' && process.platform !== 'darwin') throw new Error('iOS generation requires macOS.');

function cap(...args) {
  const command = spawnSync(process.execPath, ['node_modules/@capacitor/cli/bin/capacitor', ...args], { stdio: 'inherit' });
  if (command.error || command.status !== 0) throw command.error || new Error('Capacitor command failed.');
}

if (!existsSync(platform)) {
  cap('add', platform);
}
cap('sync', platform);

const icon = readFileSync('public/mark.svg');
if (platform === 'android') {
  const variablesPath = 'android/variables.gradle';
  let variables = readFileSync(variablesPath, 'utf8');
  variables = variables.replace(/minSdkVersion\s*=\s*(\d+)/, (_, version) => `minSdkVersion = ${Math.max(26, Number(version))}`);
  if (!/minSdkVersion\s*=\s*(?:2[6-9]|[3-9]\d)/.test(variables)) throw new Error('QR scanner requires Android API 26 or newer.');
  writeFileSync(variablesPath, variables);
  // Align the plugin's compile-only browser dependency and Google's runtime helper
  // on a version compatible with the Capacitor 7 Android SDK and Gradle plugin.
  const rootGradlePath = 'android/build.gradle';
  let rootGradle = readFileSync(rootGradlePath, 'utf8');
  rootGradle = rootGradle.replace("resolutionStrategy.force 'androidx.browser:browser:1.9.0'", "resolutionStrategy.force 'androidx.browser:browser:1.8.0'");
  const browserConstraint = "resolutionStrategy.force 'androidx.browser:browser:1.8.0'";
  if (!rootGradle.includes(browserConstraint)) {
    rootGradle += `\nsubprojects { configurations.configureEach { ${browserConstraint} } }\n`;
  }
  writeFileSync(rootGradlePath, rootGradle);
  const manifestPath = 'android/app/src/main/AndroidManifest.xml';
  let manifest = readFileSync(manifestPath, 'utf8');
  if (!manifest.includes('android.permission.CAMERA')) {
    if (!manifest.includes('</manifest>')) throw new Error('Android manifest is missing its closing tag.');
    manifest = manifest.replace(
      '</manifest>',
      '    <uses-permission android:name="android.permission.CAMERA" />\n' +
        '    <uses-feature android:name="android.hardware.camera.any" android:required="false" />\n</manifest>',
    );
    writeFileSync(manifestPath, manifest);
  }
  const gradle = 'android/app/build.gradle';
  const build = readFileSync(gradle, 'utf8')
    .replace(/^\s*versionCode 1$/m, '\n        versionCode((project.findProperty("bankVersionCode") ?: "1").toInteger())')
    .replace(/^\s*versionName "1.0"$/m, '\n        versionName(project.findProperty("bankVersion") ?: "1.0.0")');
  if (!build.includes('bankVersionCode')) throw new Error('Android version configuration was not applied.');
  writeFileSync(gradle, build);
  const resources = 'android/app/src/main/res';
  const densities = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [density, size] of Object.entries(densities)) {
    for (const name of ['ic_launcher', 'ic_launcher_round']) {
      const file = `${resources}/mipmap-${density}/${name}.png`;
      if (existsSync(file)) await sharp(icon).resize(size, size).png().toFile(file);
    }
    // Adaptive foregrounds use a 108dp canvas with artwork inside the 66dp safe zone.
    const canvasSize = Math.round(size * 108 / 48);
    const artworkSize = Math.round(size * 66 / 48);
    const artwork = await sharp(icon).resize(artworkSize, artworkSize).png().toBuffer();
    await sharp({
      create: { width: canvasSize, height: canvasSize, channels: 4, background: '#00000000' },
    }).composite([{ input: artwork, gravity: 'centre' }]).png()
      .toFile(`${resources}/mipmap-${density}/ic_launcher_foreground.png`);
  }
  for (const file of ['ic_launcher.xml', 'ic_launcher_round.xml']) {
    const path = `${resources}/mipmap-anydpi-v26/${file}`;
    if (existsSync(path)) {
      writeFileSync(path, readFileSync(path, 'utf8')
        .replace(/@(?:drawable|color)\/ic_launcher_background/g, '@color/bank_launcher_background'));
    }
  }
  writeFileSync(`${resources}/values/bank.xml`, '<resources><color name="bank_launcher_background">#132a57</color></resources>\n');
} else {
  writeFileSync('ios/App/App/PrivacyInfo.xcprivacy', `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict><key>NSPrivacyAccessedAPITypes</key><array><dict>
<key>NSPrivacyAccessedAPIType</key><string>NSPrivacyAccessedAPICategoryFileTimestamp</string>
<key>NSPrivacyAccessedAPITypeReasons</key><array><string>C617.1</string></array>
</dict></array></dict></plist>\n`);
  const { default: xcode } = await import('xcode');
  const projectPath = 'ios/App/App.xcodeproj/project.pbxproj';
  const project = xcode.project(projectPath);
  project.parseSync();
  if (!project.hasFile('PrivacyInfo.xcprivacy')) {
    const appGroup = project.findPBXGroupKey({ path: 'App' });
    if (!appGroup) throw new Error('Could not find the iOS app resource group.');
    project.addResourceFile('PrivacyInfo.xcprivacy', { target: project.getFirstTarget().uuid }, appGroup);
    writeFileSync(projectPath, project.writeSync());
  }
  const iosClientId = process.env.PUBLIC_GOOGLE_IOS_CLIENT_ID || '';
  if (!/^[A-Za-z0-9-]+\.apps\.googleusercontent\.com$/.test(iosClientId)) {
    throw new Error('Set PUBLIC_GOOGLE_IOS_CLIENT_ID to the iOS Google OAuth client ID before building.');
  }
  const googleScheme = iosClientId.split('.').reverse().join('.');
  const plistPath = 'ios/App/App/Info.plist';
  let plist = readFileSync(plistPath, 'utf8');
  if (!plist.includes('<key>NSCameraUsageDescription</key>')) {
    if (!plist.includes('<dict>')) throw new Error('iOS Info.plist is missing its root dictionary.');
    plist = plist.replace(
      '<dict>',
      '<dict>\n\t<key>NSCameraUsageDescription</key>\n' +
        '\t<string>Allow camera access to scan an account QR code.</string>',
    );
  }
  if (!plist.includes(googleScheme)) {
    if (plist.includes('<key>CFBundleURLTypes</key>')) throw new Error('Add the Google URL scheme to the existing CFBundleURLTypes entry.');
    plist = plist.replace('<dict>', '<dict>\n\t<key>CFBundleURLTypes</key>\n\t<array><dict><key>CFBundleURLSchemes</key><array><string>' + googleScheme + '</string></array></dict></array>');
  }
  writeFileSync(plistPath, plist);
  const delegatePath = 'ios/App/App/AppDelegate.swift';
  let delegate = readFileSync(delegatePath, 'utf8');
  if (!delegate.includes('import GoogleSignIn')) delegate = delegate.replace('import Capacitor', 'import Capacitor\nimport GoogleSignIn');
  if (!delegate.includes('GIDSignIn.sharedInstance.handle(url)')) {
    const proxy = 'return ApplicationDelegateProxy.shared.application(app, open: url, options: options)';
    if (!delegate.includes(proxy)) throw new Error('Could not locate the iOS URL handler.');
    delegate = delegate.replace(proxy, 'return GIDSignIn.sharedInstance.handle(url) || ApplicationDelegateProxy.shared.application(app, open: url, options: options)');
  }
  writeFileSync(delegatePath, delegate);
  const folder = 'ios/App/App/Assets.xcassets/AppIcon.appiconset';
  for (const file of readdirSync(folder).filter(name => name.endsWith('.png'))) {
    const path = `${folder}/${file}`;
    const { width, height } = await sharp(path).metadata();
    await sharp(icon).resize(width, height).flatten({ background: '#132a57' }).png().toFile(path);
  }
}

