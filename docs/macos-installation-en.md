# macOS Installation Guide

## About Code Signing

Since this is an open-source project, we have not purchased an Apple Developer account ($99/year), so the macOS version is **not notarized or code-signed**.

## Installation Methods

### Method 1: Right-click to Open (Recommended)

1. Download the `.dmg` or `.app.tar.gz` file
2. **Right-click** the file → Select "Open"
3. Click "Open" to confirm

### Method 2: Allow in System Settings

1. Download and try to open the app
2. If you see "cannot verify developer" warning:
   - Open "System Settings" → "Privacy & Security"
   - Find the blocked app and click "Open Anyway"
   - Click "Open" to confirm

### Method 3: Terminal (Advanced Users)

```bash
# Remove quarantine attribute
xattr -cr /Applications/Deeting.app

# Or run directly
/Applications/Deeting.app/Contents/MacOS/deeting
```

## Security Information

- ✅ Application code is fully open-source and auditable on GitHub
- ✅ Each release includes signature files (`.sig`) to verify update integrity
- ✅ Distributed through official GitHub Releases channel

## Auto Updates

Even without code signing, the app supports automatic updates:
1. Checks for updates on app launch
2. Prompts user when new version is available
3. Downloads, verifies signature, and installs the update

## Support the Project

If you'd like to support this project in obtaining official Apple code signing, consider sponsoring:

- [GitHub Sponsors](https://github.com/sponsors/your-username)
- Goal: $99/year

---

**Windows and Linux versions** are not affected by this limitation and can be installed directly.
