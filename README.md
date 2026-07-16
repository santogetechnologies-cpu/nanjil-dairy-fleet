# Nanjil Vehicle Intelligence Platform

AI-powered fleet, fuel, safety and cold chain management system for **Nanjil Integrated Dairy Development**.

Built with **React 19 + Vite 8 + TypeScript + Supabase** — deployable as a web application and as a native **Android & iOS** app via **Capacitor**.

---

## 📱 Mobile App Info

| Property | Value |
|---|---|
| App Name | Nanjil VIP |
| Package ID | `com.nanjil.vip` |
| Framework | React 19 + Vite 8 |
| Mobile Bridge | Capacitor |
| Backend | Supabase (PostgreSQL + Realtime) |
| Min Android | Android 7.0 (API 24) |
| Min iOS | iOS 13.0 |

---

## 🛠️ Prerequisites

### All Platforms
- **Node.js** 18+ and npm
- **Java JDK 17** (for Android builds)

### Android
- **Android Studio** (latest stable)
- **Android SDK** with API 34+
- **ANDROID_HOME** environment variable set

### iOS (macOS only)
- **Xcode** 14+
- **CocoaPods** (`sudo gem install cocoapods`)
- Apple Developer account (for device builds)

---

## 🚀 Development Setup

```bash
# Clone the project
git clone <your-repo-url>
cd nanjil-dairy-fleet

# Install dependencies
npm install

# Install Capacitor packages (if not already installed)
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

# Start the web dev server
npm run dev
```

Open `http://localhost:8080` in your browser.

---

## 🌐 Web Deployment (Vercel)

```bash
# Build for production
npm run build

# Preview the production build locally
npm run preview
```

The project includes `vercel.json` for one-click deployment to Vercel.

---

## 📱 Mobile Build – Step by Step

### First Time Setup

```bash
# Step 1 – Install Capacitor packages (if not done)
npm install @capacitor/core @capacitor/cli @capacitor/android @capacitor/ios

# Step 2 – Initialize Capacitor (only needed once)
npx cap init "Nanjil VIP" com.nanjil.vip --web-dir dist

# Step 3 – Build the React app
npm run build

# Step 4 – Add the Android platform (only needed once)
npx cap add android

# Step 5 – Add the iOS platform (macOS only, only needed once)
npx cap add ios

# Step 6 – Sync Capacitor (copies dist/ → native projects)
npx cap sync
```

### Everyday Mobile Development

```bash
# Build web app + sync to native platforms
npm run mobile:build

# Sync only (if web already built)
npm run mobile:sync

# Open in Android Studio
npm run android

# Open in Xcode (macOS only)
npm run ios
```

---

## 🤖 Android Build

### Debug APK

1. Run `npm run android` to open Android Studio
2. Wait for Gradle sync to complete
3. Click **Build → Build Bundle(s)/APK(s) → Build APK(s)**
4. APK will be at `android/app/build/outputs/apk/debug/app-debug.apk`

### Release APK (Signed)

1. **Build → Generate Signed Bundle/APK**
2. Choose **APK** or **Android App Bundle (.aab)**
3. Create or select a keystore file
4. Fill in keystore alias and passwords
5. Build

> Store your keystore file safely — losing it means you cannot update the app on Google Play.

### Required Android Permissions (already configured in AndroidManifest.xml)
- `INTERNET` — Supabase API calls
- `ACCESS_NETWORK_STATE` — network detection
- `CAMERA` — future feature support
- `ACCESS_FINE_LOCATION` — GPS tracking
- `ACCESS_COARSE_LOCATION` — network-based location
- `VIBRATE` — notifications
- `POST_NOTIFICATIONS` — push notifications (Android 13+)

---

## 🍎 iOS Build (macOS Required)

### Setup

```bash
# Install CocoaPods dependencies
cd ios/App
pod install
cd ../..
```

### Debug Build

1. Run `npm run ios` to open Xcode
2. Select your target device or simulator
3. Click **Run** (▶)

### App Store Build

1. Open `ios/App/App.xcworkspace` in Xcode
2. Set **Team** in Signing & Capabilities
3. Set **Bundle Identifier** to `com.nanjil.vip`
4. **Product → Archive**
5. Upload to App Store Connect via **Organizer**

### Required iOS Permissions (already configured in Info.plist)
- `NSCameraUsageDescription` — camera access
- `NSLocationWhenInUseUsageDescription` — GPS while using app
- `NSLocationAlwaysUsageDescription` — background GPS
- `NSPhotoLibraryUsageDescription` — photo access

---

## 📁 Project Structure

```
nanjil-dairy-fleet/
├── src/
│   ├── components/       # Shared UI components
│   │   └── ErrorBoundary.tsx
│   ├── lib/              # Auth, Supabase, types
│   ├── pages/            # All route pages
│   └── styles.css        # Global styles + mobile CSS
├── public/               # Static assets
├── android/              # Capacitor Android project (open in Android Studio)
├── ios/                  # Capacitor iOS project (open in Xcode, macOS only)
├── supabase/             # Database migrations
├── capacitor.config.ts   # Capacitor configuration
├── vite.config.ts        # Vite build configuration
└── .env                  # Environment variables
```

---

## 🔧 Environment Variables

| Variable | Description |
|---|---|
| `VITE_SUPABASE_URL` | Your Supabase project URL |
| `VITE_SUPABASE_ANON_KEY` | Supabase anonymous (public) key |

> Vite environment variables must be prefixed with `VITE_` to be accessible in the browser/WebView.

---

## 🐛 Troubleshooting

### Routes show 404 on mobile
The app uses `HashRouter`. URLs are formatted as `http://localhost/#/dashboard`. If you see 404, clear app data and reopen.

### Map not rendering on Android
Ensure `INTERNET` permission is granted in device settings. MapLibre requires network access to load map tiles.

### Supabase 401 errors
Run the RLS policy SQL script in the Supabase SQL editor. See `supabase/migrations/` for the latest migration.

### `npx cap sync` fails
Ensure you have run `npm run build` first to generate the `dist/` folder.

### iOS: `pod install` fails
```bash
sudo gem install cocoapods
cd ios/App && pod install
```

### Android: Gradle sync fails
- Ensure Java JDK 17 is installed
- Set `JAVA_HOME` environment variable
- In Android Studio: File → Project Structure → SDK Location → set JDK path

---

## 🔑 Release Checklist

- [ ] `npm run mobile:build` completes with no errors
- [ ] App ID is `com.nanjil.vip`
- [ ] Splash screen shows correctly
- [ ] All routes work via hash navigation
- [ ] Login and logout work
- [ ] Supabase realtime updates appear
- [ ] Maps render
- [ ] Signed APK / IPA generated successfully
- [ ] App icons set for all sizes

---

## 📞 Support

For issues or questions, contact the development team or open an issue in the project repository.
