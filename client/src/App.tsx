import { StackList } from "@/components/FileList";
import { Sidebar } from "@/components/Sidebar";
import { TransferWidget } from "@/components/TransferWidget";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { Toaster } from "@/components/ui/sonner";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { UploadWidget } from "@/components/UploadWidget";
import { TransferProvider } from "@/context/TransferContext";
import { api } from "@/lib/api";
import { cn, formatBytes } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import {
  Cpu,
  Database,
  Globe,
  Loader2,
  Menu,
  Moon,
  Plus,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Sun,
  Wifi,
  X,
} from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import type { SystemStats } from "./types";

interface HealthStatus {
  database: "online" | "offline" | "error";
  discord: string;
  version?: string;
  uptime?: number;
  memory?: {
    rss: number;
    heapTotal: number;
    heapUsed: number;
  };
}

function App() {
  /* State Management */
  const [isUploadWidgetOpen, setIsUploadWidgetOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [currentView, setCurrentView] = useState<"active" | "trash">("active");
  const [theme, setTheme] = useState(() => localStorage.getItem("neko-theme") || "system");
  const [isPurgeDialogOpen, setIsPurgeDialogOpen] = useState(false);
  const [isPurging, setIsPurging] = useState(false);

  // Close mobile menu on resize to desktop
  useEffect(() => {
    const handleResize = () => {
      if (window.innerWidth >= 768) {
        setIsMobileMenuOpen(false);
      }
    };
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Process Indicator State
  const [processingAction, setProcessingAction] = useState<string | null>(null);

  const handleAction = (id: string, action: () => void) => {
    setProcessingAction(id);
    setTimeout(() => {
      action();
      setProcessingAction(null);
    }, 400); // 400ms visual feedback delay
  };

  // Apply Theme Effect
  useEffect(() => {
    const root = window.document.documentElement;
    root.classList.remove("light", "dark");

    if (theme === "system") {
      const systemTheme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
      root.classList.add(systemTheme);
    } else {
      root.classList.add(theme);
    }
    localStorage.setItem("neko-theme", theme);
  }, [theme]);

  // Fetch Storage Stats
  const { data: stats } = useQuery({
    queryKey: ["system-stats"],
    queryFn: () => api.get<SystemStats>("/system/stats"),
    refetchInterval: 60000,
    staleTime: 60000,
    refetchOnWindowFocus: false,
  });

  const { data: health } = useQuery({
    queryKey: ["health"],
    queryFn: () => api.get<HealthStatus>("/system/health"),
    refetchInterval: 60000,
    staleTime: 30000,
    refetchOnWindowFocus: false,
  });

  const getHealthColor = () => {
    if (!health) return "text-muted-foreground";
    if (health.database === "online" && health.discord.includes("online"))
      return "text-green-500 bg-green-500/5 border-green-500/10";
    if (health.database === "error" || health.discord.includes("unreachable"))
      return "text-red-500 bg-red-500/5 border-red-500/10";
    return "text-amber-500 bg-amber-500/5 border-amber-500/10";
  };

  return (
    <TransferProvider>
      <div className="flex h-screen bg-background transition-colors duration-300 overflow-hidden">
        {/* Sidebar - Desktop */}
        <Sidebar
          className="hidden md:flex w-64 shrink-0"
          onOpenUpload={() => setIsUploadWidgetOpen(true)}
          currentView={currentView}
          onViewChange={setCurrentView}
        />

        {/* Global Transfer Status Widget */}
        <TransferWidget />

        {/* Main Content Area */}
        <div className="flex-1 flex flex-col min-w-0 relative h-full overflow-hidden">
          {/* Top Header */}
          <motion.header
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            transition={{ duration: 0.5, ease: "circOut" }}
            className="h-16 border-b border-border/20 bg-background/30 backdrop-blur-xl flex items-center justify-between px-4 md:px-8 z-20 shrink-0"
          >
            <div className="flex items-center gap-3">
              <Sheet open={isMobileMenuOpen} onOpenChange={setIsMobileMenuOpen}>
                <SheetTrigger asChild>
                  <Button variant="ghost" size="icon" className="md:hidden rounded-xl">
                    <Menu className="h-5 w-5" />
                  </Button>
                </SheetTrigger>
                <SheetContent side="left" className="p-0 w-64 border-r border-border/40 bg-card">
                  <Sidebar
                    className="w-full border-none"
                    onOpenUpload={() => {
                      setIsUploadWidgetOpen(true);
                      setIsMobileMenuOpen(false);
                    }}
                    currentView={currentView}
                    onViewChange={(view) => {
                      setCurrentView(view);
                      setIsMobileMenuOpen(false);
                    }}
                  />
                </SheetContent>
              </Sheet>
              <div className="hidden md:block flex-1 max-w-2xl">{/* Global Search */}</div>

              {/* Theme Toggle (Mobile) */}
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden rounded-xl"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
              </Button>
            </div>

            <div className="flex items-center space-x-4">
              {/* Theme Toggle (Desktop) */}
              <Button
                variant="ghost"
                size="icon"
                className="hidden md:flex rounded-xl text-muted-foreground hover:text-foreground"
                onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
              >
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </Button>

              <motion.div
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{
                  scale: 1,
                  opacity: 1,
                  boxShadow:
                    health?.database === "online" && health.discord.includes("online")
                      ? [
                          "0 0 0px rgba(34, 197, 94, 0)",
                          "0 0 12px rgba(34, 197, 94, 0.2)",
                          "0 0 0px rgba(34, 197, 94, 0)",
                        ]
                      : "none",
                }}
                transition={{
                  scale: { duration: 0.3 },
                  opacity: { duration: 0.3 },
                  boxShadow: {
                    duration: 3,
                    repeat: Infinity,
                    ease: "easeInOut",
                  },
                }}
                className={cn(
                  "hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full border bg-background/50 backdrop-blur-sm shadow-sm transition-all duration-300",
                  getHealthColor(),
                )}
              >
                {health?.database === "online" && health.discord.includes("online") ? (
                  <ShieldCheck className="h-3.5 w-3.5" />
                ) : (
                  <ShieldAlert className="h-3.5 w-3.5 animate-pulse text-red-500" />
                )}
                <span className="hidden xs:inline text-[10px] font-bold uppercase tracking-widest">
                  {health?.database === "online" && health.discord.includes("online") ? "Systems Optimal" : "Attention"}
                </span>
              </motion.div>

              <Button
                variant="ghost"
                size="icon"
                className={cn(
                  "rounded-xl transition-all duration-200 active:scale-90",
                  processingAction === "settings" && "bg-secondary text-primary",
                )}
                onClick={() => handleAction("settings", () => setIsSettingsOpen(true))}
              >
                <Settings
                  className={cn(
                    "h-5 w-5 transition-all duration-500",
                    processingAction === "settings" ? "animate-spin text-primary" : "text-muted-foreground",
                  )}
                />
              </Button>
            </div>
          </motion.header>

          {/* Content Stacks */}
          <main className="flex-1 overflow-y-auto p-4 md:p-6 lg:p-8 pt-6">
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, delay: 0.2, ease: "circOut" }}
              className="max-w-6xl mx-auto space-y-6 md:space-y-8"
            >
              <StackList status={currentView === "trash" ? "trashed" : "active"} />
            </motion.div>
          </main>

          {/* Mobile FAB */}
          <Button
            className="md:hidden fixed bottom-6 right-6 w-14 h-14 rounded-full shadow-2xl shadow-primary/40 z-50 flex items-center justify-center p-0 hover:scale-105 active:scale-95 transition-all"
            onClick={() => setIsUploadWidgetOpen(true)}
          >
            <Plus className="h-6 w-6 text-primary-foreground" />
          </Button>

          <UploadWidget open={isUploadWidgetOpen} onOpenChange={setIsUploadWidgetOpen} />
        </div>

        {/* Architect Settings Dialog */}
        <Dialog open={isSettingsOpen} onOpenChange={setIsSettingsOpen}>
          <DialogContent
            showCloseButton={false}
            className="w-[95vw] max-w-[95vw] sm:w-[90vw] sm:max-w-4xl bg-card/95 backdrop-blur-3xl border-0 ring-0 focus:ring-0 outline-none p-0 overflow-hidden rounded-[2.5rem] shadow-2xl h-[85dvh] sm:h-[600px] flex flex-col gap-0"
          >
            {/* Unified Header - Fixed at Top */}
            <div className="flex items-center justify-between p-6 pb-4 border-b border-border/10 shrink-0">
              <div className="flex items-center gap-3 text-primary">
                <div className="p-2.5 bg-primary/10 rounded-2xl">
                  <Settings className="h-5 w-5" />
                </div>
                <div className="flex flex-col">
                  <DialogTitle className="text-xl font-black tracking-tighter uppercase">System Control</DialogTitle>
                  <DialogDescription className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/70">
                    Environment Configuration
                  </DialogDescription>
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 rounded-full bg-secondary/50 border border-border/10 hover:bg-destructive/10 hover:text-destructive transition-colors shrink-0"
                onClick={() => setIsSettingsOpen(false)}
              >
                <X className="h-5 w-5" />
              </Button>
            </div>

            <Tabs defaultValue="overview" className="flex-1 flex flex-col md:flex-row min-h-0 h-full w-full">
              {/* Mobile Nav - Top (Below Header) */}
              <div className="md:hidden px-6 pt-4 shrink-0">
                <TabsList className="w-full flex h-10 bg-secondary/40 p-1 gap-1 rounded-xl overflow-x-auto no-scrollbar">
                  {["overview", "storage", "maintenance", "appearance", "about"].map((t) => (
                    <TabsTrigger
                      key={t}
                      value={t}
                      className="flex-1 min-w-[80px] h-full rounded-lg border-0 text-[10px] font-bold uppercase tracking-widest bg-transparent data-[state=active]:bg-background data-[state=active]:text-primary data-[state=active]:shadow-sm transition-all"
                    >
                      {t}
                    </TabsTrigger>
                  ))}
                </TabsList>
              </div>

              {/* Desktop Sidebar - Left */}
              <div className="hidden md:block w-56 bg-transparent border-r border-border/10 p-4 space-y-2 shrink-0 overflow-y-auto">
                <TabsList className="flex flex-col h-auto bg-transparent p-0 gap-1 text-left items-stretch">
                  <TabsTrigger
                    value="overview"
                    className="justify-start px-4 py-2.5 h-10 text-xs font-bold tracking-wide rounded-xl data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all"
                  >
                    Overview
                  </TabsTrigger>
                  <TabsTrigger
                    value="storage"
                    className="justify-start px-4 py-2.5 h-10 text-xs font-bold tracking-wide rounded-xl data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all"
                  >
                    Storage
                  </TabsTrigger>
                  <TabsTrigger
                    value="maintenance"
                    className="justify-start px-4 py-2.5 h-10 text-xs font-bold tracking-wide rounded-xl data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all"
                  >
                    Maintenance
                  </TabsTrigger>
                  <TabsTrigger
                    value="appearance"
                    className="justify-start px-4 py-2.5 h-10 text-xs font-bold tracking-wide rounded-xl data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all"
                  >
                    Appearance
                  </TabsTrigger>
                  <TabsTrigger
                    value="about"
                    className="justify-start px-4 py-2.5 h-10 text-xs font-bold tracking-wide rounded-xl data-[state=active]:bg-primary/10 data-[state=active]:text-primary data-[state=active]:shadow-none transition-all"
                  >
                    About
                  </TabsTrigger>
                </TabsList>
              </div>

              {/* Main Content Area - Scrollable */}
              <div className="flex-1 p-6 md:p-8 overflow-y-auto">
                <TabsContent
                  value="overview"
                  className="mt-0 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2 p-4 bg-secondary/30 rounded-2xl border border-border/20">
                      <div className="flex items-center gap-2 text-primary">
                        <Database className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Database</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold truncate pr-2">SQLite</span>
                        <Badge
                          variant={health?.database === "online" ? "default" : "destructive"}
                          className="rounded-md h-4 text-[10px] px-1.5"
                        >
                          {health?.database || "..."}
                        </Badge>
                      </div>
                    </div>

                    <div className="space-y-2 p-4 bg-secondary/30 rounded-2xl border border-border/20">
                      <div className="flex items-center gap-2 text-primary">
                        <Wifi className="h-3.5 w-3.5" />
                        <span className="text-[10px] font-bold uppercase tracking-widest">Network</span>
                      </div>
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold">Discord</span>
                        <Badge
                          variant={health?.discord.includes("online") ? "default" : "destructive"}
                          className="rounded-md h-4 text-[10px] px-1.5"
                        >
                          {health?.discord.includes("online") ? "ON" : "OFF"}
                        </Badge>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10">
                    <div className="flex items-center justify-between mb-1">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-primary">Regional Latency</p>
                      <Globe className="h-3 w-3 text-primary" />
                    </div>
                    <p className="text-3xl font-black text-foreground tracking-tighter">
                      {health?.discord.includes("(") ? health.discord.split("(")[1]?.replace(")", "") : "0ms"}
                    </p>
                  </div>

                  {health?.memory && (
                    <div className="grid grid-cols-3 gap-3">
                      <div className="p-3 bg-secondary/20 rounded-xl border border-border/5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">RSS</p>
                        <p className="text-sm font-black tracking-tight">{formatBytes(health.memory.rss)}</p>
                      </div>
                      <div className="p-3 bg-secondary/20 rounded-xl border border-border/5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                          Heap
                        </p>
                        <p className="text-sm font-black tracking-tight">{formatBytes(health.memory.heapUsed)}</p>
                      </div>
                      <div className="p-3 bg-secondary/20 rounded-xl border border-border/5">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                          Uptime
                        </p>
                        <p className="text-sm font-black tracking-tight text-primary">
                          {Math.floor((health.uptime || 0) / 60)}m
                        </p>
                      </div>
                    </div>
                  )}
                </TabsContent>

                <TabsContent
                  value="storage"
                  className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="space-y-4">
                    <div className="flex items-end justify-between">
                      <div>
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                          Total Usage
                        </p>
                        <p className="text-2xl font-black tracking-tight">
                          {formatBytes(stats?.storage.totalSize || 0)}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">Files</p>
                        <p className="text-2xl font-black tracking-tight">{stats?.storage.totalFiles || 0}</p>
                      </div>
                    </div>

                    {/* Visual Bar */}
                    <div className="relative h-4 w-full bg-secondary/50 rounded-full overflow-hidden">
                      <motion.div
                        initial={{ scaleX: 0 }}
                        animate={{
                          scaleX: Math.max(0.01, stats ? stats.storage.totalSize / (100 * 1024 * 1024 * 1024) : 0),
                        }}
                        transition={{ duration: 1.5, ease: "circOut" }}
                        className="absolute inset-y-0 left-0 bg-primary w-full origin-left overflow-hidden"
                      >
                        <motion.div
                          animate={{
                            x: ["-100%", "100%"],
                          }}
                          transition={{
                            duration: 2,
                            repeat: Infinity,
                            ease: "linear",
                          }}
                          className="absolute inset-0 bg-linear-to-r from-transparent via-white/20 to-transparent w-full"
                        />
                      </motion.div>
                    </div>
                    <p className="text-[10px] text-muted-foreground text-center">
                      Cloud Storage Capacity (Soft Limit: 100GB)
                    </p>
                  </div>

                  <div className="p-4 bg-secondary/20 rounded-2xl border border-border/10 flex items-center justify-between">
                    <div className="space-y-0.5">
                      <p className="text-xs font-black uppercase tracking-tight">Local Index</p>
                      <p className="text-[9px] text-muted-foreground font-bold">Metadata Database Size</p>
                    </div>
                    <Badge variant="outline" className="font-mono">
                      {formatBytes(stats?.dbSize || 0)}
                    </Badge>
                  </div>
                </TabsContent>

                <TabsContent
                  value="maintenance"
                  className="mt-0 space-y-4 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground border-b border-border/10 pb-2">
                    System Maintenance
                  </p>
                  <div className="grid gap-4">
                    <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-2xl border border-border/20">
                      <div className="space-y-1">
                        <p className="text-sm font-bold tracking-tight">Manual Snapshot</p>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                          Force Discord Database Backup
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-primary/20 text-primary hover:bg-primary/5"
                        onClick={async () => {
                          try {
                            await api.post("/system/backup", {});
                            toast.success("Circular backup initiated");
                          } catch {
                            toast.error("Backup failed");
                          }
                        }}
                      >
                        Sync Now
                      </Button>
                    </div>

                    <div className="flex items-center justify-between p-4 bg-secondary/30 rounded-2xl border border-border/20">
                      <div className="space-y-1">
                        <p className="text-sm font-bold tracking-tight text-destructive">Clean Slate</p>
                        <p className="text-[10px] text-muted-foreground font-medium uppercase tracking-widest">
                          Purge Incomplete Uploads
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="rounded-xl border-destructive/20 text-destructive hover:bg-destructive/5"
                        onClick={() => setIsPurgeDialogOpen(true)}
                      >
                        Purge
                      </Button>
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="appearance"
                  className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="space-y-4">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground">
                      Interface Theme
                    </p>
                    <div className="grid grid-cols-3 gap-3">
                      {["light", "dark", "system"].map((mode) => (
                        <Button
                          key={mode}
                          variant="outline"
                          className={cn(
                            "h-20 flex flex-col gap-2 rounded-xl border-2",
                            theme === mode
                              ? "border-primary bg-primary/5 text-primary"
                              : "border-transparent bg-secondary/50 hover:bg-secondary",
                          )}
                          onClick={() => setTheme(mode)}
                        >
                          {mode === "light" && <Sun className="h-5 w-5" />}
                          {mode === "dark" && <Moon className="h-5 w-5" />}
                          {mode === "system" && <Cpu className="h-5 w-5" />}
                          <span className="text-[10px] font-bold uppercase tracking-widest">{mode}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </TabsContent>

                <TabsContent
                  value="about"
                  className="mt-0 space-y-6 animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="space-y-6">
                    <div className="flex flex-col items-center text-center space-y-2 py-4">
                      <div className="p-4 bg-primary/10 rounded-full mb-2">
                        <Database className="h-10 w-10 text-primary" />
                      </div>
                      <h3 className="text-2xl font-black tracking-tighter uppercase text-primary">Neko Drive</h3>
                      <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground">
                        Secure Multi-Cloud Engine v{health?.version || "2.0"}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div className="p-4 bg-secondary/30 rounded-2xl border border-border/20 space-y-2">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-primary">Core Architecture</p>
                        <ul className="text-[11px] font-medium space-y-1 text-muted-foreground">
                          <li>• Bun Runtime</li>
                          <li>• Hono Framework</li>
                          <li>• SQLite 3 (FTS5)</li>
                          <li>• React + Vite</li>
                        </ul>
                      </div>
                      <div className="p-4 bg-secondary/30 rounded-2xl border border-border/20 space-y-2">
                        <p className="text-[9px] font-bold uppercase tracking-widest text-primary">Storage Layer</p>
                        <ul className="text-[11px] font-medium space-y-1 text-muted-foreground">
                          <li>• Discord CDN Sharding</li>
                          <li>• AES-GCM-256 E2E</li>
                          <li>• Resumable Protocol</li>
                          <li>• Circular Snapshots</li>
                        </ul>
                      </div>
                    </div>

                    <div className="p-4 bg-primary/5 rounded-2xl border border-primary/10 text-center">
                      <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-1">
                        Private Cloud Instance
                      </p>
                      <p className="text-[11px] font-black text-primary uppercase">Unified storage, zero friction.</p>
                    </div>
                  </div>
                </TabsContent>
              </div>
            </Tabs>
          </DialogContent>
        </Dialog>

        {/* Global Purge Confirmation */}
        <AlertDialog open={isPurgeDialogOpen} onOpenChange={setIsPurgeDialogOpen}>
          <AlertDialogContent className="rounded-[2.5rem] bg-card/95 backdrop-blur-2xl border-border/10">
            <AlertDialogHeader>
              <AlertDialogTitle className="text-xl font-black tracking-tighter uppercase text-destructive">
                Purge Upload Fragments?
              </AlertDialogTitle>
              <AlertDialogDescription className="text-sm font-medium text-muted-foreground">
                This will identify and erase all incomplete upload shards from Discord. Storage will be purified.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="gap-2 sm:gap-0">
              <AlertDialogCancel className="rounded-2xl border-border/10 bg-secondary/30 hover:bg-secondary/50 font-bold uppercase tracking-widest text-[10px]">
                Abort
              </AlertDialogCancel>
              <AlertDialogAction
                className="rounded-2xl bg-destructive text-destructive-foreground hover:bg-destructive/90 font-black uppercase tracking-widest text-[10px]"
                disabled={isPurging}
                onClick={async (e) => {
                  e.preventDefault();
                  setIsPurging(true);
                  try {
                    await api.delete("/upload/file/pending/all");
                    toast.success("Storage purified.");
                    setIsPurgeDialogOpen(false);
                  } catch {
                    toast.error("Purge failed.");
                  } finally {
                    setIsPurging(false);
                  }
                }}
              >
                {isPurging ? <Loader2 className="h-3 w-3 animate-spin mr-2" /> : null}
                Execute Purge
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Toaster theme={theme as "dark" | "light" | "system"} />
      </div>
    </TransferProvider>
  );
}

export default App;
