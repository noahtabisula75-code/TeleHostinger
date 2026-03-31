import React, { useState, useEffect, useRef, useCallback } from "react";
import { 
  Bot, 
  Play, 
  Square, 
  RefreshCw, 
  Terminal, 
  Settings2, 
  Key, 
  Upload, 
  FileCode, 
  Trash2,
  Download,
  FileText,
  Plus,
  X,
  FolderOpen,
  Package,
  Heart,
  Github,
  LogOut,
  Shield,
  Users
} from "lucide-react";
import { io, Socket } from "socket.io-client";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

interface User {
  id: string;
  username: string;
  isAdmin: boolean;
  plan: string;
}

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface LogEntry {
  id: string;
  type: "info" | "success" | "error" | "bot";
  message: string;
  timestamp: Date;
}

interface FileDetail {
  name: string;
  size: number;
  modifiedAt: string;
}

interface Project {
  id: string;
  name: string;
  type: "nodejs" | "python";
  createdAt: string;
  status: "online" | "offline" | "starting";
  isLiked?: boolean;
  startedAt?: string;
  token?: string;
  mainScript?: string;
  githubUrl?: string;
}

function UptimeDisplay({ startedAt }: { startedAt?: string }) {
  const [uptime, setUptime] = useState<string>("0:0");

  useEffect(() => {
    if (!startedAt) return;

    const updateUptime = () => {
      const start = new Date(startedAt).getTime();
      const now = new Date().getTime();
      const diff = Math.max(0, now - start);

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      if (hours > 0) {
        setUptime(`${hours}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`);
      } else {
        setUptime(`${minutes}:${seconds.toString().padStart(2, '0')}`);
      }
    };

    updateUptime();
    const interval = setInterval(updateUptime, 1000);

    return () => clearInterval(interval);
  }, [startedAt]);

  if (!startedAt) return <span>0:0</span>;
  return <span>{uptime}</span>;
}

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [view, setView] = useState<"projects" | "admin">("projects");
  const [adminUsers, setAdminUsers] = useState<{ id: string; username: string; plan: string }[]>([]);
  const [isUpdatingPlan, setIsUpdatingPlan] = useState<string | null>(null);

  const [authUsername, setAuthUsername] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [isSignUp, setIsSignUp] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [projects, setProjects] = useState<Project[]>([]);
  const [selectedProject, setSelectedProject] = useState<Project | null>(null);
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false);
  const [newProjectName, setNewProjectName] = useState("");
  const [newProjectType, setNewProjectType] = useState<"nodejs" | "python">("nodejs");

  const [status, setStatus] = useState<"online" | "offline" | "starting">("offline");
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [token, setToken] = useState("");
  const [nodeScript, setNodeScript] = useState<File | null>(null);
  const [pythonScript, setPythonScript] = useState<File | null>(null);
  const [requirements, setRequirements] = useState<File | null>(null);
  const [extraFiles, setExtraFiles] = useState<File[]>([]);
  const [githubUrl, setGithubUrl] = useState("");
  const [isImportingGithub, setIsImportingGithub] = useState(false);
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    const savedUser = localStorage.getItem("telehost_user");
    if (savedUser) {
      try {
        const parsed = JSON.parse(savedUser);
        setUser(parsed);
        setIsAdmin(parsed.isAdmin);
      } catch (err) {
        console.error("Failed to parse saved user:", err);
        localStorage.removeItem("telehost_user");
      }
    }
  }, []);

  const fetchAdminUsers = async () => {
    try {
      const res = await fetch("/api/admin/users");
      if (res.ok) {
        const data = await res.json();
        setAdminUsers(data);
      }
    } catch (err) {
      console.error("Failed to fetch admin users", err);
    }
  };

  useEffect(() => {
    if (view === "admin" && isAdmin) {
      fetchAdminUsers();
    }
  }, [view, isAdmin]);

  const handleUpdatePlan = async (userId: string, plan: string) => {
    setIsUpdatingPlan(userId);
    try {
      const res = await fetch("/api/admin/update-plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId, plan })
      });
      if (res.ok) {
        fetchAdminUsers();
      }
    } catch (err) {
      console.error("Failed to update plan", err);
    } finally {
      setIsUpdatingPlan(null);
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setAuthError(null);
    try {
      const endpoint = isSignUp ? "/api/auth/signup" : "/api/auth/login";
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: authUsername, password: authPassword })
      });

      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) throw new Error(data.error || "Authentication failed");

      setUser(data);
      setIsAdmin(data.isAdmin);
      localStorage.setItem("telehost_user", JSON.stringify(data));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setAuthError(message);
    }
  };

  const handleSignOut = async () => {
    setUser(null);
    setIsAdmin(false);
    localStorage.removeItem("telehost_user");
    setView("projects");
  };
  const [files, setFiles] = useState<FileDetail[]>([]);
  const [isFetchingFiles, setIsFetchingFiles] = useState(false);
  const [diagnostics, setDiagnostics] = useState<{ python: boolean; pip: boolean }>({ python: true, pip: true });
  
  const socketRef = useRef<Socket | null>(null);
  const logContainerRef = useRef<HTMLDivElement>(null);
  const [shouldAutoScroll, setShouldAutoScroll] = useState(true);
  const selectedProjectRef = useRef<Project | null>(null);

  useEffect(() => {
    selectedProjectRef.current = selectedProject;
  }, [selectedProject]);

  const fetchProjects = useCallback(async () => {
    if (!user) return;
    try {
      const res = await fetch("/api/projects");
      if (res.ok) {
        const data = await res.json();
        const userProjects = data.filter((p: Project) => p.userId === user.id);
        setProjects(userProjects);
        setSelectedProject(prev => prev || userProjects[0] || null);
      }
    } catch (err) {
      console.error("Failed to fetch projects", err);
    }
  }, [user]);

  const fetchStatus = useCallback(async () => {
    const currentProject = selectedProjectRef.current;
    if (!currentProject) return;
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/status`);
      const text = await res.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      setStatus(data.status);
      setDiagnostics(data.diagnostics || { python: true, pip: true });
      setProjects(prev => prev.map(p => p.id === currentProject.id ? { ...p, status: data.status, startedAt: data.startedAt } : p));
      setSelectedProject(prev => prev?.id === currentProject.id ? { ...prev, status: data.status, startedAt: data.startedAt } : prev);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch status", message);
      setError(`Failed to fetch status: ${message}`);
    }
  }, []);

  const fetchFiles = useCallback(async () => {
    const currentProject = selectedProjectRef.current;
    if (!currentProject) return;
    setIsFetchingFiles(true);
    try {
      const res = await fetch(`/api/projects/${currentProject.id}/files`);
      const text = await res.text();
      
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      setFiles(data);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("Failed to fetch files", message);
      setError(`Failed to fetch files: ${message}`);
    } finally {
      setIsFetchingFiles(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      fetchProjects();
    } else {
      setProjects([]);
      setSelectedProject(null);
    }
    
    const socket = io();
    socketRef.current = socket;
    
    socket.on("connect", () => {
      console.log("Connected to socket");
    });

    socket.on("log", (data: { projectId: string; type: string; message: string }) => {
      if (selectedProjectRef.current?.id === data.projectId) {
        setLogs(prev => [...prev, {
          id: Math.random().toString(36).substr(2, 9),
          type: data.type as "info" | "success" | "error" | "bot",
          message: data.message,
          timestamp: new Date()
        }].slice(-100));
      }
    });

    socket.on("status", (data: { projectId: string; status: string; startedAt?: string }) => {
      setProjects(prev => prev.map(p => p.id === data.projectId ? { ...p, status: data.status as "online" | "offline" | "starting", startedAt: data.startedAt } : p));
      if (selectedProjectRef.current?.id === data.projectId) {
        setStatus(data.status as "online" | "offline" | "starting");
        setSelectedProject(prev => prev?.id === data.projectId ? { ...prev, status: data.status as "online" | "offline" | "starting", startedAt: data.startedAt } : prev);
      }
    });

    return () => {
      socket.disconnect();
    };
  }, [fetchProjects, user]);

  useEffect(() => {
    if (selectedProject) {
      // Join project room
      socketRef.current?.emit("join", selectedProject.id);
      fetchStatus();
      fetchFiles();
      setLogs([]); // Clear logs when switching projects
      setToken(selectedProject.token || "");
      setNodeScript(null);
      setPythonScript(null);
      setRequirements(null);
    }
  }, [selectedProject?.id, fetchStatus, fetchFiles, selectedProject]);

  useEffect(() => {
    if (shouldAutoScroll && logContainerRef.current) {
      logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }
  }, [logs, shouldAutoScroll]);

  const handleLogScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const target = e.currentTarget;
    // Use a smaller threshold (10px) to determine if user is at bottom
    const isAtBottom = target.scrollHeight - target.scrollTop <= target.clientHeight + 10;
    setShouldAutoScroll(isAtBottom);
  };

  const handleCreateProject = async () => {
    if (!newProjectName || !user) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: newProjectName, type: newProjectType, userId: user.id })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      setProjects(prev => [...prev, data]);
      setSelectedProject(data);
      setIsCreateModalOpen(false);
      setNewProjectName("");
    } catch (err) {
      console.error("Failed to create project", err);
      const message = err instanceof Error ? err.message : String(err);
      alert(message);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message: `Failed to create project: ${message}`, timestamp: new Date() }]);
    }
  };

  const handleDeleteProject = async (id: string) => {
    if (!confirm("Are you sure you want to delete this project? All files will be lost.")) return;
    try {
      const res = await fetch(`/api/projects/${id}`, { method: "DELETE" });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      setProjects(prev => prev.filter(p => p.id !== id));
      if (selectedProject?.id === id) {
        setSelectedProject(null);
      }
    } catch (err) {
      console.error("Failed to delete project", err);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message: `Failed to delete project: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() }]);
    }
  };

  const handleDeleteFile = async (filename: string) => {
    if (!selectedProject) return;
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/files/${filename}`, { method: "DELETE" });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      fetchFiles();
    } catch (err) {
      console.error("Failed to delete file", err);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message: `Failed to delete file: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() }]);
    }
  };

  const handleToggleLike = async (id: string, currentStatus: boolean) => {
    try {
      const res = await fetch(`/api/projects/${id}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isLiked: !currentStatus })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      setProjects(prev => prev.map(p => p.id === id ? { ...p, isLiked: !currentStatus } : p));
      if (selectedProject?.id === id) {
        setSelectedProject(prev => prev ? { ...prev, isLiked: !currentStatus } : null);
      }
    } catch (err) {
      console.error("Failed to toggle like", err);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message: `Failed to toggle like: ${err instanceof Error ? err.message : String(err)}`, timestamp: new Date() }]);
    }
  };

  const handleDeploy = async () => {
    if (!selectedProject) return;
    
    // Validation
    if (selectedProject.type === "nodejs" && !token && !nodeScript && !selectedProject.mainScript) {
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message: "Bot Token or Script required", timestamp: new Date() }]);
      return;
    }
    if (selectedProject.type === "python" && !pythonScript && !selectedProject.mainScript) {
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message: "Python script required", timestamp: new Date() }]);
      return;
    }

    setIsDeploying(true);
    const formData = new FormData();
    
    if (selectedProject.type === "nodejs") {
      if (token) formData.append("token", token);
      if (nodeScript) formData.append("script", nodeScript);
    } else {
      if (pythonScript) formData.append("script", pythonScript);
      if (requirements) formData.append("requirements", requirements);
    }

    extraFiles.forEach(file => {
      formData.append("extraFiles", file);
    });

    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/deploy`, {
        method: "POST",
        body: formData
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
      
      // Refresh project data to get updated token/mainScript
      fetchProjects();
      fetchFiles();
      
      // Clear file inputs
      setNodeScript(null);
      setPythonScript(null);
      setRequirements(null);
      setExtraFiles([]);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message, timestamp: new Date() }]);
    } finally {
      setIsDeploying(false);
    }
  };

  const handleStop = async () => {
    if (!selectedProject) return;
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/stop`, { method: "POST" });
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message, timestamp: new Date() }]);
    }
  };

  const handleGithubImport = async () => {
    if (!githubUrl || !selectedProject) return;
    setIsImportingGithub(true);
    try {
      const res = await fetch(`/api/projects/${selectedProject.id}/github-import`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ githubUrl })
      });
      
      const text = await res.text();
      let data;
      try {
        data = JSON.parse(text);
      } catch {
        throw new Error(`Invalid JSON response from server: ${text.slice(0, 100)}...`);
      }

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      fetchFiles();
      setGithubUrl("");
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      setLogs(prev => [...prev, { id: Date.now().toString(), type: "error", message, timestamp: new Date() }]);
    } finally {
      setIsImportingGithub(false);
    }
  };

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] text-white flex items-center justify-center p-4">
        <div className="w-full max-w-md bg-[#111] border border-[#222] rounded-2xl p-8 shadow-2xl">
          <div className="flex flex-col items-center mb-8">
            <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-500/20">
              <Bot size={32} />
            </div>
            <h1 className="text-3xl font-bold tracking-tight">TeleHost</h1>
            <p className="text-gray-400 mt-2">Professional Bot Hosting</p>
          </div>

          <form onSubmit={handleAuth} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Username</label>
              <input
                type="text"
                value={authUsername}
                onChange={(e) => setAuthUsername(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#222] rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="Enter your username"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-400 mb-1">Password</label>
              <input
                type="password"
                value={authPassword}
                onChange={(e) => setAuthPassword(e.target.value)}
                className="w-full bg-[#1a1a1a] border border-[#222] rounded-xl px-4 py-3 focus:outline-none focus:border-blue-500 transition-colors"
                placeholder="••••••••"
                required
              />
            </div>

            {authError && (
              <div className="p-3 bg-red-500/10 border border-red-500/20 rounded-xl text-red-500 text-sm">
                {authError}
              </div>
            )}

            <button
              type="submit"
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-all shadow-lg shadow-blue-500/20 active:scale-[0.98]"
            >
              {isSignUp ? "Create Account" : "Sign In"}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => setIsSignUp(!isSignUp)}
              className="text-sm text-gray-400 hover:text-white transition-colors"
            >
              {isSignUp ? "Already have an account? Sign in" : "Don't have an account? Sign up"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0A0A0B] text-zinc-100 font-sans selection:bg-orange-500/30 flex">
      {/* Sidebar */}
      <div className="w-64 border-r border-zinc-800/50 bg-[#0D0D0F] flex flex-col">
        <div className="p-6 border-b border-zinc-800/50 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-orange-500 flex items-center justify-center">
              <Bot className="w-5 h-5 text-white" />
            </div>
            <span className="font-bold tracking-tight text-lg">TeleHost</span>
          </div>
          <button 
            onClick={handleSignOut}
            className="p-2 hover:bg-zinc-800 rounded-lg transition-colors text-zinc-400 hover:text-white"
            title="Sign Out"
          >
            <LogOut className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4 space-y-2">
          {isAdmin && (
            <div className="mb-6 space-y-1">
              <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider px-2">Admin</span>
              <button
                onClick={() => setView("admin")}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                  view === "admin" ? "bg-zinc-800 text-white ring-1 ring-zinc-700" : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200"
                )}
              >
                <Shield className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-medium">Admin Panel</span>
              </button>
              <button
                onClick={() => setView("projects")}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-xl transition-all",
                  view === "projects" ? "bg-zinc-800 text-white ring-1 ring-zinc-700" : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200"
                )}
              >
                <Package className="w-4 h-4" />
                <span className="text-sm font-medium">My Projects</span>
              </button>
            </div>
          )}

          <div className="flex items-center justify-between mb-2 px-2">
            <span className="text-xs font-semibold text-zinc-500 uppercase tracking-wider">Projects</span>
            <button 
              onClick={() => setIsCreateModalOpen(true)}
              className="p-1 hover:bg-zinc-800 rounded-md transition-colors text-zinc-400 hover:text-white"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          
          {projects.map((project) => (
            <div
              key={project.id}
              onClick={() => setSelectedProject(project)}
              className={cn(
                "group flex items-center justify-between p-3 rounded-xl cursor-pointer transition-all duration-200",
                selectedProject?.id === project.id 
                  ? "bg-zinc-800/50 text-white ring-1 ring-zinc-700" 
                  : "text-zinc-400 hover:bg-zinc-800/30 hover:text-zinc-200"
              )}
            >
              <div className="flex items-center gap-3">
                <div className={cn(
                  "w-2 h-2 rounded-full",
                  project.status === "online" ? "bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)]" :
                  project.status === "starting" ? "bg-orange-500 animate-pulse" : "bg-zinc-600"
                )} />
                <div className="flex flex-col">
                  <span className="text-sm font-medium truncate w-32">{project.name}</span>
                  <span className="text-[10px] opacity-50 uppercase tracking-tighter">{project.type}</span>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button 
                  onClick={(e) => { e.stopPropagation(); handleToggleLike(project.id, !!project.isLiked); }}
                  className={cn(
                    "p-1 transition-all",
                    project.isLiked ? "text-red-500 fill-red-500" : "text-zinc-500 hover:text-zinc-300"
                  )}
                >
                  <Heart className="w-3.5 h-3.5" />
                </button>
                <button 
                  onClick={(e) => { e.stopPropagation(); handleDeleteProject(project.id); }}
                  className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 transition-opacity"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {view === "admin" && isAdmin ? (
          <div className="flex-1 overflow-y-auto p-8 custom-scrollbar bg-[#0A0A0B]">
            <div className="max-w-4xl mx-auto space-y-8">
              <div className="flex items-center justify-between">
                <div>
                  <h1 className="text-3xl font-bold tracking-tight">Admin Panel</h1>
                  <p className="text-zinc-500 mt-1">Manage user plans and project limits</p>
                </div>
                <div className="w-12 h-12 rounded-2xl bg-orange-500/10 flex items-center justify-center border border-orange-500/20">
                  <Shield className="w-6 h-6 text-orange-500" />
                </div>
              </div>

              <div className="bg-[#0D0D0F] border border-zinc-800/50 rounded-3xl overflow-hidden shadow-2xl">
                <div className="p-6 border-b border-zinc-800/50 bg-zinc-900/30 flex items-center gap-3">
                  <Users className="w-5 h-5 text-zinc-400" />
                  <h3 className="font-bold">User Management</h3>
                </div>
                <div className="divide-y divide-zinc-800/50">
                  {adminUsers.map((u) => (
                    <div key={u.id} className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-zinc-800/10 transition-colors">
                      <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center text-zinc-400 font-bold">
                          {u.username[0].toUpperCase()}
                        </div>
                        <div>
                          <p className="font-medium text-zinc-200">{u.username}</p>
                          <p className="text-xs text-zinc-500 font-mono">{u.id}</p>
                        </div>
                      </div>

                      <div className="flex items-center gap-3">
                        <div className="flex bg-zinc-900 rounded-xl p-1 border border-zinc-800">
                          {[
                            { id: "default", label: "Free (3)" },
                            { id: "starter", label: "Starter (5)" },
                            { id: "pro", label: "Pro (10)" },
                            { id: "ultra", label: "Ultra (15)" }
                          ].map((p) => (
                            <button
                              key={p.id}
                              disabled={isUpdatingPlan === u.id}
                              onClick={() => handleUpdatePlan(u.id, p.id)}
                              className={cn(
                                "px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all",
                                u.plan === p.id 
                                  ? "bg-orange-500 text-white shadow-lg shadow-orange-500/20" 
                                  : "text-zinc-500 hover:text-zinc-300"
                              )}
                            >
                              {p.label}
                            </button>
                          ))}
                        </div>
                        {isUpdatingPlan === u.id && <RefreshCw className="w-4 h-4 animate-spin text-orange-500" />}
                      </div>
                    </div>
                  ))}
                  {adminUsers.length === 0 && (
                    <div className="p-12 text-center text-zinc-500">
                      No users found.
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {[
                  { name: "Starter", storage: "1GB", projects: 5, color: "text-blue-400" },
                  { name: "Pro", storage: "3GB", projects: 10, color: "text-purple-400" },
                  { name: "Ultra Pro", storage: "5GB", projects: 15, color: "text-orange-400" }
                ].map((plan) => (
                  <div key={plan.name} className="p-6 bg-[#0D0D0F] border border-zinc-800/50 rounded-3xl">
                    <h4 className={cn("text-sm font-bold uppercase tracking-widest mb-4", plan.color)}>{plan.name}</h4>
                    <div className="space-y-2">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Storage</span>
                        <span className="text-zinc-200 font-bold">{plan.storage}</span>
                      </div>
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-zinc-500">Projects</span>
                        <span className="text-zinc-200 font-bold">{plan.projects}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : selectedProject ? (
          <>
            <header className="h-16 border-b border-zinc-800/50 bg-[#0D0D0F]/50 backdrop-blur-xl flex items-center justify-between px-8 z-10">
              <div className="flex items-center gap-4">
                <h2 className="text-xl font-semibold tracking-tight">{selectedProject.name}</h2>
                <div className={cn(
                  "px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-widest border",
                  status === "online" ? "bg-green-500/10 text-green-400 border-green-500/20" :
                  status === "starting" ? "bg-orange-500/10 text-orange-400 border-orange-500/20" :
                  "bg-zinc-500/10 text-zinc-400 border-zinc-500/20"
                )}>
                  {status} {status === "online" && (
                    <span className="ml-1 opacity-60 border-l border-zinc-500/30 pl-1.5">
                      <UptimeDisplay startedAt={selectedProject.startedAt} />
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-3">
                {status === "online" ? (
                  <button
                    onClick={handleStop}
                    className="flex items-center gap-2 px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 rounded-xl transition-all font-medium text-sm border border-red-500/20"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop Project
                  </button>
                ) : (
                  <button
                    onClick={handleDeploy}
                    disabled={isDeploying}
                    className={cn(
                      "flex items-center gap-2 px-6 py-2 rounded-xl transition-all font-bold text-sm shadow-lg shadow-orange-500/20",
                      isDeploying 
                        ? "bg-zinc-800 text-zinc-500 cursor-not-allowed" 
                        : "bg-orange-500 hover:bg-orange-600 text-white hover:scale-[1.02] active:scale-[0.98]"
                    )}
                  >
                    {isDeploying ? (
                      <RefreshCw className="w-4 h-4 animate-spin" />
                    ) : (
                      <Play className="w-4 h-4 fill-current" />
                    )}
                    Deploy Now
                  </button>
                )}
              </div>
            </header>

            <main className="flex-1 overflow-y-auto p-8 custom-scrollbar">
              <div className="max-w-6xl mx-auto grid grid-cols-12 gap-8">
                {/* Left Column: Config */}
                <div className="col-span-12 lg:col-span-5 space-y-8">
                  <section className="bg-[#0D0D0F] border border-zinc-800/50 rounded-3xl p-8 shadow-2xl">
                    <div className="flex items-center gap-3 mb-8">
                      <div className="w-10 h-10 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                        <Settings2 className="w-5 h-5 text-zinc-400" />
                      </div>
                      <h3 className="text-lg font-bold">Configuration</h3>
                    </div>

                    <div className="space-y-6">
                      <div className="space-y-2">
                        <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Import from GitHub</label>
                        <div className="flex gap-2">
                          <div className="relative flex-1 group">
                            <input
                              type="text"
                              value={githubUrl}
                              onChange={(e) => setGithubUrl(e.target.value)}
                              placeholder="https://github.com/user/repo"
                              className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-5 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500/50 transition-all group-hover:border-zinc-700"
                            />
                            <Github className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                          </div>
                          <button
                            onClick={handleGithubImport}
                            disabled={isImportingGithub || !githubUrl}
                            className={cn(
                              "px-4 py-3 rounded-2xl font-bold text-sm transition-all",
                              isImportingGithub || !githubUrl
                                ? "bg-zinc-800 text-zinc-500 cursor-not-allowed"
                                : "bg-zinc-100 text-zinc-900 hover:bg-white active:scale-95"
                            )}
                          >
                            {isImportingGithub ? <RefreshCw className="w-4 h-4 animate-spin" /> : "Import"}
                          </button>
                        </div>
                        {selectedProject.githubUrl && (
                          <p className="text-[10px] text-zinc-500 ml-1">
                            Current source: <span className="text-zinc-400">{selectedProject.githubUrl}</span>
                          </p>
                        )}
                      </div>

                      {selectedProject.type === "nodejs" ? (
                        <div className="space-y-4">
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Bot Token</label>
                            <div className="relative group">
                              <input
                                type="password"
                                value={token}
                                onChange={(e) => setToken(e.target.value)}
                                placeholder="Paste your Telegram Bot Token..."
                                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500/50 transition-all group-hover:border-zinc-700"
                              />
                              <Key className="absolute right-5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-600" />
                            </div>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Custom Bot Script (Optional)</label>
                            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-zinc-800 rounded-3xl cursor-pointer hover:bg-zinc-900/30 hover:border-zinc-700 transition-all group">
                              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <Upload className="w-6 h-6 text-zinc-500 mb-2 group-hover:text-orange-500 transition-colors" />
                                <p className="text-sm text-zinc-400">{nodeScript ? nodeScript.name : "Drop .js file here"}</p>
                              </div>
                              <input type="file" className="hidden" accept=".js" onChange={(e) => setNodeScript(e.target.files?.[0] || null)} />
                            </label>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {!diagnostics.python && (
                            <div className="p-4 rounded-2xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs flex items-center gap-3">
                              <X className="w-4 h-4 shrink-0" />
                              <p>Python 3 is not detected on this server. Deployment will fail.</p>
                            </div>
                          )}
                          {!diagnostics.pip && diagnostics.python && (
                            <div className="p-4 rounded-2xl bg-orange-500/10 border border-orange-500/20 text-orange-400 text-xs flex items-center gap-3">
                              <RefreshCw className="w-4 h-4 shrink-0" />
                              <p>Pip is not detected. We will attempt to bootstrap it during deployment.</p>
                            </div>
                          )}
                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Python Main Script</label>
                            <label className="flex flex-col items-center justify-center w-full h-32 border-2 border-dashed border-zinc-800 rounded-3xl cursor-pointer hover:bg-zinc-900/30 hover:border-zinc-700 transition-all group">
                              <div className="flex flex-col items-center justify-center pt-5 pb-6">
                                <FileCode className="w-6 h-6 text-zinc-500 mb-2 group-hover:text-orange-500 transition-colors" />
                                <p className="text-sm text-zinc-400">{pythonScript ? pythonScript.name : "Select main.py"}</p>
                              </div>
                              <input type="file" className="hidden" accept=".py" onChange={(e) => setPythonScript(e.target.files?.[0] || null)} />
                            </label>
                          </div>

                          <div className="space-y-2">
                            <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Requirements (Optional)</label>
                            <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-zinc-800 rounded-3xl cursor-pointer hover:bg-zinc-900/30 hover:border-zinc-700 transition-all group">
                              <div className="flex flex-col items-center justify-center pt-4 pb-4">
                                <Package className="w-5 h-5 text-zinc-500 mb-1 group-hover:text-orange-500 transition-colors" />
                                <p className="text-xs text-zinc-400">{requirements ? requirements.name : "Select requirements.txt"}</p>
                              </div>
                              <input type="file" className="hidden" onChange={(e) => setRequirements(e.target.files?.[0] || null)} />
                            </label>
                          </div>
                        </div>
                      )}

                      {/* Extra Files Section */}
                      <div className="pt-4 border-t border-zinc-800/50 space-y-4">
                        <div className="space-y-2">
                          <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Extra Files (Optional, Max 50MB)</label>
                          <label className="flex flex-col items-center justify-center w-full h-24 border-2 border-dashed border-zinc-800 rounded-3xl cursor-pointer hover:bg-zinc-900/30 hover:border-zinc-700 transition-all group">
                            <div className="flex flex-col items-center justify-center pt-4 pb-4">
                              <Plus className="w-5 h-5 text-zinc-500 mb-1 group-hover:text-orange-500 transition-colors" />
                              <p className="text-xs text-zinc-400">
                                {extraFiles.length > 0 
                                  ? `${extraFiles.length} files selected` 
                                  : "Select any extra files (json, txt, etc.)"}
                              </p>
                            </div>
                            <input 
                              type="file" 
                              multiple 
                              className="hidden" 
                              onChange={(e) => setExtraFiles(Array.from(e.target.files || []))} 
                            />
                          </label>
                        </div>

                        {extraFiles.length > 0 && (
                          <div className="space-y-2">
                            <div className="flex flex-wrap gap-2">
                              {extraFiles.map((file, i) => (
                                <div key={i} className="px-3 py-1 bg-zinc-900 border border-zinc-800 rounded-full text-[10px] text-zinc-400 flex items-center gap-2">
                                  <span className="truncate max-w-[100px]">{file.name}</span>
                                  <button 
                                    onClick={() => setExtraFiles(prev => prev.filter((_, idx) => idx !== i))}
                                    className="hover:text-red-400 transition-colors"
                                  >
                                    <X className="w-3 h-3" />
                                  </button>
                                </div>
                              ))}
                            </div>
                            <button 
                              onClick={() => setExtraFiles([])}
                              className="text-[10px] text-zinc-500 hover:text-zinc-300 transition-colors underline"
                            >
                              Clear all extra files
                            </button>
                          </div>
                        )}
                      </div>
                    </div>
                  </section>

                  {/* File Manager */}
                  <section className="bg-[#0D0D0F] border border-zinc-800/50 rounded-3xl p-8 shadow-2xl">
                    <div className="flex items-center justify-between mb-8">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                          <FolderOpen className="w-5 h-5 text-zinc-400" />
                        </div>
                        <h3 className="text-lg font-bold">Project Files</h3>
                      </div>
                      <button 
                        onClick={fetchFiles}
                        disabled={isFetchingFiles}
                        className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-400"
                      >
                        <RefreshCw className={cn("w-4 h-4", isFetchingFiles && "animate-spin")} />
                      </button>
                    </div>

                    <div className="space-y-2 max-h-64 overflow-y-auto custom-scrollbar pr-2">
                      {files.length === 0 ? (
                        <div className="text-center py-8 text-zinc-600 italic text-sm">No files uploaded yet</div>
                      ) : (
                        files.map((file) => (
                          <div key={file.name} className="flex items-center justify-between p-3 rounded-2xl bg-zinc-900/30 border border-zinc-800/50 group hover:border-zinc-700 transition-all">
                            <div className="flex items-center gap-3 overflow-hidden">
                              <FileText className="w-4 h-4 text-zinc-500 shrink-0" />
                              <div className="flex flex-col overflow-hidden">
                                <span className="text-sm font-medium truncate">{file.name}</span>
                                <span className="text-[10px] text-zinc-600">{(file.size / 1024).toFixed(1)} KB</span>
                              </div>
                            </div>
                            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                              <a 
                                href={`/api/projects/${selectedProject.id}/files/${file.name}`} 
                                download 
                                className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-white transition-colors"
                              >
                                <Download className="w-3.5 h-3.5" />
                              </a>
                              <button 
                                onClick={() => handleDeleteFile(file.name)}
                                className="p-1.5 hover:bg-zinc-800 rounded-lg text-zinc-400 hover:text-red-400 transition-colors"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>

                {/* Right Column: Logs */}
                <div className="col-span-12 lg:col-span-7 flex flex-col h-[calc(100vh-12rem)]">
                  <section className="flex-1 bg-[#0D0D0F] border border-zinc-800/50 rounded-3xl flex flex-col overflow-hidden shadow-2xl">
                    <div className="p-6 border-b border-zinc-800/50 flex items-center justify-between bg-zinc-900/20">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-2xl bg-zinc-800/50 flex items-center justify-center">
                          <Terminal className="w-5 h-5 text-zinc-400" />
                        </div>
                        <h3 className="text-lg font-bold">Live Console</h3>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-zinc-900/50 border border-zinc-800 text-[10px] font-bold uppercase tracking-widest text-zinc-500">
                          <div className={cn("w-1.5 h-1.5 rounded-full", socketRef.current?.connected ? "bg-green-500" : "bg-red-500")} />
                          Socket {socketRef.current?.connected ? "Connected" : "Disconnected"}
                        </div>
                        <button 
                          onClick={() => setLogs([])}
                          className="p-2 hover:bg-zinc-800 rounded-xl transition-colors text-zinc-500 hover:text-zinc-300"
                          title="Clear Logs"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    <div 
                      ref={logContainerRef}
                      onScroll={handleLogScroll}
                      className="flex-1 overflow-y-auto p-6 font-mono text-sm space-y-2 custom-scrollbar bg-black/20"
                    >
                      {logs.length === 0 ? (
                        <div className="h-full flex flex-col items-center justify-center text-zinc-700 space-y-4">
                          <Terminal className="w-12 h-12 opacity-20" />
                          <p className="italic">Waiting for logs...</p>
                        </div>
                      ) : (
                        logs.map((log) => (
                          <div key={log.id} className="group flex gap-4 animate-in fade-in slide-in-from-left-2 duration-300">
                            <span className="text-zinc-700 shrink-0 select-none text-[10px] pt-1">
                              {new Date(log.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                            </span>
                            <span className={cn(
                              "break-all leading-relaxed",
                              log.type === "error" ? "text-red-400" :
                              log.type === "success" ? "text-green-400" :
                              log.type === "bot" ? "text-orange-400" :
                              "text-zinc-400"
                            )}>
                              <span className="opacity-50 mr-2">[{log.type.toUpperCase()}]</span>
                              {log.message}
                            </span>
                          </div>
                        ))
                      )}
                    </div>
                  </section>
                </div>
              </div>
            </main>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center space-y-6">
            <div className="w-24 h-24 rounded-3xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-4">
              <Bot className="w-12 h-12 text-zinc-700" />
            </div>
            <h2 className="text-3xl font-bold tracking-tight">No Project Selected</h2>
            <p className="text-zinc-500 max-w-md mx-auto">
              Select an existing project from the sidebar or create a new one to start hosting your Telegram bots.
            </p>
            <button
              onClick={() => setIsCreateModalOpen(true)}
              className="flex items-center gap-2 px-8 py-3 bg-orange-500 hover:bg-orange-600 text-white rounded-2xl transition-all font-bold shadow-xl shadow-orange-500/20"
            >
              <Plus className="w-5 h-5" />
              Create Your First Project
            </button>
          </div>
        )}
      </div>

      {/* Create Project Modal */}
      {isCreateModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-[#0D0D0F] border border-zinc-800 rounded-3xl p-8 shadow-2xl animate-in zoom-in-95 duration-200">
            <div className="flex items-center justify-between mb-8">
              <h3 className="text-xl font-bold">New Project</h3>
              <button 
                onClick={() => setIsCreateModalOpen(false)}
                className="p-2 hover:bg-zinc-800 rounded-xl text-zinc-500"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="space-y-6">
              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Project Name</label>
                <input
                  type="text"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                  placeholder="e.g. My Awesome Bot"
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-2xl px-5 py-4 text-sm focus:outline-none focus:ring-2 focus:ring-orange-500/20 focus:border-orange-500/50 transition-all"
                />
              </div>

              <div className="space-y-2">
                <label className="text-xs font-bold text-zinc-500 uppercase tracking-widest ml-1">Environment</label>
                <div className="grid grid-cols-2 gap-4">
                  <button
                    onClick={() => setNewProjectType("nodejs")}
                    className={cn(
                      "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all",
                      newProjectType === "nodejs" 
                        ? "bg-orange-500/10 border-orange-500 text-orange-400" 
                        : "bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                      <span className="font-bold text-xs">JS</span>
                    </div>
                    <span className="text-sm font-bold">Node.js</span>
                  </button>
                  <button
                    onClick={() => setNewProjectType("python")}
                    className={cn(
                      "flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all",
                      newProjectType === "python" 
                        ? "bg-orange-500/10 border-orange-500 text-orange-400" 
                        : "bg-zinc-900/50 border-zinc-800 text-zinc-500 hover:border-zinc-700"
                    )}
                  >
                    <div className="w-10 h-10 rounded-xl bg-zinc-800 flex items-center justify-center">
                      <span className="font-bold text-xs">PY</span>
                    </div>
                    <span className="text-sm font-bold">Python</span>
                  </button>
                </div>
              </div>

              <button
                onClick={handleCreateProject}
                disabled={!newProjectName}
                className="w-full py-4 bg-orange-500 hover:bg-orange-600 disabled:bg-zinc-800 disabled:text-zinc-600 text-white rounded-2xl font-bold transition-all shadow-lg shadow-orange-500/20 mt-4"
              >
                Create Project
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
