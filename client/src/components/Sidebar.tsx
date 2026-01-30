import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import type { SystemStats } from "@/types";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import { Clock, Files, HardDrive, Loader2, Plus, Trash2 } from "lucide-react";
import { useState } from "react";

interface SidebarProps {
  className?: string;
  onOpenUpload?: () => void;
  currentView?: "active" | "trash";
  onViewChange?: (view: "active" | "trash") => void;
}

export function Sidebar({ className, onOpenUpload, currentView = "active", onViewChange }: SidebarProps) {
  const { data: stats } = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => api.get<SystemStats>("/system/stats"),
    refetchInterval: false, // Disabled auto-polling to save bandwidth
    staleTime: Infinity, // Cache is always fresh until invalidated by mutation
    refetchOnWindowFocus: false,
    refetchOnMount: true, // Fetch once on mount
  });

  const menuItems = [
    { icon: Files, label: "All Files", value: "active" as const },
    { icon: Clock, label: "Recent", value: "active" as const, disabled: true }, // Placeholder for now
    { icon: Trash2, label: "Trash", value: "trash" as const },
  ];

  const usagePercent = stats ? (stats.storage.totalSize / (100 * 1024 * 1024 * 1024)) * 100 : 0; // Soft limit visualization

  // Local state for processing
  const [isProcessing, setIsProcessing] = useState(false);

  const handleUploadClick = () => {
    setIsProcessing(true);
    setTimeout(() => {
      onOpenUpload?.(); // Call the prop function
      setIsProcessing(false);
    }, 400); // Visual feedback delay
  };

  return (
    <div className={cn("flex flex-col h-full bg-card/50 backdrop-blur-xl border-r border-border/40 p-5", className)}>
      <div className="flex items-center space-x-3 mb-10 px-2">
        <div className="w-10 h-10 shrink-0 bg-primary flex items-center justify-center rounded-xl shadow-lg shadow-primary/20 ring-4 ring-primary/5">
          <HardDrive className="h-5 w-5 text-primary-foreground" />
        </div>
        <div className="flex flex-col -space-y-0.5">
          <span className="text-lg font-black tracking-tight text-foreground">Neko Drive</span>
          <span className="text-[10px] font-bold text-muted-foreground/80 uppercase tracking-widest">
            Discord-Backed Secure Cloud
          </span>
        </div>
      </div>

      <div className="mb-8">
        <Button
          className="w-full justify-start gap-3 rounded-2xl h-14 px-5 shadow-2xl shadow-primary/20 bg-primary hover:bg-primary/90 text-primary-foreground transition-all duration-300 active:scale-95 group"
          onClick={handleUploadClick}
          disabled={isProcessing}
        >
          <div className="w-8 h-8 rounded-full bg-white/20 flex items-center justify-center group-hover:scale-110 transition-transform">
            {isProcessing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          </div>
          <div className="flex flex-col items-start -space-y-0.5">
            <span className="text-sm font-bold tracking-tight">{isProcessing ? "Opening..." : "Upload Files"}</span>
            <span className="text-[10px] font-medium opacity-80">Add to Drive</span>
          </div>
        </Button>
      </div>

      <nav className="flex-1 space-y-6">
        <div>
          <h3 className="px-4 text-[10px] font-black text-muted-foreground/60 uppercase tracking-widest mb-3">
            Library
          </h3>
          <div className="space-y-1">
            {menuItems.map((item, i) => (
              <motion.div
                key={item.label}
                initial={{ x: -20, opacity: 0 }}
                animate={{ x: 0, opacity: 1 }}
                transition={{ delay: 0.1 * i + 0.2 }}
              >
                <Button
                  variant={currentView === item.value && !item.disabled ? "secondary" : "ghost"}
                  disabled={item.disabled}
                  className={cn(
                    "w-full justify-start gap-3 rounded-xl h-11 px-4 transition-all duration-200",
                    currentView === item.value &&
                      !item.disabled &&
                      "bg-primary/10 text-primary hover:bg-primary/15 font-bold shadow-sm shadow-primary/5",
                    currentView !== item.value &&
                      !item.disabled &&
                      "text-muted-foreground hover:text-foreground hover:bg-secondary/40",
                    item.disabled && "opacity-50 cursor-not-allowed",
                  )}
                  onClick={() => !item.disabled && onViewChange?.(item.value)}
                >
                  <item.icon
                    className={cn(
                      "h-4 w-4",
                      currentView === item.value && !item.disabled ? "text-primary" : "text-muted-foreground",
                    )}
                  />
                  <span className="text-sm">{item.label}</span>
                  {item.disabled && (
                    <span className="ml-auto text-[9px] font-bold uppercase tracking-wider bg-secondary px-1.5 py-0.5 rounded text-muted-foreground/50">
                      Soon
                    </span>
                  )}
                </Button>
              </motion.div>
            ))}
          </div>
        </div>
      </nav>

      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.6 }}
        className="mt-auto relative"
      >
        <div className="p-4 bg-card border border-border/40 rounded-3xl shadow-sm relative overflow-hidden group hover:border-border/60 transition-colors">
          {/* Subtle Background Pattern */}
          <div className="absolute -right-6 -top-6 w-24 h-24 bg-primary/5 rounded-full blur-2xl group-hover:bg-primary/10 transition-colors" />

          <div className="relative z-10 space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-bold text-muted-foreground uppercase tracking-wider flex items-center gap-1.5">
                <HardDrive className="h-3 w-3" />
                Disk Usage
              </span>
              <span className={cn("text-[10px] font-bold", usagePercent > 90 ? "text-red-500" : "text-primary")}>
                {Math.max(1, Math.round(usagePercent))}%
              </span>
            </div>

            {/* Main Stat & Progress */}
            <div className="space-y-2">
              <div className="flex flex-col">
                <span className="text-2xl font-black tracking-tighter text-foreground">
                  {formatBytes(stats?.storage.totalSize || 0)}
                </span>
                <span className="text-[10px] font-bold text-muted-foreground/60 uppercase">Used Space</span>
              </div>

              <Progress
                value={stats && stats.storage.totalSize > 0 ? Math.max(2, usagePercent) : 0}
                className="h-2 rounded-full bg-muted shadow-inner"
                indicatorClassName={cn("shadow-sm", usagePercent > 90 ? "bg-red-500" : "bg-primary")}
              />
            </div>

            {/* Compact Details Footer */}
            <div className="flex items-center justify-between pt-2 border-t border-border/20">
              <span className="text-[10px] font-bold text-foreground flex items-center gap-1.5">
                <Files className="h-3 w-3 text-muted-foreground" />
                {stats?.storage.totalFiles || 0} Files Uploaded
              </span>
            </div>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
