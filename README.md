# Antigravity Mobile 📱

A mobile-friendly dashboard for [Antigravity IDE](https://antigravity.google) that lets you monitor your AI conversations and model quotas from any device.

<p align="center">
  <img src="screenshots/1.png" width="200" alt="PIN Authentication" />
  <img src="screenshots/2.png" width="200" alt="Chat View (Dark)" />
  <img src="screenshots/3.png" width="200" alt="Settings & Quota Monitor" />
</p>
<p align="center">
  <img src="screenshots/4.png" width="200" alt="Chat View (Light)" />
  <img src="screenshots/5.png" width="200" alt="File Browser" />
  <img src="screenshots/6.png" width="200" alt="File Editor" />
</p>

## ✨ Features

- **📊 Live Chat Streaming** - Watch your Antigravity conversations in real-time from any device
- **⚡ Lite Mode** - A lightweight, distraction-free chat view optimized for mobile with quick-action chips
- **📂 File Browser** - Read and edit files directly from your phone with syntax highlighting
- **🔐 Optional PIN Authentication** - Secure your dashboard with a 4-6 digit PIN
- **🎯 Model Quota Monitor** - View remaining quota for all AI models with visual progress indicators *(Windows only)*
- **📱 Mobile-First UI** - Beautiful, responsive interface designed for phones and tablets
- **🌓 Dark/Light Themes** - Easy on the eyes, day or night
- **🔄 Auto-Updates** - Conversations sync automatically without refreshing

## 🚀 Quick Start

### Prerequisites

- **Windows 10/11, macOS, or Linux**
- **Antigravity IDE** installed (the script will launch it automatically)
- **Node.js 18+** (Windows script will offer to install automatically)

> **Note:** Model Quota Monitor currently only works on Windows. Other features work on all platforms.

### Installation

1. **Download** or clone this repository:
   ```bash
   git clone https://github.com/Almoksha/AntigravityMobile.git
   cd AntigravityMobile
   ```

2. **Run the start script**:
   - **Windows**: Double-click `Start-Antigravity-Mobile.bat`
   - **macOS/Linux**: Run `./Start-Antigravity-Mobile.sh`

3. **Open in browser**: Navigate to `http://localhost:3001`
   - **Full Dashboard**: `http://localhost:3001`
   - **Lite Mode**: `http://localhost:3001/minimal` (lightweight chat-only view)

4. **Access from phone**: Use `http://YOUR_PC_IP:3001` on the same network

That's it! The script will automatically install dependencies on first run.

### Stopping the Server

- **Windows**: Double-click `Stop-Antigravity-Mobile.bat`
- **macOS/Linux**: Run `./Stop-Antigravity-Mobile.sh`

## 📖 How It Works

```
┌─────────────────────────────────────────────────────────────┐
│                    Your Computer                             │
├─────────────────────────────────────────────────────────────┤
│  ┌────────────────┐         ┌─────────────────────────┐     │
│  │ Antigravity    │◄───────►│  Antigravity Mobile      │     │
│  │ IDE            │  API    │  Server (:3001)          │     │
│  │                │         │                          │     │
│  │ - Chat View    │  CDP    │  - Live Chat Stream      │     │
│  │ - Language     │◄───────►│  - Quota Monitor         │     │
│  │   Server       │         │  - Screen Capture        │     │
│  └────────────────┘         └─────────────────────────┘     │
│                                       ▲                      │
│                                       │ WebSocket            │
│                                       ▼                      │
│                             ┌─────────────────┐              │
│                             │  Your Phone 📱  │              │
│                             │  or Tablet      │              │
│                             └─────────────────┘              │
└─────────────────────────────────────────────────────────────┘
```

### Components

| Feature | How It Works |
|---------|--------------|
| **Live Chat** | Reads conversation data from Antigravity's chat stream API |
| **Lite Mode** | Lightweight view at `/minimal` with quick-action buttons (Continue, Yes, No) |
| **File Browser** | Read/edit workspace files via REST API with mobile-friendly editor |
| **Quota Monitor** | Queries the language server's `GetUserStatus` endpoint (Windows only) |

## 🛠️ Configuration

The server runs on port **3001** by default. To change this, edit `launcher.mjs`:

```javascript
const PORT = 3001; // Change to your preferred port
```

### 🔐 PIN Authentication (Optional)

Enable PIN protection when starting the server:

- **Windows**: The start script will prompt you to enable PIN authentication
- **macOS/Linux**: The start script will prompt you, or set the environment variable:
  ```bash
  export MOBILE_PIN=1234
  ./Start-Antigravity-Mobile.sh
  ```

When enabled, you'll need to enter the PIN to access the dashboard from any device.

### CDP Screen Capture

For screen capture to work, Antigravity must be launched with remote debugging enabled. The start script does this automatically, but if you start Antigravity manually, add this flag:

```bash
antigravity --remote-debugging-port=9222
```

## 📁 Project Structure

```
antigravity-mobile/
├── public/
│   ├── index.html        # Full dashboard UI
│   └── minimal.html      # Lite mode - lightweight chat view
├── http-server.mjs       # Express server with API endpoints
├── launcher.mjs          # Starts Antigravity + server together
├── quota-service.mjs     # Fetches quota from language server
├── chat-stream.mjs       # Live chat streaming service
├── cdp-client.mjs        # Chrome DevTools Protocol client
├── Start-Antigravity-Mobile.bat   # Windows launcher
├── Start-Antigravity-Mobile.sh    # macOS/Linux launcher
├── Stop-Antigravity-Mobile.bat    # Stop the server (Windows)
└── Stop-Antigravity-Mobile.sh     # Stop the server (macOS/Linux)
```

## 🔒 Privacy & Security

- **Local Only** - All communication stays on your local machine/network
- **No Cloud** - No data is sent to external servers
- **No Credentials Stored** - Uses Antigravity's existing authentication
- **Optional PIN** - Add an extra layer of protection for network access

## 🖥️ Manual Commands (For Debugging)

If you need to see error messages or debug issues, run everything manually in the terminal:

### Step 1: Install Dependencies

```bash
cd AntigravityMobile
npm install
```

### Step 2: Start Antigravity with CDP Enabled

**Windows (PowerShell)**:
```powershell
& "C:\Users\$env:USERNAME\AppData\Local\Programs\Antigravity\Antigravity.exe" --remote-debugging-port=9222
```

**macOS**:
```bash
/Applications/Antigravity.app/Contents/MacOS/Antigravity --remote-debugging-port=9222
```

**Linux**:
```bash
antigravity --remote-debugging-port=9222
# or if installed via .deb:
/usr/share/antigravity/antigravity --remote-debugging-port=9222
```

### Step 3: Start the Server

**Without PIN**:
```bash
node http-server.mjs
```

**With PIN (4-6 digits)**:
```bash
# Windows PowerShell
$env:MOBILE_PIN = "1234"; node http-server.mjs

# macOS/Linux
MOBILE_PIN=1234 node http-server.mjs
```

### Step 4: Open in Browser

- **Full Dashboard**: http://localhost:3001
- **Lite Mode**: http://localhost:3001/minimal

### Checking Logs

Run the server with output visible to see debug logs:
```bash
node http-server.mjs 2>&1 | tee server.log
```

Look for lines starting with `[CDP getWorkspacePath]` or `[Workspace Poll]` to debug path detection issues.

## ❓ Troubleshooting

### "CDP Disconnected"
- Make sure Antigravity was started via the start script (not manually)
- Or add `--remote-debugging-port=9222` to Antigravity's shortcut

### "Quota not loading"
- Ensure Antigravity IDE is running
- Make sure you're logged in to Antigravity

### "Can't connect from phone"
- Check that your phone is on the same WiFi network
- Try using your PC's IP address instead of `localhost`
- Make sure firewall allows port 3001

### "PIN not working" / Forgot PIN
- The PIN is set each time you start the server - just restart without PIN to disable
- **Windows**: Run the start script again and choose "No" when asked about PIN
- **macOS/Linux**: Start without the `MOBILE_PIN` environment variable
- Clear your browser's localStorage if you're seeing old auth errors

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

MIT License - see [LICENSE](LICENSE) for details.

## 🙏 Acknowledgments

- Inspired by [Antigravity-Shit-Chat](https://github.com/gherghett/Antigravity-Shit-Chat) by gherghett
- Built for use with [Antigravity IDE](https://antigravity.google)

- Quota monitoring inspired by the [Antigravity Cockpit](https://marketplace.visualstudio.com/items?itemName=jlcodes.antigravity-cockpit) extension (`jlcodes.antigravity-cockpit`)