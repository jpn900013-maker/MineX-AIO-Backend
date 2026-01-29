# Freebie.com.ua - Ultimate AIO Tools

> The Ultimate All-in-One Toolkit with over 60+ tools, featuring advanced authentication, multi-database management, and enterprise-grade security.

## 🚀 Quick Start (Single Command)

Get the entire system (Frontend + Backend) running with just one command:

### Option 1: Single Command (Recommended)
This starts both the Frontend and Backend automatically.
```bash
cd Frontend
npm start
```

### Option 2: Split Terminal (Manual)
If you prefer running them in separate terminals:

**Terminal 1 (Backend):**
```bash
cd server
node index.js
```

**Terminal 2 (Frontend):**
```bash
cd Frontend
npm run dev
```

This will launch:
- **Frontend**: http://localhost:8080
- **Backend**: http://localhost:3001

## 🔑 Admin Access

Access the **System Control Panel** to manage databases and view analytics.

- **URL**: [http://localhost:8080/admin/login](http://localhost:8080/admin/login)
- **Operator ID**: `operators130@gmail.com`
- **Passphrase**: `0po98iu76yt5@SS`

---

## 🔥 Features

### 🛠️ 60+ Developer Tools
- **Text**: Pastebin, Word Counter, Lorem Ipsum...
- **Network**: IP Logger, DNS Lookup, Ping Test...
- **Multimedia**: YouTube Downloader, Audio Converter, Image Resizer...
- **Minecraft**: Server Status, Bot Sender, Skin Viewer...
- **Security**: Password Generator, Hash Generator, JWT Decoder...

### 👤 User System
- **Registration & Login**: Secure JWT-based authentication.
- **History Dashboard**: Users can track their created Pastes and IP Logs.
- **Private Data**: Content is linked to the user's account.

### 🛡️ Admin & Database System
- **Database Fleet**: Connect multiple MongoDB instances simultaneously.
- **Hot-Swapping**: Switch active databases instantly without downtime.
- **Selective Migration**: Transfer data (Users/Tools) from RAM to any connected MongoDB with one click.
- **Live Analytics**: Monitor active users, bots, and total data usage.

### 🔒 Enterprise Security
- **Anti-Theft**: Right-click and DevTools (F12) are disabled to protect source code.
- **Intrusion Detection**: Automatic lockdown screen if inspection is attempted.

---

## 📂 Project Structure

- **src/**: React Frontend (Vite + Tailwind + Shadcn)
- **server/**: Node.js/Express Backend
    - `index.js`: Main API Server
    - `database.js`: Advanced Database Manager (Multi-DB Handler)

## 📦 Data Storage

By default, the server runs in **In-Memory Mode** (RAM). Data is reset on restart.
To persist data, login to the **Admin Panel** and connect a **MongoDB**.

---
*MineX AIO Hub © 2026*
