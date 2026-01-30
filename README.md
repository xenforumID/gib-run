# 🐱 Neko Drive 2.0: The Sweet Release 🛡️💎

Neko Drive is a professional-grade, decentralized cloud storage engine that transforms Discord into a secure, limitless object store. Built for privacy and performance, it features zero-knowledge client-side encryption and a high-fidelity interface.

## 🚀 Key Features

- **Distributed Storage**: Seamlessly shards files across Discord CDN.
- **Resumable Engine**: State-of-the-art transfer manager that survives network drops and session pauses.
- **Zero-Knowledge Security**: AES-GCM-256 E2E encryption. Your keys, your data—server is content-blind.
- **Circular Backup Protocol**: Self-healing metadata backups with automatic Discord channel purification.
- **Premium UI/UX**: Built with Shadcn UI, featuring fluid micro-animations and real-time system diagnostics.
- **Local-First Speed**: Powered by Bun and SQLite (WAL mode) for near-instant metadata indexing.

## 🛠️ Tech Stack

- **Runtime**: [Bun](https://bun.sh) (Fastest JS/TS runner & native SQLite)
- **Engine**: [Hono](https://hono.dev) (Standard-driven web framework)
- **Interface**: [React](https://react.dev) + [Vite](https://vitejs.dev)
- **Styling**: [Tailwind CSS](https://tailwindcss.com) + [Shadcn UI](https://ui.shadcn.com)
- **State**: [TanStack Query](https://tanstack.com/query) v5

## 📥 Getting Started

### Prerequisites

- [Bun](https://bun.sh) installed globally.
- A Discord Bot Token and Channel ID (for object storage).

### Installation

```bash
# Clone and install all dependencies
bun install
```

### Configuration

Create `.env` files in both `client/` and `server/` based on the provided `.env.example` templates.

### Development

```bash
# Start both Backend and Frontend concurrently
bun run dev
```

## 🛡️ Security Model

Neko Drive follows a strictly **Zero-Knowledge** architecture.

- **Master Key**: Used for local encryption/decryption in Web Workers.
- **API Secret**: Authorizes secure communication between layers.
- **No Persistence**: Decryption keys never touch the server or persistent storage.

---

Built with 🐱 by the Neko Drive Team.
