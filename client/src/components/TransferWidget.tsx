import { useTransfer } from "@/context/TransferContext";
import { formatBytes } from "@/lib/utils";
import { ArrowDown, ArrowUp, Loader2, Pause, Play, X } from "lucide-react";
import { Button } from "./ui/button";

const formatDuration = (seconds: number) => {
  if (!seconds || !isFinite(seconds)) return "--:--";
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export function TransferWidget() {
  const { upload, download } = useTransfer();

  // Only show download in widget if it's NOT a preview
  const isActualDownload = download.isDownloading && download.mode === "download";
  const isActive = isActualDownload || upload.isUploading || !!download.isPaused;
  const isDownload = isActualDownload || !!download.isPaused;

  const progress = isDownload ? download.progress : upload.progress;
  const fileName = isDownload ? download.fileName : upload.currentFileName;
  const status = isDownload ? download.status : upload.upload.status === "uploading" ? "Uploading..." : "Processing...";
  const cancel = isDownload ? download.cancelDownload : upload.cancelUpload;

  // New Metrics
  const speed = (isDownload ? download.speed : upload.upload.speed) || 0;
  const eta = (isDownload ? download.eta : upload.upload.eta) || 0;

  if (!isActive) return null;

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-in slide-in-from-bottom-5 fade-in duration-300">
      <div className="bg-background/80 backdrop-blur-xl border border-border/20 shadow-2xl rounded-full pl-2 pr-2 py-2 flex items-center gap-4 min-w-75 max-w-[90vw]">
        {/* Icon & Progress */}
        <div className="relative flex items-center justify-center w-10 h-10 shrink-0">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <path
              className="text-secondary"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="text-primary transition-all duration-300 ease-out"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
              fill="none"
              stroke="currentColor"
              strokeWidth="4"
              strokeDasharray={`${progress}, 100`}
            />
          </svg>
          <div className="absolute inset-0 flex items-center justify-center">
            {status?.includes("Retrying") || status?.includes("Buffering") ? (
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
            ) : isDownload ? (
              <ArrowDown className="h-4 w-4 text-primary" />
            ) : (
              <ArrowUp className="h-4 w-4 text-primary" />
            )}
          </div>
        </div>

        {/* Text Details */}
        <div className="flex flex-col flex-1 min-w-0 pr-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] uppercase font-bold tracking-widest text-primary">
              {status || (isDownload ? "Downloading" : "Uploading")}
            </span>
            <div className="flex items-center gap-2">
              {isActive && (
                <>
                  <span className="text-[9px] font-mono font-medium text-muted-foreground">
                    {progress < 100 ? (
                      <>
                        {formatBytes(speed)}/s • ETA {formatDuration(eta)}
                      </>
                    ) : (
                      "Finishing..."
                    )}
                  </span>
                  <div className="h-2 w-px bg-border/20" />
                </>
              )}
              <span className="text-[10px] font-mono font-bold text-foreground">{progress}%</span>
            </div>
          </div>
          <span className="text-xs font-medium truncate max-w-50">{fileName}</span>
        </div>

        {/* Controls */}
        <div className="flex items-center gap-1">
          {isDownload && (
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full hover:bg-primary/10 hover:text-primary shrink-0"
              onClick={() => {
                if (download.isPaused) {
                  download.resumeDownload();
                } else {
                  download.pauseDownload();
                }
              }}
            >
              {download.isPaused ? (
                <Play className="h-4 w-4 fill-current" />
              ) : (
                <Pause className="h-4 w-4 fill-current" />
              )}
            </Button>
          )}

          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 rounded-full hover:bg-destructive/10 hover:text-destructive shrink-0"
            onClick={cancel}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  );
}
