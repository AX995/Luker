# iOS

## Why there is no iOS app

Luker has no app for iPhone or iPad. Luker is licensed AGPL-3.0, and the App Store terms conflict with the license's requirement that users can freely copy, modify, and redistribute the software ([legal barrier to application stores](https://en.wikipedia.org/wiki/GNU_General_Public_License#Legal_barrier_to_application_stores)), so the app cannot be published there. Android and HarmonyOS allow installing an app directly, which is why those platforms have one.

## Use Luker in the browser

iPhone and iPad reach Luker through the browser over the network. Nothing is installed from the App Store.

1. Run Luker on a computer and turn on network access:
   - On the same network — see [LAN Access](/guide/lan-access).
   - From outside your network — see [Remote Access](/guide/remote-access).
2. On the iPhone or iPad, open Safari and enter the host address. On a local network this looks like `http://192.168.1.23:8000`; through a proxy or tunnel, enter your domain.
3. Log in if authentication is enabled.

## Add to Home Screen

Luker installs as a home screen icon, so it opens in its own window instead of a browser tab.

1. Open Luker in Safari.
2. Tap the **Share** button.
3. Tap **Add to Home Screen**.
4. Name it, then tap **Add**.

The icon opens Luker in a standalone window, without Safari's address bar, and uses the Luker icon.

## Related pages

- [LAN Access](/guide/lan-access) — reach Luker from devices on the same network
- [Remote Access](/guide/remote-access) — reach Luker from outside your network
- [Android App](/guide/android) — the app for Android
- [HarmonyOS App](/guide/harmonyos) — the app for HarmonyOS
