import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Download, FileText, Loader2, Lock, Maximize2, MoreVertical, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

interface FilePreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  fileName: string | null;
  fileUrl: string | null;
  isLoading?: boolean;
  isEncrypted?: boolean;
  progress?: number;
}

export function FilePreviewModal({
  isOpen,
  onClose,
  fileName,
  fileUrl,
  isLoading = false,
  isEncrypted = false,
  progress = 0,
}: FilePreviewModalProps) {
  const wasLoadingRef = useRef(false);
  const [mediaState, setMediaState] = useState<{ url: string | null; loaded: boolean; error: boolean }>({
    url: fileUrl,
    loaded: false,
    error: false,
  });

  // Derived state to avoid effect synchronization
  const isMediaLoaded = mediaState.url === fileUrl && mediaState.loaded;
  const isMediaError = mediaState.url === fileUrl && mediaState.error;

  const getFileType = (name: string) => {
    if (!name) return "other";
    const ext = name.split(".").pop()?.toLowerCase();
    if (["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext || "")) return "image";
    if (["mp4", "webm", "mov"].includes(ext || "")) return "video";
    if (["mp3", "wav", "ogg"].includes(ext || "")) return "audio";
    if (["pdf"].includes(ext || "")) return "pdf";
    if (["txt", "md", "json", "js", "ts", "tsx", "jsx", "html", "css", "py", "sh", "yml", "yaml"].includes(ext || ""))
      return "text";
    return "other";
  };

  const type = getFileType(fileName || "");
  const isStreamable = type === "video" || type === "audio";

  // Reset loading state when URL changes
  // Adjust state when URL changes (React-idiomatic pattern)
  const [lastUrl, setLastUrl] = useState(fileUrl);
  if (fileUrl !== lastUrl) {
    setLastUrl(fileUrl);
    setMediaState({ url: fileUrl, loaded: false, error: false });
  }

  // Handle Loading -> Success Toast
  useEffect(() => {
    if (!isOpen) {
      wasLoadingRef.current = false;
      return;
    }

    if (isLoading) {
      wasLoadingRef.current = true;
    } else if (wasLoadingRef.current) {
      toast.success(isStreamable ? "Stream Ready" : isEncrypted ? "Decryption Complete" : "Download Complete");
      wasLoadingRef.current = false;
    }
  }, [isLoading, isOpen, isStreamable, isEncrypted, fileUrl]); // Reset logic implicitly handled by checking wasLoadingRef.current which remains true/false across URL changes if needed, or we can force reset it.

  const isProcessing = isLoading; // simplified

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-none w-screen h-dvh flex flex-col p-0 gap-0 bg-card/95 backdrop-blur-xl border-0 sm:border sm:border-border/10 overflow-hidden rounded-none sm:rounded-2xl shadow-2xl sm:max-w-4xl sm:w-[95vw] sm:h-[80vh] [&>button]:hidden">
        {/* Header */}
        <DialogHeader className="p-4 border-b border-border/10 flex flex-row items-center justify-between shrink-0 bg-secondary/20 gap-4">
          <div className="space-y-1 flex-1 min-w-0">
            <DialogTitle className="text-sm font-bold truncate">{fileName || "Loading..."}</DialogTitle>
            <DialogDescription className="text-[10px] uppercase font-bold tracking-widest text-muted-foreground flex items-center gap-1.5">
              {isProcessing ? (
                <>
                  {isEncrypted && <Lock className="h-3 w-3 text-primary animate-pulse" />}
                  <span className="text-primary">{isEncrypted ? "Decrypting..." : "Loading..."}</span>
                </>
              ) : (
                <>
                  {isEncrypted ? "Decrypted Preview" : "Preview"} • {type.toUpperCase()}
                </>
              )}
            </DialogDescription>
          </div>

          {/* Actions Container */}
          <div className="flex items-center gap-4 shrink-0">
            {fileUrl && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground"
                    title="More Options"
                  >
                    <MoreVertical className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-40">
                  <DropdownMenuItem onClick={() => window.open(fileUrl, "_blank")}>
                    <Maximize2 className="mr-2 h-4 w-4" />
                    <span>Open New Tab</span>
                  </DropdownMenuItem>
                  <a href={fileUrl} download={fileName || "download"} className="flex w-full items-center">
                    <DropdownMenuItem className="w-full cursor-pointer">
                      <Download className="mr-2 h-4 w-4" />
                      <span>Save</span>
                    </DropdownMenuItem>
                  </a>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10"
              onClick={onClose}
              title="Close"
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        </DialogHeader>

        {/* Content Viewport */}
        <div className="flex-1 overflow-auto bg-black/5 flex items-center justify-center relative p-4">
          {/* Processing/Loading/Error Overlay */}
          {(isLoading || (!isMediaLoaded && !!fileUrl && type !== "other") || isMediaError) && (
            <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-background/80 backdrop-blur-sm animate-in fade-in duration-300 px-4 text-center">
              <div className="flex flex-col items-center justify-center space-y-6 max-w-sm w-full">
                {isMediaError ? (
                  <>
                    <div className="bg-destructive/10 p-4 rounded-full shadow-xl">
                      <X className="h-8 w-8 text-destructive" />
                    </div>
                    <div className="space-y-2">
                      <h3 className="text-lg font-bold text-foreground">Failed to Load Media</h3>
                      <p className="text-sm text-muted-foreground">
                        The file could not be streamed. Please try downloading it instead.
                      </p>
                      <Button variant="outline" size="sm" onClick={onClose} className="mt-4">
                        Close Preview
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    {/* Minimal Icon Container */}
                    <div className="relative">
                      <div className="absolute inset-0 bg-primary/20 rounded-full blur-2xl animate-pulse" />
                      <div className="relative bg-card border border-border/10 p-4 rounded-full shadow-xl">
                        <Lock className="h-8 w-8 animate-pulse text-primary" />
                      </div>
                    </div>

                    <div className="text-center space-y-2">
                      <h3 className="text-lg font-bold text-foreground">
                        {isLoading
                          ? `${isEncrypted ? "Decrypting" : "Buffering"}... ${progress > 0 ? progress + "%" : ""}`
                          : "Loading Preview..."}
                      </h3>
                      <Loader2 className="h-5 w-5 animate-spin text-primary/50 mt-2 mx-auto" />
                    </div>
                  </>
                )}
              </div>
            </div>
          )}

          {/* Content Renderer */}
          {fileUrl && (
            <>
              {type === "image" && (
                <img
                  src={fileUrl}
                  alt={fileName || ""}
                  className="max-w-full max-h-full object-contain rounded-lg shadow-lg border border-border/10"
                  onLoad={() => setMediaState({ url: fileUrl, loaded: true, error: false })}
                  onError={() => setMediaState({ url: fileUrl, loaded: false, error: true })}
                />
              )}

              {type === "video" && (
                <video
                  src={fileUrl}
                  controls
                  autoPlay
                  className="max-w-full max-h-full rounded-lg shadow-lg border border-border/10 bg-black"
                  onLoadedData={() => setMediaState({ url: fileUrl, loaded: true, error: false })}
                  onError={() => setMediaState({ url: fileUrl, loaded: false, error: true })}
                />
              )}

              {type === "audio" && (
                <div className="w-full max-w-md p-8 bg-card rounded-3xl border border-border/10 shadow-xl flex flex-col items-center gap-6">
                  <div className="w-24 h-24 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                    <FileText className="h-10 w-10 text-primary" />
                  </div>
                  <audio
                    src={fileUrl}
                    controls
                    className="w-full"
                    onLoadedData={() => setMediaState({ url: fileUrl, loaded: true, error: false })}
                    onError={() => setMediaState({ url: fileUrl, loaded: false, error: true })}
                  />
                </div>
              )}

              {(type === "pdf" || type === "text") && (
                <iframe
                  src={fileUrl}
                  className="w-full h-full rounded-lg border-0 bg-white"
                  title="Preview"
                  onLoad={() => setMediaState({ url: fileUrl, loaded: true, error: false })}
                />
              )}

              {type === "other" && (
                <div className="flex flex-col items-center justify-center text-center space-y-4">
                  <div className="p-6 bg-secondary/30 rounded-full">
                    <FileText className="h-12 w-12 text-muted-foreground" />
                  </div>
                  <div className="space-y-1">
                    <p className="font-bold text-foreground">Preview Not Available</p>
                    <p className="text-xs text-muted-foreground max-w-xs">
                      This file type cannot be previewed directly. You can download it to view locally.
                    </p>
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
