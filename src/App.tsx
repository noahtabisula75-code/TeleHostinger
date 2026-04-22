import React, { useState, useEffect, useRef } from "react";
import { 
  Bot, 
  Terminal, 
  Settings, 
  Play, 
  Square, 
  Plus, 
  Folder, 
  FileCode, 
  Cpu, 
  Activity,
  ChevronRight,
  Search,
  LogOut,
  AlertCircle,
  CheckCircle2,
  Clock,
  Menu,
  X,
  Users,
  Heart,
  Database,
  Circle,
  Send,
  User,
  Lock,
  Shield,
  Camera,
  CloudDownload,
  CloudUpload,
  RefreshCw,
  Download,
  FileArchive
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { io, Socket } from "socket.io-client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Project, LogEntry } from "./types";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

const formatUptime = (seconds: number) => {
  if (seconds === 0) return "0s";
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
};

export default function App() {
  const [user, setUser] = useState<{ id: string; username: string; subscription_plan?: string; created_at?: string } | null>(null);
  const [isAuthLoading, setIsAuthLoading] = useState(true);
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authSubscription, setAuthSubscription] = useState("None");
  const [projects, setProjects] = useState<Project[]>([]);
  const [communityUsers, setCommunityUsers] = useState<any[]>([]);
  const [selectedUser, setSelectedUser] = useState<any | null>(null);
  const [isCommunityModalOpen, setIsCommunityModalOpen] = useState(false);
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(null);
  const [projectFiles, setProjectFiles] = useState<string[]>([]);
  const [logs, setLogs] = useState<{ [key: string]: LogEntry[] }>({});
  const [isNewProjectModalOpen, setIsNewProjectModalOpen] = useState(false);
  const [isEnvModalOpen, setIsEnvModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<"node" | "python">("node");
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isWelcomeVisible, setIsWelcomeVisible] = useState(() => {
    return localStorage.getItem("welcome_dismissed") !== "true";
  });
  const [viewMode, setViewMode] = useState<"dashboard" | "project">(() => {
    return (localStorage.getItem("view_mode") as "dashboard" | "project") || "dashboard";
  });
  const [envVars, setEnvVars] = useState<{ key: string; value: string }[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [subscription, setSubscription] = useState({ type: "None", limit: -1, duration: "None" });
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [isAdminAuthenticated, setIsAdminAuthenticated] = useState(false);
  const [storageSize, setStorageSize] = useState(0);
  const [dbStatus, setDbStatus] = useState<{ connected: boolean; url: string; key: string } | null>(null);
  const [adminStats, setAdminStats] = useState<{
    totalBots: number;
    activeBots: number;
    maintenanceMode: boolean;
    totalStorage?: number;
    recentActivity?: { id: string; type: string; message: string; timestamp: string }[];
  } | null>(null);
  const [globalStats, setGlobalStats] = useState<{
    totalMemory: number;
    totalStorage: number;
    timestamp: string;
  } | null>(null);

  const [adminUsers, setAdminUsers] = useState<any[]>([]);
  const [isAdminUsersLoading, setIsAdminUsersLoading] = useState(false);

  // Profile Settings State
  const [isProfileModalOpen, setIsProfileModalOpen] = useState(false);
  const [profileUsername, setProfileUsername] = useState("");
  const [profileBio, setProfileBio] = useState("");
  const [profileAvatarUrl, setProfileAvatarUrl] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [isProfileUpdating, setIsProfileUpdating] = useState(false);
  const [isPasswordChanging, setIsPasswordChanging] = useState(false);

  const apiFetch = async (url: string, options: any = {}) => {
    const token = localStorage.getItem("auth_token");
    const headers = {
      ...options.headers,
      ...(token ? { "Authorization": `Bearer ${token}` } : {}),
    };
    const res = await fetch(url, { ...options, headers });
    if (res.status === 401 && !url.includes("/api/auth/")) {
      setUser(null);
      localStorage.removeItem("auth_token");
    }
    return res;
  };
  
  const socketRef = useRef<Socket | null>(null);
  const logEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Check if user is logged in
    const checkAuth = async () => {
      try {
        const res = await apiFetch("/api/auth/me");
        if (res.ok) {
          const userData = await res.json();
          setUser(userData);
        }
      } catch (error) {
        console.error("Auth check failed");
      } finally {
        setIsAuthLoading(false);
      }
    };
    checkAuth();
  }, []);

  useEffect(() => {
    if (user) {
      handleFetchDbStatus();
      setProfileUsername(user.username || "");
      setProfileBio((user as any).bio || "");
      setProfileAvatarUrl((user as any).avatar_url || "");
      
      // Whitelist TeleHostOwner as Admin
      if (user.username === "TeleHostOwner") {
        setIsAdminAuthenticated(true);
      }
    }
  }, [user]);

  useEffect(() => {
    if (!user) return;
    localStorage.setItem("view_mode", viewMode);
    handleFetchDbStatus();
  }, [viewMode, user]);

  useEffect(() => {
    if (!user) return;
    if (selectedProjectId) {
      localStorage.setItem("selected_project_id", selectedProjectId);
    }
  }, [selectedProjectId, user]);

  const selectedProject = projects.find(p => p.id === selectedProjectId);

  const fetchProjectFiles = async (id: string) => {
    try {
      const res = await apiFetch(`/api/projects/${id}/files`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setProjectFiles(data);
      } else {
        setProjectFiles([]);
      }
    } catch (error) {
      setProjectFiles([]);
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes === 0) return "0 B";
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
  };

  useEffect(() => {
    if (!user) return;
    // Fetch initial projects
    apiFetch("/api/projects")
      .then(async res => {
        const data = await res.json();
        if (res.ok && Array.isArray(data)) {
          setProjects(data);
          if (data.length > 0) {
            const savedId = localStorage.getItem("selected_project_id");
            const exists = data.find((p: Project) => p.id === savedId);
            const initialId = exists ? savedId : data[0].id;
            setSelectedProjectId(initialId);
            fetchProjectFiles(initialId);
          }
        } else {
          setProjects([]);
        }
      })
      .catch(() => setProjects([]));

    // Fetch storage size
    apiFetch("/api/stats/storage")
      .then(res => res.json())
      .then(data => setStorageSize(data.size));

    // Fetch subscription
    apiFetch("/api/subscription")
      .then(res => res.json())
      .then(data => setSubscription(data))
      .catch(() => setSubscription({ type: "Free", limit: 0, duration: "None" }));

    // Initialize Socket.io
    socketRef.current = io();
    
    socketRef.current.on("log", (log: LogEntry) => {
      setLogs(prev => ({
        ...prev,
        [log.projectId]: [...(prev[log.projectId] || []), log].slice(-100)
      }));
    });

    socketRef.current.on("status_change", ({ projectId, status }: { projectId: string, status: 'running' | 'stopped' }) => {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, status } : p));
    });
    
    socketRef.current.on("metrics", ({ projectId, metrics }: { projectId: string, metrics: any }) => {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, metrics } : p));
    });

    socketRef.current.on("global_stats", (stats: any) => {
      setGlobalStats(stats);
    });

    socketRef.current.on("activity", (activity: any) => {
      setAdminStats(prev => prev ? {
        ...prev,
        recentActivity: [activity, ...(prev.recentActivity || [])].slice(0, 10)
      } : null);
    });

    return () => {
      socketRef.current?.disconnect();
    };
  }, [user]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!authUsername || !authPassword) return;
    setIsAuthLoading(true);
    try {
      const res = await fetch(`/api/auth/${authMode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          username: authUsername, 
          password: authPassword,
          subscriptionPlan: authSubscription 
        }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem("auth_token", data.token);
        setUser(data.user);
        setAuthUsername("");
        setAuthPassword("");
      } else {
        alert(data.error);
      }
    } catch (error) {
      alert("Auth failed");
    } finally {
      setIsAuthLoading(false);
    }
  };

  const handleSearchUsers = async (q: string) => {
    setSearchQuery(q);
    if (!q.trim()) {
      setCommunityUsers([]);
      return;
    }
    try {
      const res = await apiFetch(`/api/users/search?q=${q}`);
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setCommunityUsers(data);
      } else {
        setCommunityUsers([]);
      }
    } catch (error) {
      setCommunityUsers([]);
    }
  };

  const handleViewProfile = async (userId: string) => {
    try {
      const res = await apiFetch(`/api/users/${userId}`);
      const data = await res.json();
      if (res.ok) {
        setSelectedUser(data);
        setIsCommunityModalOpen(true);
      } else {
        alert(data.error || "Failed to fetch profile");
      }
    } catch (error) {
      alert("Failed to fetch profile");
    }
  };

  const handleLikeProject = async (projectId: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/like`, { method: "POST" });
    if (res.ok) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, likes: (p.likes || 0) + 1 } : p));
    }
  };

  const handleUnlikeProject = async (projectId: string) => {
    const res = await apiFetch(`/api/projects/${projectId}/like`, { method: "DELETE" });
    if (res.ok) {
      setProjects(prev => prev.map(p => p.id === projectId ? { ...p, likes: Math.max(0, (p.likes || 0) - 1) } : p));
    }
  };

  const handleUpdateSubscription = async (plan: string) => {
    const res = await apiFetch("/api/users/subscription", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (res.ok) {
      const updatedUser = await res.json();
      setUser(prev => prev ? { ...prev, subscription_plan: updatedUser.subscription_plan } : null);
      alert(`Subscription updated to ${plan}!`);
    }
  };

  const handleUpdateProfile = async () => {
    if (!profileUsername) return;
    setIsProfileUpdating(true);
    try {
      const res = await apiFetch("/api/users/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          username: profileUsername,
          bio: profileBio,
          avatar_url: profileAvatarUrl
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setUser(prev => prev ? { ...prev, ...data } : null);
        alert("Profile updated successfully!");
      } else {
        alert(data.error || "Failed to update profile");
      }
    } catch (error) {
      alert("Failed to update profile");
    } finally {
      setIsProfileUpdating(false);
    }
  };

  const handleChangePassword = async () => {
    if (!currentPassword || !newPassword || !confirmPassword) {
      alert("Please fill in all password fields");
      return;
    }
    if (newPassword !== confirmPassword) {
      alert("New passwords do not match");
      return;
    }
    setIsPasswordChanging(true);
    try {
      const res = await apiFetch("/api/users/change-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (res.ok) {
        alert("Password changed successfully!");
        setCurrentPassword("");
        setNewPassword("");
        setConfirmPassword("");
      } else {
        alert(data.error || "Failed to change password");
      }
    } catch (error) {
      alert("Failed to change password");
    } finally {
      setIsPasswordChanging(false);
    }
  };

  const handleLogout = async () => {
    await apiFetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem("auth_token");
    setUser(null);
    setProjects([]);
    setSelectedProjectId(null);
  };

  useEffect(() => {
    if (isAdminPanelOpen && isAdminAuthenticated) {
      handleFetchAdminStats();
      handleFetchAdminUsers();
      handleFetchDbStatus();
    }
  }, [isAdminPanelOpen, isAdminAuthenticated]);

  useEffect(() => {
    if (selectedProjectId && socketRef.current) {
      socketRef.current.emit("join", selectedProjectId);
      fetchProjectFiles(selectedProjectId);
    }
    // Scroll to bottom of logs
    logEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [selectedProjectId, logs[selectedProjectId || ""]]);

  const handleStartProject = async (id: string) => {
    const res = await apiFetch(`/api/projects/${id}/start`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setProjects(prev => prev.map(p => p.id === id ? data : p));
    } else {
      alert(data.error || "Failed to start project");
    }
  };

  const handleStopProject = async (id: string) => {
    const res = await apiFetch(`/api/projects/${id}/stop`, { method: "POST" });
    const data = await res.json();
    if (res.ok) {
      setProjects(prev => prev.map(p => p.id === id ? data : p));
    } else {
      alert(data.error || "Failed to stop project");
    }
  };

  const handleAdminLogin = () => {
    if (adminPassword === "TeleHostAdmin@#$021412#") { 
      setIsAdminAuthenticated(true);
      handleFetchDbStatus();
      handleFetchAdminStats();
      handleFetchAdminUsers();
    } else {
      alert("Invalid admin password");
    }
  };

  const handleFetchAdminUsers = async () => {
    setIsAdminUsersLoading(true);
    try {
      const res = await apiFetch("/api/admin/users");
      const data = await res.json();
      if (res.ok && Array.isArray(data)) {
        setAdminUsers(data);
      } else {
        console.error("Failed to fetch admin users:", data.error || "Unknown error");
        if (res.status === 401) {
          alert("You must be logged in as a regular user first to access the admin panel endpoints.");
        } else {
          alert("Failed to fetch users: " + (data.error || "Unknown error"));
        }
      }
    } catch (error) {
      console.error("Failed to fetch admin users:", error);
      alert("Failed to fetch admin users. Check console for details.");
    } finally {
      setIsAdminUsersLoading(false);
    }
  };

  const handleAdminUpdateSubscription = async (userId: string, plan: string) => {
    try {
      const res = await apiFetch(`/api/admin/users/${userId}/subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (res.ok) {
        setAdminUsers(prev => prev.map(u => u.id === userId ? { ...u, subscription_plan: plan } : u));
        handleFetchAdminStats(); // Refresh activity
      } else {
        alert(data.error || "Failed to update subscription");
      }
    } catch (error) {
      alert("Failed to update subscription");
    }
  };

  const handleFetchAdminStats = async () => {
    try {
      const res = await apiFetch("/api/admin/stats");
      const data = await res.json();
      if (res.ok) {
        setAdminStats(data);
      }
    } catch (error) {
      console.error("Failed to fetch admin stats");
    }
  };

  const handleToggleMaintenance = async (enabled: boolean) => {
    try {
      const res = await apiFetch("/api/admin/maintenance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled }),
      });
      if (res.ok) {
        handleFetchAdminStats();
      }
    } catch (error) {
      alert("Failed to toggle maintenance mode");
    }
  };

  const handleFetchDbStatus = async () => {
    try {
      const res = await apiFetch("/api/db/status");
      const data = await res.json();
      if (res.ok) {
        setDbStatus(data);
      }
    } catch (error) {
      console.error("Failed to fetch DB status");
    }
  };

  const handleCreateProject = async () => {
    if (!newProjectName) return;
    if (subscription.limit === 0 || projects.length >= subscription.limit) {
      alert(`You didn't subscribe any plans please contact admin to get access.`);
      return;
    }
    const res = await apiFetch("/api/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newProjectName, type: newProjectType }),
    });
    
    if (!res.ok) {
      const errorData = await res.json();
      alert(errorData.error || "Failed to create project");
      return;
    }

    const newProj = await res.json();
    setProjects(prev => [...prev, newProj]);
    setSelectedProjectId(newProj.id);
    setIsNewProjectModalOpen(false);
    setNewProjectName("");
    setViewMode("project");

    // Update storage size
    apiFetch("/api/stats/storage")
      .then(res => res.json())
      .then(data => setStorageSize(data.size));
  };

  const handleInstallDependencies = async (id: string) => {
    await apiFetch(`/api/projects/${id}/install`, { method: "POST" });
  };

  const [isSyncingFiles, setIsSyncingFiles] = useState(false);
  const handleSyncFiles = async (id: string) => {
    setIsSyncingFiles(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/sync-files`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert(data.message);
        fetchProjectFiles(id);
      } else {
        alert(data.error);
      }
    } catch (error) {
      alert("Failed to sync files from database");
    } finally {
      setIsSyncingFiles(false);
    }
  };

  const [isBackingUp, setIsBackingUp] = useState(false);
  const handlePushToCloud = async (id: string) => {
    setIsBackingUp(true);
    try {
      const res = await apiFetch(`/api/projects/${id}/backup`, { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        alert("Project successfully backed up to database!");
      } else {
        alert(data.error || "Backup failed");
      }
    } catch (err) {
      alert("Error during cloud backup");
    } finally {
      setIsBackingUp(false);
    }
  };

  const handleDownloadZip = async (id: string, name: string) => {
    try {
      const res = await apiFetch(`/api/projects/${id}/zip`);
      if (!res.ok) throw new Error("Download failed");
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/\s+/g, "_")}.zip`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      alert("Failed to download ZIP. Please try again.");
    }
  };

  const handleDownloadFile = async (projectId: string, fileName: string) => {
    try {
      const res = await apiFetch(`/api/projects/${projectId}/files/${fileName}`);
      if (!res.ok) throw new Error("Download failed");
      
      const blob = await res.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      alert("Failed to download file. Please try again.");
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedProjectId || !e.target.files?.length) return;
    
    const formData = new FormData();
    formData.append("projectId", selectedProjectId);
    Array.from(e.target.files).forEach((file: File) => {
      formData.append("files", file);
    });

    await apiFetch("/api/upload", {
      method: "POST",
      body: formData,
    });
    
    // Refresh file list
    fetchProjectFiles(selectedProjectId);

    // Update storage size
    apiFetch("/api/stats/storage")
      .then(res => res.json())
      .then(data => setStorageSize(data.size));
    
    // Add a log message locally to show upload started
    setLogs(prev => ({
      ...prev,
      [selectedProjectId]: [...(prev[selectedProjectId] || []), {
        projectId: selectedProjectId,
        message: `[SYSTEM] Uploaded ${e.target.files?.length} files.`,
        timestamp: new Date().toISOString()
      }]
    }));
  };

  const handleSetMainFile = async (fileName: string) => {
    if (!selectedProjectId) return;
    const res = await apiFetch(`/api/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mainFile: fileName }),
    });
    const data = await res.json();
    if (res.ok) {
      setProjects(prev => prev.map(p => p.id === selectedProjectId ? data : p));
    } else {
      alert(data.error || "Failed to set main file");
    }
  };

  const handleOpenEnvModal = () => {
    if (!selectedProject) return;
    const vars = Object.entries(selectedProject.env || {}).map(([key, value]) => ({ key, value }));
    setEnvVars(vars.length > 0 ? vars : [{ key: "", value: "" }]);
    setIsEnvModalOpen(true);
  };

  const handleSaveEnv = async () => {
    if (!selectedProjectId) return;
    const envObj = envVars.reduce((acc, { key, value }) => {
      if (key.trim()) acc[key.trim()] = value;
      return acc;
    }, {} as { [key: string]: string });

    const res = await apiFetch(`/api/projects/${selectedProjectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ env: envObj }),
    });
    const data = await res.json();
    if (res.ok) {
      setProjects(prev => prev.map(p => p.id === selectedProjectId ? data : p));
      setIsEnvModalOpen(false);
    } else {
      alert(data.error || "Failed to save environment variables");
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Are you sure you want to delete this project? This action cannot be undone.")) return;
    
    await apiFetch(`/api/projects/${id}`, { method: "DELETE" });
    setProjects(prev => prev.filter(p => p.id !== id));
    if (selectedProjectId === id) {
      setSelectedProjectId(projects.length > 1 ? projects.find(p => p.id !== id)?.id || null : null);
      setViewMode("dashboard");
    }

    // Update storage size
    apiFetch("/api/stats/storage")
      .then(res => res.json())
      .then(data => setStorageSize(data.size));
  };

  const runningBots = projects.filter(p => p.status === "running").length;
  const stoppedBots = projects.filter(p => p.status === "stopped").length;
  const totalBots = projects.length;

  return (
    <div className="flex h-screen bg-[#0a0a0a] text-zinc-100 font-sans selection:bg-blue-500/30 overflow-hidden">
      {/* Auth Screen */}
      <AnimatePresence>
        {!user && !isAuthLoading && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[110] bg-[#050505] flex flex-col items-center justify-center p-6"
          >
            <div className="absolute inset-0 overflow-hidden pointer-events-none">
              <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-blue-600/10 blur-[120px] rounded-full" />
              <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-orange-600/10 blur-[120px] rounded-full" />
            </div>

            <motion.div 
              initial={{ scale: 0.9, y: 20, opacity: 0 }}
              animate={{ scale: 1, y: 0, opacity: 1 }}
              className="w-full max-w-md space-y-8 relative z-10"
            >
              <div className="text-center space-y-4">
                <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center shadow-2xl shadow-blue-900/40 mx-auto mb-6">
                  <Bot className="text-white" size={40} />
                </div>
                <h1 className="text-4xl font-black tracking-tighter uppercase italic">BotHost <span className="text-blue-500">Pro</span></h1>
                <p className="text-zinc-500 font-medium">{authMode === "login" ? "Welcome back! Please login." : "Create an account to start hosting."}</p>
              </div>

              <form onSubmit={handleAuth} className="bg-zinc-900/50 border border-zinc-800 p-8 rounded-3xl space-y-6 backdrop-blur-xl">
                <div className="space-y-4">
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 ml-1">Username</label>
                    <input 
                      type="text" 
                      value={authUsername}
                      onChange={(e) => setAuthUsername(e.target.value)}
                      placeholder="Enter username"
                      className="w-full bg-[#0a0a0a] border border-zinc-800 rounded-2xl px-6 py-4 text-lg focus:outline-none focus:border-blue-600 transition-all"
                    />
                  </div>
                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 ml-1">Password</label>
                    <input 
                      type="password" 
                      value={authPassword}
                      onChange={(e) => setAuthPassword(e.target.value)}
                      placeholder="••••••••"
                      className="w-full bg-[#0a0a0a] border border-zinc-800 rounded-2xl px-6 py-4 text-lg focus:outline-none focus:border-blue-600 transition-all"
                    />
                  </div>
                </div>

                <button 
                  type="submit"
                  disabled={!authUsername || !authPassword || isAuthLoading}
                  className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded-2xl font-bold text-sm transition-all shadow-xl shadow-blue-900/20 flex items-center justify-center gap-3 group"
                >
                  {isAuthLoading ? (
                    <Activity className="animate-spin" size={18} />
                  ) : (
                    <>
                      <span>{authMode === "login" ? "Login" : "Register"}</span>
                      <ChevronRight size={18} className="group-hover:translate-x-1 transition-transform" />
                    </>
                  )}
                </button>

                <div className="text-center">
                  <button 
                    type="button"
                    onClick={() => setAuthMode(authMode === "login" ? "register" : "login")}
                    className="text-xs text-zinc-500 hover:text-blue-500 transition-colors font-medium"
                  >
                    {authMode === "login" ? "Don't have an account? Register" : "Already have an account? Login"}
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sidebar Overlay */}
      <AnimatePresence>
        {isSidebarOpen && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setIsSidebarOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm z-40 lg:hidden"
          />
        )}
      </AnimatePresence>

      {/* Sidebar */}
      <motion.aside 
        initial={false}
        animate={{ 
          x: isSidebarOpen ? 0 : -288,
          width: isSidebarOpen ? 288 : 0
        }}
        className={cn(
          "fixed lg:relative z-50 h-full border-r border-zinc-800 flex flex-col bg-[#0d0d0d] overflow-hidden whitespace-nowrap transition-all duration-300 ease-in-out",
          !isSidebarOpen && "lg:w-0 lg:border-none"
        )}
      >
        <div className="p-6 flex items-center gap-3 border-b border-zinc-800">
          <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-900/20 shrink-0">
            <Bot className="text-white" size={24} />
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-lg tracking-tight truncate">BotHost</h1>
            <p className="text-xs text-zinc-500 font-medium truncate">Management Console</p>
          </div>
        </div>

        <div className="p-4 flex-1 overflow-y-auto space-y-6 custom-scrollbar">
          <div>
            <div className="flex items-center justify-between px-2 mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Navigation</h2>
            </div>
            <div className="space-y-1">
              <button
                onClick={() => { setViewMode("dashboard"); setIsSidebarOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                  viewMode === "dashboard" ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900"
                )}
              >
                <Activity size={18} />
                <span className="text-sm font-medium">Dashboard</span>
              </button>
              <button
                onClick={() => { setViewMode("community" as any); setIsSidebarOpen(false); }}
                className={cn(
                  "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                  viewMode === ("community" as any) ? "bg-zinc-800 text-white" : "text-zinc-400 hover:bg-zinc-900"
                )}
              >
                <Users size={18} />
                <span className="text-sm font-medium">Community</span>
              </button>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between px-2 mb-3">
              <h2 className="text-[11px] font-bold uppercase tracking-widest text-zinc-500">Projects</h2>
              <button 
                onClick={() => {
                  if (subscription.limit === 0) {
                    alert("You didn't subscribe any plans please contact admin to get access.");
                    return;
                  }
                  setIsNewProjectModalOpen(true);
                }}
                className={cn(
                  "p-1 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-white",
                  subscription.limit === 0 && "opacity-50 cursor-not-allowed"
                )}
              >
                <Plus size={16} />
              </button>
            </div>
            <div className="space-y-1">
              {projects.map(project => (
                <button
                  key={project.id}
                  onClick={() => { setSelectedProjectId(project.id); setViewMode("project"); setIsSidebarOpen(false); }}
                  className={cn(
                    "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all group",
                    selectedProjectId === project.id && viewMode === "project"
                      ? "bg-zinc-800 text-white shadow-sm" 
                      : "text-zinc-400 hover:bg-zinc-900 hover:text-zinc-200"
                  )}
                >
                  <div className={cn(
                    "w-2 h-2 rounded-full shrink-0",
                    project.status === "running" ? "bg-green-500 animate-pulse" : "bg-zinc-600"
                  )} />
                  <span className="flex-1 text-left text-sm font-medium truncate">{project.name}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <div className="p-4 border-t border-zinc-800 space-y-4">
          {/* Subscription Summary */}
          <div className="p-3 rounded-xl bg-zinc-900/30 border border-zinc-800/50 space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">RAM Usage</span>
              <span className="text-[10px] font-bold text-zinc-400">{globalStats?.totalMemory || 0} MB</span>
            </div>
              <div className="flex items-center justify-between">
                <span className="text-[9px] font-bold uppercase tracking-widest text-zinc-600">Storage</span>
                <span className="text-[10px] font-bold text-zinc-400">{globalStats?.totalStorage || 0} MB</span>
              </div>
              <div className="h-1 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div 
                  animate={{ width: `${Math.min(100, ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) / 2560 * 100)}%` }}
                  className={cn(
                    "h-full",
                    ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) > 2048 ? "bg-red-500" : "bg-blue-500"
                  )}
                />
              </div>
            </div>

          <div className="flex items-center gap-3 px-3 py-2 rounded-lg bg-zinc-900/50 border border-zinc-800/50">
            <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center text-xs font-bold shrink-0 text-white">
              {user?.username?.substring(0, 2).toUpperCase() || "GU"}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-bold truncate">{user?.username || "Guest User"}</p>
              <div className="flex items-center gap-1.5">
                <p className="text-[10px] text-zinc-500 truncate uppercase tracking-widest font-bold">
                  {user?.subscription_plan || "FREE"} PLAN
                </p>
                <div className="w-1 h-1 rounded-full bg-zinc-800" />
                <div className={cn(
                  "w-1.5 h-1.5 rounded-full",
                  dbStatus?.connected ? "bg-green-500" : "bg-red-500"
                )} title={dbStatus?.connected ? "Database Connected" : "Database Disconnected"} />
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button 
                onClick={() => setIsProfileModalOpen(true)}
                className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Profile Settings"
              >
                <User size={14} />
              </button>
              <button 
                onClick={() => setIsAdminPanelOpen(true)}
                className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-600 hover:text-zinc-400 transition-colors"
                title="Admin Panel"
              >
                <Settings size={14} />
              </button>
              <button 
                onClick={handleLogout}
                className="p-1.5 hover:bg-zinc-800 rounded-md text-zinc-600 hover:text-red-400 transition-colors"
                title="Logout"
              >
                <LogOut size={14} />
              </button>
            </div>
          </div>
        </div>
      </motion.aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        {/* Top Nav */}
        <div className="p-4 flex items-center gap-4">
          <button 
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 bg-zinc-900/50 border border-zinc-800 text-zinc-400 hover:text-white rounded-lg shadow-xl transition-all active:scale-95"
          >
            <Menu size={20} />
          </button>
          
          <AnimatePresence>
            {isWelcomeVisible && (
              <motion.div 
                initial={{ opacity: 0, y: -20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -20 }}
                className="flex-1 max-w-md bg-green-900/20 border border-green-900/30 px-4 py-2 rounded-xl flex items-center justify-between"
              >
                <span className="text-sm font-medium text-green-400">Welcome back!</span>
                <button onClick={() => {
                  setIsWelcomeVisible(false);
                  localStorage.setItem("welcome_dismissed", "true");
                }} className="text-green-400/50 hover:text-green-400">
                  <X size={16} />
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-6 lg:p-10">
          {viewMode === ("community" as any) ? (
            <div className="max-w-4xl mx-auto space-y-10">
              <div className="flex flex-col gap-6">
                <h1 className="text-4xl font-bold tracking-tight">Community</h1>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500" size={20} />
                  <input 
                    type="text"
                    placeholder="Search users by username..."
                    value={searchQuery}
                    onChange={(e) => handleSearchUsers(e.target.value)}
                    className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl pl-12 pr-6 py-4 text-lg focus:outline-none focus:border-blue-600 transition-all"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {Array.isArray(communityUsers) && communityUsers.map((u) => (
                  <motion.div 
                    key={u.id}
                    initial={{ opacity: 0, y: 20 }}
                    animate={{ opacity: 1, y: 0 }}
                    onClick={() => handleViewProfile(u.id)}
                    className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl hover:border-zinc-700 transition-all cursor-pointer group"
                  >
                    <div className="flex items-center gap-4">
                      <div className="w-14 h-14 rounded-2xl bg-blue-600 flex items-center justify-center text-xl font-bold text-white shadow-lg shadow-blue-900/20">
                        {u.username.substring(0, 2).toUpperCase()}
                      </div>
                      <div className="flex-1 min-w-0">
                        <h3 className="text-xl font-bold truncate group-hover:text-blue-400 transition-colors">{u.username}</h3>
                        <div className="flex items-center gap-2 mt-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                            {u.subscription_plan || "Free"}
                          </span>
                          <span className="text-zinc-600 text-xs">•</span>
                          <span className="text-xs text-zinc-500">Joined {new Date(u.created_at).toLocaleDateString()}</span>
                        </div>
                      </div>
                      <ChevronRight className="text-zinc-700 group-hover:text-zinc-400 transition-colors" size={20} />
                    </div>
                  </motion.div>
                ))}
              </div>

              {searchQuery && communityUsers.length === 0 && (
                <div className="py-20 text-center bg-zinc-900/20 border border-dashed border-zinc-800 rounded-3xl">
                  <Users size={40} className="mx-auto text-zinc-700 mb-4" />
                  <p className="text-zinc-500">No users found matching "{searchQuery}"</p>
                </div>
              )}
            </div>
          ) : viewMode === "dashboard" ? (
            <div className="max-w-4xl mx-auto space-y-10">
              <div className="flex items-center justify-between">
                <h1 className="text-4xl font-bold tracking-tight">Dashboard</h1>
                {dbStatus && (
                  <div className={cn(
                    "flex items-center gap-2 px-3 py-1.5 rounded-full border text-[10px] font-bold uppercase tracking-wider transition-all",
                    dbStatus.connected ? "bg-green-500/10 border-green-500/20 text-green-500" : "bg-red-500/10 border-red-500/20 text-red-500"
                  )}>
                    <div className={cn("w-1.5 h-1.5 rounded-full", dbStatus.connected ? "bg-green-500 animate-pulse" : "bg-red-500")} />
                    {dbStatus.connected ? "Cloud Connected" : "Local Only"}
                  </div>
                )}
              </div>

              {!dbStatus?.connected && (
                <div className="bg-orange-600/10 border border-orange-600/20 p-4 rounded-2xl flex items-center justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <AlertCircle className="text-orange-500 shrink-0" size={20} />
                    <p className="text-xs text-orange-200/70 leading-relaxed italic">
                      Database not connected. Project backups and file restoration are currently unavailable.
                    </p>
                  </div>
                  <button 
                    onClick={handleFetchDbStatus}
                    className="shrink-0 text-[10px] font-bold uppercase tracking-widest text-orange-500 hover:text-orange-400 transition-colors"
                  >
                    Check Again
                  </button>
                </div>
              )}

              <button 
                onClick={() => {
                  setIsNewProjectModalOpen(true);
                }}
                className="flex items-center gap-2 px-6 py-3 rounded-xl font-bold transition-all shadow-lg active:scale-95 bg-blue-600 hover:bg-blue-500 text-white shadow-blue-900/20"
              >
                <Plus size={20} />
                New Bot
              </button>

              {/* Stats Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4 transition-all">
                  <div className="w-12 h-12 rounded-2xl flex items-center justify-center bg-blue-600/20">
                    <Bot className="text-blue-500" size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{totalBots} / {subscription.limit}</p>
                    <p className="text-xs text-zinc-500 font-medium">Bots Used</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-green-600/20 rounded-2xl flex items-center justify-center">
                    <Play className="text-green-500" size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{runningBots}</p>
                    <p className="text-xs text-zinc-500 font-medium">Running</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-red-600/20 rounded-2xl flex items-center justify-center">
                    <Circle className="text-red-500" size={20} fill="currentColor" />
                  </div>
                  <div>
                    <p className="text-2xl font-bold">{stoppedBots}</p>
                    <p className="text-xs text-zinc-500 font-medium">Stopped</p>
                  </div>
                </div>

                <div className="bg-zinc-900/50 border border-zinc-800 p-6 rounded-3xl flex items-center gap-4">
                  <div className="w-12 h-12 bg-yellow-600/20 rounded-2xl flex items-center justify-center">
                    <Database className="text-yellow-500" size={24} />
                  </div>
                  <div>
                    <p className="text-2xl font-bold font-mono">{formatSize(storageSize)}</p>
                    <p className="text-xs text-zinc-500 font-medium">of 2.5 GB Storage</p>
                  </div>
                </div>
              </div>

              {/* Bot List */}
              <div className="space-y-6">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-2">
                    <Bot size={20} className="text-zinc-400" />
                    <h2 className="text-xl font-bold tracking-tight">Your Bots</h2>
                  </div>
                  
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
                      <input 
                        type="text" 
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        placeholder="Search bots..."
                        className="bg-zinc-900 border border-zinc-800 rounded-xl pl-9 pr-4 py-2 text-xs focus:outline-none focus:border-blue-600 transition-all w-full sm:w-48"
                      />
                    </div>
                    <div className="flex items-center gap-2 text-[10px] text-zinc-500 font-bold uppercase tracking-widest bg-zinc-900/50 border border-zinc-800 px-3 py-2 rounded-xl">
                      <span className="flex items-center gap-1.5"><Circle size={6} className="fill-green-500 text-green-500" /> {runningBots}</span>
                      <span className="w-px h-2 bg-zinc-800 mx-1" />
                      <span className="flex items-center gap-1.5"><Circle size={6} className="fill-zinc-600 text-zinc-600" /> {stoppedBots}</span>
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {projects.filter(p => p.name.toLowerCase().includes(searchQuery.toLowerCase())).map(project => (
                    <motion.div 
                      key={project.id}
                      layout
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="bg-zinc-900/50 border border-zinc-800 rounded-3xl p-6 relative group hover:border-zinc-700 transition-all"
                    >
                      <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                          <div className={cn(
                            "w-10 h-10 rounded-xl flex items-center justify-center transition-colors",
                            project.status === "running" ? "bg-green-600/20" : "bg-zinc-800"
                          )}>
                            <Send size={18} className={cn(
                              project.status === "running" ? "text-green-500" : "text-zinc-500"
                            )} />
                          </div>
                          <div>
                            <h3 className="text-lg font-bold truncate">{project.name}</h3>
                            <p className="text-[10px] text-zinc-500 font-mono uppercase tracking-wider">{project.type} Runtime</p>
                          </div>
                        </div>
                        <div className={cn(
                          "w-2.5 h-2.5 rounded-full",
                          project.status === "running" ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" : "bg-zinc-700"
                        )} />
                      </div>

                      <div className="grid grid-cols-2 gap-4 mb-8">
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Main File</p>
                          <div className="flex items-center gap-2 text-zinc-400">
                            <FileCode size={12} />
                            <span className="text-xs font-medium truncate">{project.mainFile}</span>
                          </div>
                        </div>
                        <div className="space-y-1">
                          <p className="text-[10px] font-bold uppercase tracking-widest text-zinc-600">Uptime</p>
                          <div className="flex items-center gap-2 text-zinc-400">
                            <Clock size={12} />
                            <span className="text-xs font-medium font-mono">{formatUptime(project.metrics?.uptime || 0)}</span>
                          </div>
                        </div>
                      </div>

                      <div className="flex gap-2">
                        <button 
                          onClick={() => handleLikeProject(project.id)}
                          className="p-2.5 bg-zinc-800 hover:bg-pink-600/10 text-zinc-500 hover:text-pink-500 rounded-xl transition-all border border-transparent hover:border-pink-600/20 flex items-center gap-2"
                        >
                          <Heart size={14} fill={project.likes ? "currentColor" : "none"} />
                          <span className="text-xs font-bold">{project.likes || 0}</span>
                        </button>
                        <button 
                          onClick={() => handleDownloadZip(project.id, project.name)}
                          className="p-2.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-white rounded-xl transition-all border border-transparent hover:border-zinc-700 flex items-center justify-center"
                          title="Download Project ZIP"
                        >
                          <FileArchive size={14} />
                        </button>
                        {project.status === "stopped" ? (
                          <button 
                            onClick={() => handleStartProject(project.id)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-green-600/10 hover:bg-green-600/20 text-green-500 rounded-xl font-bold text-sm transition-all border border-green-600/20"
                          >
                            <Play size={14} fill="currentColor" />
                            Start
                          </button>
                        ) : (
                          <button 
                            onClick={() => handleStopProject(project.id)}
                            className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-red-600/10 hover:bg-red-600/20 text-red-500 rounded-xl font-bold text-sm transition-all border border-red-600/20"
                          >
                            <Square size={14} fill="currentColor" />
                            Stop
                          </button>
                        )}
                        <button 
                          onClick={() => { setSelectedProjectId(project.id); setViewMode("project"); }}
                          className="flex-1 flex items-center justify-center gap-2 px-4 py-2.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-500 rounded-xl font-bold text-sm transition-all border border-blue-600/20"
                        >
                          <Terminal size={14} />
                          Console
                        </button>
                        <button 
                          onClick={() => handleDeleteProject(project.id)}
                          className="p-2.5 bg-zinc-800 hover:bg-red-600/10 text-zinc-500 hover:text-red-500 rounded-xl transition-all border border-transparent hover:border-red-600/20"
                          title="Delete Bot"
                        >
                          <X size={14} />
                        </button>
                      </div>
                    </motion.div>
                  ))}

                  {projects.length === 0 && (
                    <div className="py-20 text-center bg-zinc-900/20 border border-dashed border-zinc-800 rounded-3xl">
                      <Bot size={40} className="mx-auto text-zinc-700 mb-4" />
                      <p className="text-zinc-500">No bots created yet. Click "New Bot" to get started.</p>
                    </div>
                  )}
                </div>
              </div>
            </div>
          ) : selectedProject ? (
            <div className="max-w-5xl mx-auto h-full flex flex-col p-6 lg:p-10 gap-8">
              {/* Project Header */}
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex items-center gap-4">
                  <button 
                    onClick={() => setViewMode("dashboard")}
                    className="w-10 h-10 flex items-center justify-center bg-zinc-900 border border-zinc-800 text-zinc-400 hover:text-white rounded-xl transition-all active:scale-95"
                  >
                    <ChevronRight className="rotate-180" size={20} />
                  </button>
                  <div>
                    <div className="flex items-center gap-3">
                      <h2 className="text-3xl font-bold tracking-tight">{selectedProject?.name}</h2>
                      <div className={cn(
                        "w-2.5 h-2.5 rounded-full",
                        selectedProject?.status === "running" ? "bg-green-500 shadow-[0_0_10px_rgba(34,197,94,0.5)] animate-pulse" : "bg-zinc-700"
                      )} />
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-zinc-500 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800">
                        {selectedProject?.type}
                      </span>
                      <span className="text-zinc-600 text-xs">•</span>
                      <span className="text-xs text-zinc-500 font-medium font-mono">{selectedProject?.mainFile}</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex items-center bg-zinc-900 border border-zinc-800 rounded-xl p-1">
                    <label className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg font-bold text-xs transition-all cursor-pointer">
                      <Plus size={14} />
                      Upload
                      <input type="file" multiple className="hidden" onChange={handleFileUpload} />
                    </label>
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <button 
                      onClick={() => selectedProject && handleInstallDependencies(selectedProject.id)}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg font-bold text-xs transition-all"
                    >
                      <Settings size={14} />
                      Install
                    </button>
                    <div className="w-px h-4 bg-zinc-800 mx-1" />
                    <button 
                      onClick={handleOpenEnvModal}
                      className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 text-zinc-400 hover:text-white rounded-lg font-bold text-xs transition-all"
                    >
                      <Terminal size={14} />
                      Env
                    </button>
                  </div>

                  {selectedProject.status === "stopped" ? (
                    <button 
                      onClick={() => handleStartProject(selectedProject.id)}
                      className="flex items-center gap-2 px-6 py-2.5 bg-green-600 hover:bg-green-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-green-900/20 active:scale-95"
                    >
                      <Play size={16} fill="currentColor" />
                      Start Bot
                    </button>
                  ) : (
                    <button 
                      onClick={() => handleStopProject(selectedProject.id)}
                      className="flex items-center gap-2 px-6 py-2.5 bg-red-600 hover:bg-red-500 text-white rounded-xl font-bold text-sm transition-all shadow-lg shadow-red-900/20 active:scale-95"
                    >
                      <Square size={16} fill="currentColor" />
                      Stop Bot
                    </button>
                  )}

                  <button 
                    onClick={() => handleDownloadZip(selectedProject.id, selectedProject.name)}
                    className="flex items-center gap-2 px-5 py-2.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 rounded-xl font-bold text-sm transition-all shadow-lg active:scale-95"
                  >
                    <FileArchive size={16} />
                    <span>Download Source (ZIP)</span>
                  </button>

                  <button 
                    onClick={() => handleDeleteProject(selectedProject.id)}
                    className="p-2.5 bg-zinc-900 border border-zinc-800 text-zinc-500 hover:text-red-500 rounded-xl transition-all hover:border-red-500/30 active:scale-95"
                    title="Delete Project"
                  >
                    <Square size={18} />
                  </button>
                </div>
              </div>

              {/* Stats Grid */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: "Status", value: selectedProject?.status, icon: Activity, color: selectedProject?.status === "running" ? "text-green-500" : "text-zinc-500" },
                  { label: "Uptime", value: formatUptime(selectedProject?.metrics?.uptime || 0), icon: Clock, color: "text-zinc-400" },
                  { label: "Memory Usage", value: `${selectedProject?.metrics?.memory || 0} MB`, icon: Cpu, color: "text-zinc-400" },
                  { label: "CPU Load", value: `${selectedProject?.metrics?.cpu || 0}%`, icon: Activity, color: "text-zinc-400" },
                ].map((stat, i) => (
                  <div key={i} className="bg-zinc-900/50 border border-zinc-800 p-5 rounded-3xl group hover:border-zinc-700 transition-all">
                    <div className="flex items-center justify-between mb-3">
                      <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500 group-hover:text-zinc-400 transition-colors">{stat.label}</span>
                      <stat.icon size={14} className="text-zinc-600 group-hover:text-zinc-400 transition-colors" />
                    </div>
                    <p className={cn("text-xl font-bold tracking-tight capitalize font-mono", stat.color)}>{stat.value}</p>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 flex-1 overflow-hidden">
                {/* File Manager */}
                <div className="lg:col-span-1 bg-zinc-900/30 border border-zinc-800 rounded-3xl flex flex-col overflow-hidden">
                  <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/50">
                    <div className="flex items-center gap-2">
                      <Folder size={16} className="text-zinc-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Project Files</span>
                    </div>
                    {selectedProjectId && (
                      <div className="flex gap-1">
                        <button 
                          onClick={() => handlePushToCloud(selectedProjectId)}
                          disabled={isBackingUp}
                          className="p-1.5 bg-zinc-800/50 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-white transition-all disabled:opacity-50"
                          title="Backup Files to Cloud"
                        >
                          <CloudUpload size={14} className={isBackingUp ? "animate-pulse" : ""} />
                        </button>
                        <button 
                          onClick={() => handleSyncFiles(selectedProjectId)}
                          disabled={isSyncingFiles}
                          className="p-1.5 bg-zinc-800/50 hover:bg-zinc-800 rounded-md text-zinc-500 hover:text-white transition-all disabled:opacity-50"
                          title="Restore Files from Cloud"
                        >
                          <CloudDownload size={14} className={isSyncingFiles ? "animate-pulse" : ""} />
                        </button>
                        <button 
                          onClick={() => handleDownloadZip(selectedProjectId, selectedProject?.name || "project")}
                          className="flex items-center gap-1.5 px-3 py-1 bg-zinc-800/50 hover:bg-zinc-800 rounded-md text-[10px] font-bold uppercase tracking-wider text-zinc-400 hover:text-white transition-all"
                          title="Download All as ZIP"
                        >
                          <FileArchive size={12} />
                          <span>ZIP</span>
                        </button>
                      </div>
                    )}
                  </div>
                  <div className="flex-1 overflow-y-auto p-3 custom-scrollbar space-y-1">
                    {projectFiles.length > 0 ? (
                      projectFiles.map(file => (
                        <div key={file} className="flex gap-1 group/file">
                          <button
                            onClick={() => handleSetMainFile(file)}
                            className={cn(
                              "flex-1 flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm transition-all group",
                              selectedProject?.mainFile === file 
                                ? "bg-blue-600/10 text-blue-500 border border-blue-600/20" 
                                : "text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 border border-transparent"
                            )}
                          >
                            {file.endsWith('.py') ? <Cpu size={14} /> : <FileCode size={14} />}
                            <span className="flex-1 text-left truncate font-medium">{file}</span>
                            {selectedProject?.mainFile === file && <CheckCircle2 size={14} className="text-blue-500" />}
                          </button>
                          <button 
                            onClick={() => handleDownloadFile(selectedProjectId, file)}
                            className="p-2.5 text-zinc-600 hover:text-white hover:bg-zinc-800 rounded-xl transition-all self-center flex items-center justify-center opacity-0 group-hover/file:opacity-100 focus:opacity-100"
                            title="Download File"
                          >
                            <Download size={14} />
                          </button>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-600 gap-3 p-8">
                        <div className="w-12 h-12 bg-zinc-900 rounded-full flex items-center justify-center mb-2">
                          <AlertCircle size={24} strokeWidth={1.5} className="text-zinc-700" />
                        </div>
                        <p className="text-xs font-medium text-center leading-relaxed">No files found locally.</p>
                        <button 
                          onClick={() => handleSyncFiles(selectedProjectId!)}
                          className="text-[10px] font-bold uppercase tracking-widest text-blue-500 hover:text-blue-400 flex items-center gap-2 mt-2"
                        >
                          <CloudDownload size={14} />
                          <span>Restore from Cloud</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>

                {/* Console */}
                <div className="lg:col-span-2 flex flex-col bg-black rounded-3xl border border-zinc-800 overflow-hidden shadow-2xl">
                  <div className="px-6 py-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Terminal size={14} className="text-zinc-500" />
                      <span className="text-xs font-bold uppercase tracking-widest text-zinc-400">Live Console</span>
                    </div>
                    <div className="flex gap-1.5">
                      <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                      <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                      <div className="w-2.5 h-2.5 rounded-full bg-zinc-800" />
                    </div>
                  </div>
                  <div className="flex-1 p-6 font-mono text-[11px] overflow-y-auto space-y-2 custom-scrollbar bg-[#050505]">
                    {logs[selectedProject.id]?.length ? (
                      logs[selectedProject.id].map((log, i) => (
                        <div key={i} className="flex gap-4 group">
                          <span className="text-zinc-800 select-none shrink-0">{new Date(log.timestamp).toLocaleTimeString([], { hour12: false })}</span>
                          <span className={cn(
                            "flex-1 break-all",
                            log.message.includes("[SUCCESS]") ? "text-green-400" :
                            log.message.includes("[DEBUG]") ? "text-zinc-600 italic" :
                            log.message.includes("[ERROR]") ? "text-red-400" :
                            log.message.includes("[INSTALL]") ? "text-blue-400" : "text-zinc-400"
                          )}>
                            {log.message}
                          </span>
                        </div>
                      ))
                    ) : (
                      <div className="h-full flex flex-col items-center justify-center text-zinc-700 gap-3">
                        <Terminal size={40} strokeWidth={1} className="opacity-20" />
                        <p className="text-sm font-sans">Waiting for application logs...</p>
                      </div>
                    )}
                    <div ref={logEndRef} />
                  </div>
                </div>
              </div>
            </div>
          ) : (
            <div className="flex-1 flex flex-col items-center justify-center text-zinc-500 gap-4">
              <Bot size={48} className="text-zinc-800 animate-pulse" />
              <p className="text-sm font-medium">Loading project details...</p>
              <button 
                onClick={() => setViewMode("dashboard")}
                className="text-xs text-blue-500 hover:underline"
              >
                Back to Dashboard
              </button>
            </div>
          )}
        </div>
      </main>

      {/* New Project Modal */}
      <AnimatePresence>
        {isNewProjectModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsNewProjectModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-md bg-[#0d0d0d] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-800">
                <h3 className="text-xl font-bold tracking-tight">Create New Project</h3>
                <p className="text-sm text-zinc-500 mt-1">Set up a new environment for your bot.</p>
              </div>
              <div className="p-6 space-y-6">
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Project Name</label>
                  <input 
                    type="text" 
                    value={newProjectName}
                    onChange={(e) => setNewProjectName(e.target.value)}
                    placeholder="e.g. My Awesome Bot"
                    className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-orange-600 transition-colors"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold uppercase tracking-widest text-zinc-500 mb-2">Runtime Environment</label>
                  <div className="grid grid-cols-2 gap-3">
                    <button 
                      onClick={() => setNewProjectType("node")}
                      className={cn(
                        "flex items-center justify-center gap-3 p-4 rounded-xl border transition-all",
                        newProjectType === "node" ? "bg-orange-600/10 border-orange-600 text-orange-500" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <FileCode size={20} />
                      <span className="font-bold text-sm">Node.js</span>
                    </button>
                    <button 
                      onClick={() => setNewProjectType("python")}
                      className={cn(
                        "flex items-center justify-center gap-3 p-4 rounded-xl border transition-all",
                        newProjectType === "python" ? "bg-blue-600/10 border-blue-600 text-blue-500" : "bg-zinc-900 border-zinc-800 text-zinc-400 hover:border-zinc-700"
                      )}
                    >
                      <Cpu size={20} />
                      <span className="font-bold text-sm">Python</span>
                    </button>
                  </div>
                </div>
              </div>
              <div className="p-6 bg-zinc-900/50 border-t border-zinc-800 flex gap-3">
                <button 
                  onClick={() => setIsNewProjectModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-sm transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleCreateProject}
                  disabled={!newProjectName}
                  className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-500 disabled:opacity-50 disabled:hover:bg-orange-600 rounded-xl font-bold text-sm transition-all shadow-lg shadow-orange-900/20"
                >
                  Create Project
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* Environment Variables Modal */}
      <AnimatePresence>
        {isEnvModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsEnvModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-lg bg-[#0d0d0d] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold tracking-tight">Environment Variables</h3>
                  <p className="text-sm text-zinc-500 mt-1">Configure secrets and config for your bot.</p>
                </div>
                <button 
                  onClick={() => setEnvVars([...envVars, { key: "", value: "" }])}
                  className="p-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg text-zinc-300 transition-all"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="p-6 max-h-[400px] overflow-y-auto space-y-4 custom-scrollbar">
                {envVars.map((v, i) => (
                  <div key={i} className="flex gap-3 items-start">
                    <div className="flex-1 space-y-1">
                      <input 
                        type="text" 
                        value={v.key}
                        onChange={(e) => {
                          const newVars = [...envVars];
                          newVars[i].key = e.target.value;
                          setEnvVars(newVars);
                        }}
                        placeholder="VARIABLE_NAME"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono focus:outline-none focus:border-orange-600 transition-colors"
                      />
                    </div>
                    <div className="flex-1 space-y-1">
                      <input 
                        type="text" 
                        value={v.value}
                        onChange={(e) => {
                          const newVars = [...envVars];
                          newVars[i].value = e.target.value;
                          setEnvVars(newVars);
                        }}
                        placeholder="value"
                        className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-2 text-xs font-mono focus:outline-none focus:border-orange-600 transition-colors"
                      />
                    </div>
                    <button 
                      onClick={() => setEnvVars(envVars.filter((_, idx) => idx !== i))}
                      className="p-2 text-zinc-600 hover:text-red-500 transition-colors mt-1"
                    >
                      <Square size={14} />
                    </button>
                  </div>
                ))}
                {envVars.length === 0 && (
                  <div className="text-center py-8 text-zinc-600">
                    <p className="text-sm">No environment variables set.</p>
                  </div>
                )}
              </div>
              <div className="p-6 bg-zinc-900/50 border-t border-zinc-800 flex gap-3">
                <button 
                  onClick={() => setIsEnvModalOpen(false)}
                  className="flex-1 px-4 py-3 bg-zinc-800 hover:bg-zinc-700 rounded-xl font-bold text-sm transition-all"
                >
                  Cancel
                </button>
                <button 
                  onClick={handleSaveEnv}
                  className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-500 rounded-xl font-bold text-sm transition-all shadow-lg shadow-orange-900/20"
                >
                  Save Variables
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      
      {/* User Profile Modal */}
      <AnimatePresence>
        {isCommunityModalOpen && selectedUser && (
          <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsCommunityModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-2xl bg-[#0d0d0d] border border-zinc-800 rounded-3xl shadow-2xl overflow-hidden"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/30">
                <div className="flex items-center gap-6">
                  <div className="w-20 h-20 rounded-3xl bg-blue-600 flex items-center justify-center text-3xl font-bold text-white shadow-2xl shadow-blue-900/40">
                    {selectedUser.username.substring(0, 2).toUpperCase()}
                  </div>
                  <div>
                    <h3 className="text-3xl font-bold tracking-tight">{selectedUser.username}</h3>
                    <div className="flex items-center gap-3 mt-2">
                      <span className="text-xs font-bold uppercase tracking-wider text-blue-400 bg-blue-400/10 px-2 py-1 rounded-lg border border-blue-400/20">
                        {selectedUser.subscription_plan || "Free"} Plan
                      </span>
                      <span className="text-zinc-600 text-xs">•</span>
                      <span className="text-xs text-zinc-500 font-medium">Member since {new Date(selectedUser.created_at).toLocaleDateString()}</span>
                    </div>
                  </div>
                </div>
                <button onClick={() => setIsCommunityModalOpen(false)} className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-500 transition-colors">
                  <X size={24} />
                </button>
              </div>

              <div className="p-8 space-y-8">
                <div>
                  <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">Public Bots</h4>
                  <div className="grid grid-cols-1 gap-3">
                    {selectedUser.projects?.length > 0 ? (
                      selectedUser.projects.map((p: any) => (
                        <div key={p.id} className="flex items-center justify-between p-4 bg-zinc-900/50 border border-zinc-800 rounded-2xl group hover:border-zinc-700 transition-all">
                          <div className="flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center text-zinc-500">
                              <Bot size={20} />
                            </div>
                            <div>
                              <p className="font-bold text-sm">{p.name}</p>
                              <p className="text-[10px] text-zinc-500 uppercase tracking-wider font-bold mt-0.5">{p.type}</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-4">
                            <div className="flex items-center gap-1.5 text-zinc-500">
                              <Heart size={14} className="text-pink-500" fill="currentColor" />
                              <span className="text-xs font-bold font-mono">{p.likes || 0}</span>
                            </div>
                            <button 
                              onClick={() => handleLikeProject(p.id)}
                              className="px-4 py-2 bg-pink-600/10 hover:bg-pink-600 text-pink-500 hover:text-white rounded-xl text-xs font-bold transition-all border border-pink-600/20 hover:border-transparent"
                            >
                              Like
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="text-center py-10 bg-zinc-900/20 border border-dashed border-zinc-800 rounded-2xl">
                        <Bot size={32} className="mx-auto text-zinc-800 mb-2" />
                        <p className="text-xs text-zinc-600">No public bots found.</p>
                      </div>
                    )}
                  </div>
                </div>

                {user?.id === selectedUser.id && (
                  <div className="pt-4 border-t border-zinc-800">
                    <h4 className="text-[10px] font-bold uppercase tracking-[0.2em] text-zinc-500 mb-4">Manage Subscription</h4>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      {["Free", "Pro", "Enterprise", "Lifetime"].map((plan) => (
                        <button
                          key={plan}
                          onClick={() => handleUpdateSubscription(plan)}
                          className={cn(
                            "px-4 py-3 rounded-xl text-xs font-bold border transition-all",
                            selectedUser.subscription_plan === plan 
                              ? "bg-blue-600 border-blue-500 text-white shadow-lg shadow-blue-900/20" 
                              : "bg-zinc-900 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                          )}
                        >
                          {plan}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {isAdminPanelOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsAdminPanelOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-sm"
            />
            <motion.div 
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="relative w-full max-w-4xl bg-[#0d0d0d] border border-zinc-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
            >
              <div className="p-6 border-b border-zinc-800 flex items-center justify-between shrink-0">
                <div>
                  <h3 className="text-xl font-bold tracking-tight">Admin Panel</h3>
                  <p className="text-sm text-zinc-500 mt-1">System status and maintenance.</p>
                </div>
                <button onClick={() => setIsAdminPanelOpen(false)} className="p-2 hover:bg-zinc-800 rounded-lg text-zinc-500">
                  <X size={20} />
                </button>
              </div>

              {!isAdminAuthenticated ? (
                <div className="p-12 flex flex-col items-center justify-center space-y-6 overflow-y-auto">
                  <div className="w-16 h-16 bg-zinc-900 border border-zinc-800 rounded-2xl flex items-center justify-center">
                    <Settings size={32} className="text-zinc-700" />
                  </div>
                  <div className="w-full max-w-xs space-y-4 text-center">
                    <h4 className="font-bold">Restricted Access</h4>
                    <input 
                      type="password" 
                      value={adminPassword}
                      onChange={(e) => setAdminPassword(e.target.value)}
                      placeholder="Admin Password"
                      className="w-full bg-zinc-900 border border-zinc-800 rounded-xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-colors text-center"
                      onKeyDown={(e) => e.key === 'Enter' && handleAdminLogin()}
                    />
                    <button 
                      onClick={handleAdminLogin}
                      className="w-full py-3 bg-blue-600 hover:bg-blue-500 rounded-xl font-bold text-sm transition-all"
                    >
                      Login to Admin
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col flex-1 min-h-0 overflow-y-auto custom-scrollbar">
                  {/* Database & System Status */}
                  <div className="p-4 bg-zinc-900/50 border-b border-zinc-800 flex items-center justify-between px-6 sticky top-0 z-10 backdrop-blur-md">
                    <div className="flex items-center gap-6">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          dbStatus?.connected ? "bg-green-500" : "bg-red-500"
                        )} />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                          DB: {dbStatus?.connected ? "Connected" : "Disconnected"}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 border-l border-zinc-800 pl-6">
                        <div className={cn(
                          "w-2 h-2 rounded-full",
                          adminStats?.maintenanceMode ? "bg-amber-500 animate-pulse" : "bg-zinc-600"
                        )} />
                        <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">
                          Maintenance: {adminStats?.maintenanceMode ? "ON" : "OFF"}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-4">
                      <button 
                        onClick={() => handleToggleMaintenance(!adminStats?.maintenanceMode)}
                        className={cn(
                          "px-3 py-1.5 rounded-lg text-[10px] font-bold uppercase tracking-widest transition-all",
                          adminStats?.maintenanceMode 
                            ? "bg-amber-500/10 text-amber-500 border border-amber-500/20 hover:bg-amber-500/20" 
                            : "bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700"
                        )}
                      >
                        {adminStats?.maintenanceMode ? "Disable" : "Enable"}
                      </button>
                      <button onClick={() => { handleFetchDbStatus(); handleFetchAdminStats(); }} className="p-2 text-zinc-500 hover:text-white transition-colors">
                        <Activity size={16} />
                      </button>
                    </div>
                  </div>

                  {/* Stats Overview & Resource Usage */}
                  <div className="border-b border-zinc-800">
                    <div className="grid grid-cols-3 gap-px bg-zinc-800">
                      <div className="bg-zinc-900/30 p-4 text-center">
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Active Bots</p>
                        <p className="text-xl font-bold text-blue-500">{adminStats?.activeBots || 0}</p>
                      </div>
                      <div className="bg-zinc-900/30 p-4 text-center">
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Total RAM</p>
                        <p className="text-xl font-bold text-emerald-500">
                          {globalStats?.totalMemory || 0} <span className="text-[10px] text-zinc-600">MB</span>
                        </p>
                      </div>
                      <div className="bg-zinc-900/30 p-4 text-center">
                        <p className="text-[10px] font-bold text-zinc-600 uppercase tracking-widest mb-1">Storage</p>
                        <p className="text-xl font-bold text-pink-500">
                          {globalStats?.totalStorage || adminStats?.totalStorage || 0} <span className="text-[10px] text-zinc-600">MB</span>
                        </p>
                      </div>
                    </div>

                    {/* Resource Usage Progress */}
                    <div className="p-6 bg-zinc-900/20">
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                          <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse" />
                          <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">System Resource Usage (Limit: 2.5GB)</h3>
                        </div>
                        <div className="flex items-center gap-3">
                          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">
                            {((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)).toLocaleString()} / 2,560 MB
                          </span>
                          <span className={cn(
                            "px-2 py-0.5 rounded text-[9px] font-bold uppercase tracking-widest",
                            ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) > 2048 ? "bg-red-500/20 text-red-500" :
                            ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) > 1280 ? "bg-yellow-500/20 text-yellow-500" : 
                            "bg-blue-500/20 text-blue-500"
                          )}>
                            {Math.round(((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) / 2560 * 100)}%
                          </span>
                        </div>
                      </div>
                      <div className="h-2 bg-zinc-800/50 rounded-full overflow-hidden border border-zinc-800">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: `${Math.min(100, ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) / 2560 * 100)}%` }}
                          className={cn(
                            "h-full transition-all duration-500",
                            ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) > 2048 ? "bg-red-500" :
                            ((globalStats?.totalMemory || 0) + (globalStats?.totalStorage || 0)) > 1280 ? "bg-yellow-500" : "bg-blue-500"
                          )}
                        />
                      </div>
                    </div>
                  </div>

                  {/* Recent Activity & Health */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-zinc-800">
                    <div className="bg-zinc-900/30 p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Activity size={14} className="text-blue-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">Recent Activity</h3>
                      </div>
                      <div className="space-y-3">
                        {adminStats?.recentActivity?.map((activity) => (
                          <div key={activity.id} className="flex items-start gap-3 text-[10px]">
                            <div className={cn(
                              "w-1.5 h-1.5 rounded-full mt-1 shrink-0",
                              activity.type === "redeem" ? "bg-emerald-500" : "bg-blue-500"
                            )} />
                            <div className="flex-1 min-w-0">
                              <p className="text-zinc-300 font-medium leading-relaxed">{activity.message}</p>
                              <p className="text-zinc-600 mt-0.5">{new Date(activity.timestamp).toLocaleTimeString()}</p>
                            </div>
                          </div>
                        )) || (
                          <p className="text-zinc-600 italic text-center py-4">No recent activity</p>
                        )}
                      </div>
                    </div>
                    <div className="bg-zinc-900/30 p-6">
                      <div className="flex items-center gap-2 mb-4">
                        <Bot size={14} className="text-emerald-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">System Health</h3>
                      </div>
                      <div className="space-y-4">
                        <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">CPU Load</span>
                          <span className="text-xs font-bold text-emerald-500">Healthy</span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Memory</span>
                          <span className={cn(
                            "text-xs font-bold",
                            (globalStats?.totalMemory || 0) > 2048 ? "text-red-500" : "text-emerald-500"
                          )}>
                            {(globalStats?.totalMemory || 0) > 2048 ? "High Usage" : "Optimal"}
                          </span>
                        </div>
                        <div className="flex items-center justify-between p-3 rounded-xl bg-zinc-900 border border-zinc-800">
                          <span className="text-[10px] font-bold uppercase tracking-widest text-zinc-500">Storage</span>
                          <span className={cn(
                            "text-xs font-bold",
                            (globalStats?.totalStorage || 0) > 2048 ? "text-red-500" : "text-emerald-500"
                          )}>
                            {(globalStats?.totalStorage || 0) > 2048 ? "Near Limit" : "Optimal"}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* User Management */}
                  <div className="p-6 border-t border-zinc-800">
                    <div className="flex items-center justify-between mb-6">
                      <div className="flex items-center gap-2">
                        <Users size={14} className="text-orange-500" />
                        <h3 className="text-[10px] font-bold uppercase tracking-widest text-zinc-400">User Management</h3>
                      </div>
                      <button 
                        onClick={handleFetchAdminUsers}
                        className="text-[10px] font-bold text-blue-500 hover:underline uppercase tracking-widest"
                      >
                        Refresh List
                      </button>
                    </div>

                    <div className="space-y-4">
                      {isAdminUsersLoading ? (
                        <div className="py-10 flex justify-center">
                          <div className="w-6 h-6 border-2 border-zinc-800 border-t-blue-500 rounded-full animate-spin" />
                        </div>
                      ) : adminUsers.length > 0 ? (
                        <div className="overflow-x-auto">
                          <table className="w-full text-left border-collapse">
                            <thead>
                              <tr className="border-b border-zinc-800">
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-zinc-600">User</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Current Plan</th>
                                <th className="py-3 px-4 text-[10px] font-bold uppercase tracking-widest text-zinc-600">Change Plan</th>
                              </tr>
                            </thead>
                            <tbody>
                              {adminUsers.map((u) => (
                                <tr key={u.id} className="border-b border-zinc-800/50 hover:bg-zinc-900/30 transition-colors">
                                  <td className="py-4 px-4">
                                    <div className="flex flex-col">
                                      <span className="text-sm font-bold text-zinc-200">{u.username}</span>
                                      <span className="text-[10px] text-zinc-600">Joined {new Date(u.created_at).toLocaleDateString()}</span>
                                    </div>
                                  </td>
                                  <td className="py-4 px-4">
                                    <span className={cn(
                                      "px-2 py-1 rounded text-[10px] font-bold uppercase tracking-widest",
                                      u.subscription_plan === "Lifetime" ? "bg-purple-500/10 text-purple-500 border border-purple-500/20" :
                                      u.subscription_plan === "Enterprise" ? "bg-pink-500/10 text-pink-500 border border-pink-500/20" :
                                      u.subscription_plan === "Pro" ? "bg-blue-500/10 text-blue-500 border border-blue-500/20" :
                                      "bg-zinc-800 text-zinc-500 border border-zinc-700"
                                    )}>
                                      {u.subscription_plan}
                                    </span>
                                  </td>
                                  <td className="py-4 px-4">
                                    <div className="flex gap-1">
                                      {["Free", "Pro", "Enterprise", "Lifetime"].map((plan) => (
                                        <button
                                          key={plan}
                                          onClick={() => handleAdminUpdateSubscription(u.id, plan)}
                                          disabled={u.subscription_plan === plan}
                                          className={cn(
                                            "px-2 py-1 rounded text-[9px] font-bold uppercase tracking-widest transition-all",
                                            u.subscription_plan === plan 
                                              ? "bg-zinc-800 text-zinc-600 cursor-default" 
                                              : "bg-zinc-900 border border-zinc-800 text-zinc-400 hover:border-blue-500/50 hover:text-blue-400"
                                          )}
                                        >
                                          {plan}
                                        </button>
                                      ))}
                                    </div>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="text-center py-10 text-zinc-600 italic">No users found</div>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {isProfileModalOpen && (
          <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
            <motion.div 
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsProfileModalOpen(false)}
              className="absolute inset-0 bg-black/80 backdrop-blur-md"
            />
            <motion.div 
              initial={{ scale: 0.95, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="w-full max-w-2xl bg-[#0d0d0d] border border-zinc-800 rounded-[2.5rem] overflow-hidden shadow-2xl relative z-10 flex flex-col max-h-[90vh]"
            >
              <div className="p-8 border-b border-zinc-800 flex items-center justify-between bg-zinc-900/20">
                <div className="flex items-center gap-4">
                  <div className="w-12 h-12 bg-blue-600 rounded-2xl flex items-center justify-center shadow-lg shadow-blue-900/20">
                    <User className="text-white" size={24} />
                  </div>
                  <div>
                    <h2 className="text-2xl font-bold tracking-tight">Profile Settings</h2>
                    <p className="text-xs text-zinc-500 font-medium uppercase tracking-widest">Manage your account & security</p>
                  </div>
                </div>
                <button 
                  onClick={() => setIsProfileModalOpen(false)}
                  className="p-3 hover:bg-zinc-800 rounded-2xl transition-colors text-zinc-500 hover:text-white"
                >
                  <X size={20} />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar">
                {/* Profile Configuration */}
                <section className="space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Shield size={16} className="text-blue-500" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Profile Configuration</h3>
                  </div>
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">Username</label>
                      <div className="relative">
                        <User className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                        <input 
                          type="text" 
                          value={profileUsername}
                          onChange={(e) => setProfileUsername(e.target.value)}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-all"
                          placeholder="Username"
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">Avatar URL</label>
                      <div className="relative">
                        <Camera className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-600" size={16} />
                        <input 
                          type="text" 
                          value={profileAvatarUrl}
                          onChange={(e) => setProfileAvatarUrl(e.target.value)}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl pl-12 pr-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-all"
                          placeholder="https://..."
                        />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">Bio / Description</label>
                    <textarea 
                      value={profileBio}
                      onChange={(e) => setProfileBio(e.target.value)}
                      className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-blue-600 transition-all min-h-[100px] resize-none"
                      placeholder="Tell us about yourself..."
                    />
                  </div>

                  <button 
                    onClick={handleUpdateProfile}
                    disabled={isProfileUpdating}
                    className="w-full py-4 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white rounded-2xl font-bold transition-all shadow-lg shadow-blue-900/20 active:scale-[0.98]"
                  >
                    {isProfileUpdating ? "Updating..." : "Save Profile Changes"}
                  </button>
                </section>

                <div className="h-px bg-zinc-800/50" />

                {/* Change Password */}
                <section className="space-y-6">
                  <div className="flex items-center gap-2 mb-2">
                    <Lock size={16} className="text-orange-500" />
                    <h3 className="text-xs font-bold uppercase tracking-widest text-zinc-400">Security & Password</h3>
                  </div>

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">Current Password</label>
                      <input 
                        type="password" 
                        value={currentPassword}
                        onChange={(e) => setCurrentPassword(e.target.value)}
                        className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-orange-600 transition-all"
                        placeholder="••••••••"
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">New Password</label>
                        <input 
                          type="password" 
                          value={newPassword}
                          onChange={(e) => setNewPassword(e.target.value)}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-orange-600 transition-all"
                          placeholder="••••••••"
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="block text-[10px] font-bold uppercase tracking-widest text-zinc-500 ml-1">Confirm New Password</label>
                        <input 
                          type="password" 
                          value={confirmPassword}
                          onChange={(e) => setConfirmPassword(e.target.value)}
                          className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-4 py-3 text-sm focus:outline-none focus:border-orange-600 transition-all"
                          placeholder="••••••••"
                        />
                      </div>
                    </div>
                  </div>

                  <button 
                    onClick={handleChangePassword}
                    disabled={isPasswordChanging}
                    className="w-full py-4 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 text-white rounded-2xl font-bold transition-all active:scale-[0.98]"
                  >
                    {isPasswordChanging ? "Changing..." : "Update Password"}
                  </button>
                </section>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* No Subscription Overlay */}
      <AnimatePresence>
        {user && subscription.limit === 0 && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="fixed inset-0 z-[200] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 text-center"
          >
            <div className="max-w-md space-y-6">
              <div className="w-20 h-20 bg-red-600/20 border border-red-600/30 rounded-full flex items-center justify-center mx-auto mb-6">
                <Shield className="text-red-500" size={40} />
              </div>
              <h2 className="text-3xl font-black tracking-tight text-white uppercase italic">Access Restricted</h2>
              <p className="text-zinc-400 text-lg font-medium leading-relaxed">
                You didn't subscribe any plans please contact admin to get access.
              </p>
              <div className="pt-6">
                <button 
                  onClick={handleLogout}
                  className="px-8 py-4 bg-zinc-800 hover:bg-zinc-700 text-white rounded-2xl font-bold transition-all active:scale-95 flex items-center gap-3 mx-auto"
                >
                  <LogOut size={18} />
                  <span>Logout</span>
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <style>{`
        .custom-scrollbar::-webkit-scrollbar {
          width: 6px;
        }
        .custom-scrollbar::-webkit-scrollbar-track {
          background: transparent;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb {
          background: #27272a;
          border-radius: 10px;
        }
        .custom-scrollbar::-webkit-scrollbar-thumb:hover {
          background: #3f3f46;
        }
      `}</style>
    </div>
  );
}
