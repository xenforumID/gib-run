import { useDownload } from "@/hooks/use-download";
import { useUpload } from "@/hooks/use-upload";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

interface TransferContextType {
  upload: ReturnType<typeof useUpload>;
  download: ReturnType<typeof useDownload>;
}

const TransferContext = createContext<TransferContextType | null>(null);

export function TransferProvider({ children }: { children: ReactNode }) {
  const upload = useUpload();
  const download = useDownload();

  // Cross-Tab Synchronization
  const [remoteDownload, setRemoteDownload] = useState<ReturnType<typeof useDownload> | null>(null);
  const [remoteUpload, setRemoteUpload] = useState<ReturnType<typeof useUpload> | null>(null);

  useEffect(() => {
    const channel = new BroadcastChannel("neko-transfers");

    // 1. Listen for updates from other tabs
    channel.onmessage = (event) => {
      const { type, payload } = event.data;
      if (type === "SYNC_DOWNLOAD" && payload.isDownloading) {
        setRemoteDownload(payload);
      } else if (type === "SYNC_UPLOAD" && payload.isUploading) {
        setRemoteUpload(payload);
      } else if (type === "SYNC_CLEAR") {
        setRemoteDownload(null);
        setRemoteUpload(null);
      }
    };

    // 2. Broadcast local state if active
    if (download.isDownloading) {
      // DataCloneError Fix: Only send serializable data, no functions
      const payload = {
        isDownloading: download.isDownloading,
        progress: download.progress,
        fileName: download.fileName,
        previewUrl: download.previewUrl,
        mode: download.mode,
        status: download.status,
        speed: download.speed,
        eta: download.eta,
      };
      channel.postMessage({ type: "SYNC_DOWNLOAD", payload });
    } else if (upload.isUploading) {
      // Serialize upload state (adjust based on useUpload structure)
      const payload = {
        isUploading: upload.isUploading,
        progress: upload.progress,
        currentFileName: upload.currentFileName,
        status: upload.upload.status,
        speed: upload.upload.speed,
        eta: upload.upload.eta,
      };
      channel.postMessage({ type: "SYNC_UPLOAD", payload });
    } else if (!remoteDownload && !remoteUpload) {
      // If we just stopped, tell others
    }

    // Cleanup when component unmounts or state changes
    return () => {
      // If we were downloading and now we stopped, send a clear message?
      // It's handled by next effect cycle logic or explicit clear.
      channel.close();
    };
  }, [download, upload, remoteDownload, remoteUpload]); // Re-run when local state changes (triggers broadcast)

  // Explicit Clear Broadcast when stopping
  useEffect(() => {
    if (!download.isDownloading && !upload.isUploading) {
      const channel = new BroadcastChannel("neko-transfers");
      channel.postMessage({ type: "SYNC_CLEAR" });
      channel.close();
    }
  }, [download.isDownloading, upload.isUploading]);

  // Background Notification Logic
  useEffect(() => {
    // Combine local and remote for notifications
    const activeDownload = download.isDownloading ? download : remoteDownload?.isDownloading ? remoteDownload : null;
    const activeUpload = upload.isUploading ? upload : remoteUpload?.isUploading ? remoteUpload : null;

    const handleVisibilityChange = () => {
      if (document.hidden) {
        if (activeDownload) {
          showNotification("Downloading File", `Progress: ${activeDownload.progress}%`);
        } else if (activeUpload) {
          showNotification("Uploading File", `Progress: ${activeUpload.progress}%`);
        }
      }
    };

    // ... showNotification function same as before ...

    const showNotification = (title: string, body: string) => {
      if (!("Notification" in window)) return;

      if (Notification.permission === "granted") {
        new Notification(title, { body, icon: "/favicon.ico" });
      } else if (Notification.permission !== "denied") {
        Notification.requestPermission().then((permission) => {
          if (permission === "granted") {
            new Notification(title, { body, icon: "/favicon.ico" });
          }
        });
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);

    // Title Update
    if (document.hidden) {
      if (activeDownload) {
        document.title = `(${activeDownload.progress}%) Downloading...`;
      } else if (activeUpload) {
        document.title = `(${activeUpload.progress}%) Uploading...`;
      } else {
        document.title = "Neko Drive";
      }
    } else {
      document.title = "Neko Drive";
    }

    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [download, upload, remoteDownload, remoteUpload]);

  // Merge: Prefer local state if active, otherwise use remote
  // This allows the "Slave" tab to show the "Master" tab's work
  const exposedDownload = download.isDownloading ? download : remoteDownload || download;
  const exposedUpload = upload.isUploading ? upload : remoteUpload || upload;

  return (
    <TransferContext.Provider value={{ upload: exposedUpload, download: exposedDownload }}>
      {children}
    </TransferContext.Provider>
  );
}

export function useTransfer() {
  const context = useContext(TransferContext);
  if (!context) {
    throw new Error("useTransfer must be used within a TransferProvider");
  }
  return context;
}
