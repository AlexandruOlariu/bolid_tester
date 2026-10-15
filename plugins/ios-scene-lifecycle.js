/**
 * Expo config plugin: adopt the UIScene lifecycle on iOS.
 *
 * iOS 27 stops an app at launch (`NoSceneLifecycleAdoption`) unless it uses scenes. The Expo SDK 57
 * template still generates a classic AppDelegate that builds its own window, so `expo prebuild`
 * output crashes on an iOS 27 device. This plugin makes the generated project use Expo's own
 * `ExpoAppSceneDelegate`:
 *   - Info.plist gets a `UIApplicationSceneManifest` pointing at `<Module>.SceneDelegate`;
 *   - AppDelegate.swift conforms to `ExpoReactNativeFactoryProvider`, no longer creates the window or
 *     starts React Native itself, and declares `class SceneDelegate: ExpoAppSceneDelegate {}`.
 *
 * It is idempotent and fails loudly if the template changed shape, instead of producing an app that
 * silently crashes. Once the Expo template adopts scenes itself, the plugin does nothing.
 */
const { withAppDelegate, withInfoPlist } = require('expo/config-plugins');

const SCENE_DELEGATE = '$(PRODUCT_MODULE_NAME).SceneDelegate';

const CLASS_DECLARATION = 'class AppDelegate: ExpoAppDelegate {';
const CLASS_DECLARATION_PATCHED =
  'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {';

const WINDOW_BLOCK =
  /#if os\(iOS\) \|\| os\(tvOS\)\n\s*window = UIWindow\(frame: UIScreen\.main\.bounds\)\n\s*factory\.startReactNative\([\s\S]*?\)\n#endif\n/;

const WINDOW_BLOCK_REPLACEMENT =
  '    // iOS 27 needs the UIScene lifecycle: ExpoAppSceneDelegate creates the window\n' +
  '    // and starts React Native from this factory (see plugins/ios-scene-lifecycle.js).\n';

const SCENE_DELEGATE_CLASS =
  '\n// Added by plugins/ios-scene-lifecycle.js.\nclass SceneDelegate: ExpoAppSceneDelegate {}\n';

/** Returns the AppDelegate.swift text adopting scenes. */
function patchAppDelegate(source) {
  if (source.includes('ExpoAppSceneDelegate')) {
    return source;
  }
  if (!source.includes(CLASS_DECLARATION) || !WINDOW_BLOCK.test(source)) {
    throw new Error(
      'ios-scene-lifecycle: the generated AppDelegate.swift has a shape this plugin does not know. ' +
        'Check whether the Expo template now adopts scenes itself, or update the plugin.',
    );
  }
  return (
    source
      .replace(CLASS_DECLARATION, CLASS_DECLARATION_PATCHED)
      .replace(WINDOW_BLOCK, WINDOW_BLOCK_REPLACEMENT)
      .replace(/\s*$/, '\n') + SCENE_DELEGATE_CLASS
  );
}

/** Adds a single-window scene manifest to an Info.plist object unless one exists. */
function addSceneManifest(plist) {
  if (plist.UIApplicationSceneManifest) {
    return plist;
  }
  return {
    ...plist,
    UIApplicationSceneManifest: {
      UIApplicationSupportsMultipleScenes: false,
      UISceneConfigurations: {
        UIWindowSceneSessionRoleApplication: [
          {
            UISceneConfigurationName: 'Default Configuration',
            UISceneDelegateClassName: SCENE_DELEGATE,
          },
        ],
      },
    },
  };
}

function withIosSceneLifecycle(config) {
  config = withInfoPlist(config, (c) => {
    c.modResults = addSceneManifest(c.modResults);
    return c;
  });
  return withAppDelegate(config, (c) => {
    if (c.modResults.language !== 'swift') {
      throw new Error('ios-scene-lifecycle: only a Swift AppDelegate is supported.');
    }
    c.modResults.contents = patchAppDelegate(c.modResults.contents);
    return c;
  });
}

module.exports = withIosSceneLifecycle;
module.exports.patchAppDelegate = patchAppDelegate;
module.exports.addSceneManifest = addSceneManifest;
