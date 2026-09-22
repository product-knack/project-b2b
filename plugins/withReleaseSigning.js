const { withAppBuildGradle } = require('expo/config-plugins');

/* Release signing for local Gradle builds.

   `npx expo prebuild` regenerates android/ from scratch and Expo's template signs
   the RELEASE build with the DEBUG keystore. Before this plugin the fix was a hand
   edit to android/app/build.gradle, which every prebuild silently reverted — and a
   debug-signed AAB is rejected by the Play Store (wrong upload key), so the failure
   only shows up at upload time.

   The keystore itself (android/app/upload-keystore.jks) is deliberately NOT in git;
   the passwords come from ~/.gradle/gradle.properties as ODDS_UPLOAD_STORE_PASSWORD
   / ODDS_UPLOAD_KEY_PASSWORD. Both must exist on the machine doing the build. */

const RELEASE_SIGNING_CONFIG = `        release {
            storeFile file('upload-keystore.jks')
            storePassword findProperty('ODDS_UPLOAD_STORE_PASSWORD') ?: ''
            keyAlias 'upload'
            keyPassword findProperty('ODDS_UPLOAD_KEY_PASSWORD') ?: (findProperty('ODDS_UPLOAD_STORE_PASSWORD') ?: '')
        }
`;

module.exports = function withReleaseSigning(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;

    // 1. Declare the release keystore alongside the generated debug one.
    if (!src.includes("storeFile file('upload-keystore.jks')")) {
      const anchor = /(signingConfigs \{\n(?:.*\n)*?        \}\n)/;
      if (!anchor.test(src)) throw new Error('withReleaseSigning: could not find the signingConfigs block');
      src = src.replace(anchor, `$1${RELEASE_SIGNING_CONFIG}`);
    }

    // 2. Point the release build type at it (template ships signingConfigs.debug).
    const releaseBuildType = /(buildTypes \{[\s\S]*?\n        release \{[\s\S]*?)signingConfig signingConfigs\.debug/;
    if (!releaseBuildType.test(src)) {
      if (!/\n        release \{[\s\S]*?signingConfig signingConfigs\.release/.test(src)) {
        throw new Error('withReleaseSigning: could not point the release build type at the release signing config');
      }
    } else {
      src = src.replace(releaseBuildType, '$1signingConfig signingConfigs.release');
    }

    cfg.modResults.contents = src;
    return cfg;
  });
};
