// eslint-disable-next-line @typescript-eslint/no-require-imports
const plugin = require('./ios-scene-lifecycle') as {
  patchAppDelegate: (source: string) => string;
  addSceneManifest: (plist: Record<string, unknown>) => Record<string, unknown>;
};

// The shape of the AppDelegate that `expo prebuild` generates for Expo SDK 57.
const TEMPLATE = `internal import Expo
import React

@main
class AppDelegate: ExpoAppDelegate {
  var window: UIWindow?
  var reactNativeFactory: RCTReactNativeFactory?

  public override func application(
    _ application: UIApplication,
    didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
  ) -> Bool {
    let factory = ExpoReactNativeFactory(delegate: ReactNativeDelegate())
    reactNativeFactory = factory

#if os(iOS) || os(tvOS)
    window = UIWindow(frame: UIScreen.main.bounds)
    factory.startReactNative(
      withModuleName: "main",
      in: window,
      launchOptions: launchOptions)
#endif

    return super.application(application, didFinishLaunchingWithOptions: launchOptions)
  }
}

class ReactNativeDelegate: ExpoReactNativeFactoryDelegate {}
`;

describe('ios-scene-lifecycle plugin', () => {
  describe('patchAppDelegate', () => {
    const patched = plugin.patchAppDelegate(TEMPLATE);

    it('makes AppDelegate provide the React Native factory', () => {
      expect(patched).toContain(
        'class AppDelegate: ExpoAppDelegate, ExpoReactNativeFactoryProvider {',
      );
    });

    it('stops creating the window and starting React Native in the app delegate', () => {
      expect(patched).not.toContain('UIWindow(frame:');
      expect(patched).not.toContain('startReactNative');
      expect(patched).toContain(
        'return super.application(application, didFinishLaunchingWithOptions',
      );
    });

    it('declares a SceneDelegate based on ExpoAppSceneDelegate', () => {
      expect(patched).toContain('class SceneDelegate: ExpoAppSceneDelegate {}');
      expect(patched.endsWith('class SceneDelegate: ExpoAppSceneDelegate {}\n')).toBe(true);
    });

    it('is idempotent', () => {
      expect(plugin.patchAppDelegate(patched)).toBe(patched);
    });

    it('fails loudly when the template has a shape it does not know', () => {
      expect(() => plugin.patchAppDelegate('class Other {}')).toThrow(/ios-scene-lifecycle/);
    });
  });

  describe('addSceneManifest', () => {
    it('adds a single-window manifest pointing at the SceneDelegate', () => {
      const plist = plugin.addSceneManifest({ CFBundleName: 'x' }) as {
        CFBundleName: string;
        UIApplicationSceneManifest: {
          UIApplicationSupportsMultipleScenes: boolean;
          UISceneConfigurations: {
            UIWindowSceneSessionRoleApplication: { UISceneDelegateClassName: string }[];
          };
        };
      };
      expect(plist.CFBundleName).toBe('x');
      expect(plist.UIApplicationSceneManifest.UIApplicationSupportsMultipleScenes).toBe(false);
      expect(
        plist.UIApplicationSceneManifest.UISceneConfigurations
          .UIWindowSceneSessionRoleApplication[0].UISceneDelegateClassName,
      ).toBe('$(PRODUCT_MODULE_NAME).SceneDelegate');
    });

    it('keeps an existing manifest untouched', () => {
      const existing = { UIApplicationSceneManifest: { custom: true } };
      expect(plugin.addSceneManifest(existing)).toBe(existing);
    });
  });
});
