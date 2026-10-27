const { withAppBuildGradle } = require('expo/config-plugins');

/* Windows builds of RN 0.88 / SDK 58 (27 Oct 2026).

   gesture-handler 3's generated C++ lives under
   node_modules/react-native-gesture-handler/shared/shadowNodes/react/renderer/components/rngesturehandler_codegen/,
   and the object file path the C++ build makes for it (staging dir + the mangled absolute source path) is
   about 300 characters. The SDK's default CMake 3.22.1 ships ninja 1.10, which refuses any path over 260
   characters ("Filename longer than 260 characters"), so `gradlew assembleRelease` fails on Windows whatever the
   project folder is called.

   Two things fix it, both applied here so `npx expo prebuild` (which rewrites android/) keeps them:
   1. CMake 3.31.6 from the SDK manager (`sdkmanager --install "cmake;3.31.6"`), whose ninja 1.12 is long-path aware;
   2. -DCMAKE_OBJECT_PATH_MAX=240, so CMake hashes the deep object directory names and the paths stay short.
   Windows' own long-path flag (HKLM\SYSTEM\CurrentControlSet\Control\FileSystem\LongPathsEnabled = 1) is the
   belt to this pair of braces. Harmless on macOS / Linux and in EAS. */

const CMAKE_VERSION = '3.31.6';
const VERSION_BLOCK = `    externalNativeBuild {
        cmake {
            version "${CMAKE_VERSION}"
        }
    }
`;
const ARGS_BLOCK = `    defaultConfig {
        externalNativeBuild {
            cmake {
                arguments "-DCMAKE_OBJECT_PATH_MAX=240"
            }
        }
    }
`;

module.exports = function withCMakeLongPaths(config) {
  return withAppBuildGradle(config, (cfg) => {
    let src = cfg.modResults.contents;
    if (!src.includes(`version "${CMAKE_VERSION}"`)) {
      const anchor = /(\n    namespace [^\n]*\n)/;
      if (!anchor.test(src)) throw new Error('withCMakeLongPaths: could not find the namespace line in app/build.gradle');
      src = src.replace(anchor, `$1${VERSION_BLOCK}${ARGS_BLOCK}`);
    }
    cfg.modResults.contents = src;
    return cfg;
  });
};
