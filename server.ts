import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import path from "path";
import multer from "multer";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import https from "https";
import pidusage from "pidusage";
import { createClient } from "@supabase/supabase-js";
import "dotenv/config";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import bcrypt from "bcryptjs";
import archiver from "archiver";

const app = express();
app.use(cookieParser());
const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: "*",
  },
});

const PORT = 3000;
const PROJECTS_DIR = path.join(process.cwd(), "projects");

if (!fs.existsSync(PROJECTS_DIR)) {
  fs.mkdirSync(PROJECTS_DIR, { recursive: true });
}

const JWT_SECRET = process.env.JWT_SECRET || "bot-host-secret-key-2026";

// Middleware to verify JWT and attach user to request
const authenticateToken = (req: any, res: any, next: any) => {
  const token = req.cookies.token || req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  jwt.verify(token, JWT_SECRET, (err: any, user: any) => {
    if (err) return res.status(403).json({ error: "Forbidden" });
    req.user = user;
    next();
  });
};

// Multer setup for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const projectId = req.body.projectId || "default";
    const projectDir = path.join(PROJECTS_DIR, projectId);
    if (!fs.existsSync(projectDir)) {
      fs.mkdirSync(projectDir, { recursive: true });
    }
    cb(null, projectDir);
  },
  filename: (req, file, cb) => {
    cb(null, file.originalname);
  },
});
const upload = multer({ storage });

app.use(express.json());

// In-memory project state (should be persisted in a real DB)
// Now keyed by userId to prevent cross-user visibility
let projectsByUserId: { [userId: string]: any[] } = {};

// Key and Subscription management
let maintenanceMode = false;
let recentActivity: { id: string; type: string; message: string; timestamp: string }[] = [];

const addActivity = (type: string, message: string) => {
  recentActivity.unshift({
    id: Math.random().toString(36).substr(2, 9),
    type,
    message,
    timestamp: new Date().toISOString()
  });
  if (recentActivity.length > 50) recentActivity.pop();
  io.emit("activity", recentActivity[0]);
};

const getUserSubscription = async (userId: string) => {
  const client = getSupabase();
  if (!client) return { type: "Free", limit: 0, duration: "None" };
  
  // Use select("*") to avoid errors if subscription_plan column is missing yet
  const { data, error } = await client.from("users").select("*").eq("id", userId).single();
  if (error || !data) return { type: "Free", limit: 0, duration: "None" };

  const plan = (data.username === "TeleHostOwner" ? "Lifetime" : (data.subscription_plan || "None"));
  if (plan === "Lifetime") return { type: "Lifetime", limit: 1000, duration: "Lifetime" };
  if (plan === "Enterprise") return { type: "Enterprise", limit: 100, duration: "Monthly" };
  if (plan === "Pro") return { type: "Pro", limit: 10, duration: "Monthly" };
  
  // Default to None/Free (No access)
  return { type: plan, limit: 0, duration: "None" };
};

const getDirSize = (dirPath: string): number => {
  let size = 0;
  try {
    const files = fs.readdirSync(dirPath);
    for (const file of files) {
      const filePath = path.join(dirPath, file);
      const stats = fs.statSync(filePath);
      if (stats.isDirectory()) {
        size += getDirSize(filePath);
      } else {
        size += stats.size;
      }
    }
  } catch (e) {}
  return size;
};

// Track active processes
const activeProcesses: { [key: string]: ChildProcess } = {};

// Supabase client (lazy initialization)
// Required tables:
// 1. "settings" (id: text PRIMARY KEY, data: jsonb)
// 2. "users" (id: uuid PRIMARY KEY, username: text UNIQUE, password: text)
// 3. "projects" (id: text PRIMARY KEY, user_id: uuid, data: jsonb)
let supabase: any = null;
const getSupabase = () => {
  if (!supabase) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    if (url && key) {
      supabase = createClient(url, key);
    } else {
      console.warn("[SUPABASE] Missing SUPABASE_URL or SUPABASE_KEY in environment variables.");
    }
  }
  return supabase;
};

const testSupabaseConnection = async () => {
  const client = getSupabase();
  if (!client) return false;
  
  try {
    const { data, error } = await client.from("settings").select("id").limit(1);
    if (error) {
      console.error("[SUPABASE] Connection test failed:", error.message);
      return false;
    }
    console.log("[SUPABASE] Successfully connected to database.");
    return true;
  } catch (err) {
    console.error("[SUPABASE] Unexpected error during connection test:", err);
    return false;
  }
};

// Sync projects with Supabase for a specific user
const syncProjects = async (userId: string) => {
  const client = getSupabase();
  if (!client) return;
  
  const { data, error } = await client.from("projects").select("*").eq("user_id", userId);
  if (error) {
    console.error("[SUPABASE] Error syncing projects:", error.message);
    return;
  }

  if (data) {
    if (!projectsByUserId[userId]) projectsByUserId[userId] = [];
    
    // Remove projects that are no longer in Supabase
    const supabaseIds = data.map(p => p.id);
    projectsByUserId[userId] = projectsByUserId[userId].filter(p => {
      if (!supabaseIds.includes(p.id)) {
        // Stop process if it was running
        if (activeProcesses[p.id]) {
          activeProcesses[p.id].kill();
          delete activeProcesses[p.id];
        }
        return false;
      }
      return true;
    });

    // Merge with in-memory projects
    data.forEach(p => {
      const projectData = p.data || {};
      const existing = projectsByUserId[userId].find(ep => ep.id === p.id);
      if (!existing) {
        projectsByUserId[userId].push({ 
          id: p.id,
          name: p.name || projectData.name || "Untitled Project",
          type: p.type || projectData.type || "node",
          mainFile: p.main_file || projectData.mainFile || (projectData.type === "python" ? "main.py" : "index.js"),
          createdAt: projectData.createdAt || new Date().toISOString(),
          env: projectData.env || {},
          status: p.status || projectData.status || "stopped",
          metrics: { cpu: 0, memory: 0, uptime: 0, requests: 0 }, 
          startTime: (p.status === "running" || projectData.status === "running") ? Date.now() : null 
        });
      } else {
        // Update metadata but keep runtime status
        Object.assign(existing, { 
          name: p.name || projectData.name || existing.name, 
          type: p.type || projectData.type || existing.type, 
          mainFile: p.main_file || projectData.mainFile || existing.mainFile, 
          env: projectData.env || existing.env,
          status: existing.status || p.status || projectData.status || "stopped"
        });
      }
    });
  }
};

const saveProject = async (project: any, userId: string) => {
  const client = getSupabase();
  if (!client) return;
  
  const { id, metrics, startTime, status, name, type, mainFile, ...rest } = project;
  const { error } = await client.from("projects").upsert({ 
    id, 
    user_id: userId,
    name: name || project.name || "Untitled Project",
    status: status || "stopped",
    type: type || project.type || "node",
    main_file: mainFile || project.mainFile || (project.type === "python" ? "main.py" : "index.js"),
    data: { ...rest, status: status || "stopped", name: name || project.name, type: type || project.type, mainFile: mainFile || project.mainFile } 
  });
  if (error) console.error("[SUPABASE] Error saving project:", error.message);
};

const saveFileToSupabase = async (projectId: string, fileName: string, content: string) => {
  const client = getSupabase();
  if (!client) {
    console.warn(`[SUPABASE] Cannot save file ${fileName}: Database not connected.`);
    return;
  }
  const { error } = await client.from("project_files").upsert({ 
    project_id: projectId, 
    file_name: fileName, 
    content,
    updated_at: new Date().toISOString()
  }, { onConflict: 'project_id,file_name' });

  if (error) {
    console.error(`[SUPABASE] Error saving file ${fileName}:`, error.message);
  } else {
    console.log(`[SUPABASE] Successfully backed up ${fileName} for project ${projectId}`);
  }
};

const hydrateProjectFiles = async (projectId: string) => {
  const client = getSupabase();
  if (!client) {
    console.warn(`[SUPABASE] Cannot hydrate files: Database not connected.`);
    return false;
  }

  const projectDir = path.join(PROJECTS_DIR, projectId);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  console.log(`[SUPABASE] Attempting to hydrate files for project ${projectId}...`);
  const { data, error } = await client
    .from("project_files")
    .select("file_name, content")
    .eq("project_id", projectId);

  if (error) {
    console.error(`[SUPABASE] Error fetching files for hydration:`, error.message);
    return false;
  }

  if (data && data.length > 0) {
    for (const file of data) {
      const filePath = path.join(projectDir, file.file_name);
      fs.writeFileSync(filePath, file.content);
      console.log(`[SUPABASE] Restored file: ${file.file_name}`);
    }
    return true;
  }
  
  console.log(`[SUPABASE] No files found in database for project ${projectId}`);
  return false;
};

const startProject = async (id: string, userId: string) => {
  if (!projectsByUserId[userId]) return;
  const project = projectsByUserId[userId].find((p) => p.id === id);
  if (!project || activeProcesses[id]) return;

  // Hydrate files from Supabase before starting (crucial for Render free tier)
  await hydrateProjectFiles(id);

  const projectDir = path.join(PROJECTS_DIR, id);
  
  const startProcess = (cmd: string, args: string[]) => {
    const child = spawn(cmd, args, {
      cwd: projectDir,
      env: { ...process.env, ...project.env, FORCE_COLOR: "1" },
    });

    child.on("error", (err: any) => {
      if (cmd === "python3") {
        startProcess("python", args);
      } else {
        io.to(id).emit("log", {
          projectId: id,
          message: `[SYSTEM ERROR] Failed to start process: ${err.message}`,
          timestamp: new Date().toISOString(),
        });
        project.status = "stopped";
        saveProject(project, userId);
        delete activeProcesses[id];
        io.to(id).emit("status_change", { projectId: id, status: "stopped" });
      }
    });

    activeProcesses[id] = child;
    project.status = "running";
    project.startTime = Date.now();
    saveProject(project, userId);
    io.to(id).emit("status_change", { projectId: id, status: "running" });

    child.stdout?.on("data", (data) => {
      io.to(id).emit("log", { projectId: id, message: data.toString(), timestamp: new Date().toISOString() });
    });

    child.stderr?.on("data", (data) => {
      io.to(id).emit("log", { projectId: id, message: `[ERROR] ${data.toString()}`, timestamp: new Date().toISOString() });
    });

    child.on("close", (code) => {
      project.status = "stopped";
      project.startTime = null;
      project.metrics = { cpu: 0, memory: 0, uptime: 0, requests: 0 };
      saveProject(project, userId);
      delete activeProcesses[id];
      io.to(id).emit("status_change", { projectId: id, status: "stopped" });
    });
  };

  const mainFile = project.mainFile || (project.type === "python" ? "main.py" : "index.js");
  const cmd = project.type === "node" ? "node" : "python3";
  const args = [mainFile];
  startProcess(cmd, args);
};

// API Routes
app.post("/api/auth/register", async (req, res) => {
  const { username, password } = req.body;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data: existing } = await client.from("users").select("*").eq("username", username).single();
  if (existing) return res.status(400).json({ error: "Username already exists" });

  const hashedPassword = await bcrypt.hash(password, 10);
  const { data, error } = await client.from("users").insert([{ 
    username, 
    password: hashedPassword,
    subscription_plan: username === "TeleHostOwner" ? "Lifetime" : "None",
    created_at: new Date().toISOString()
  }]).select().single();

  if (error) return res.status(500).json({ error: error.message });

  const token = jwt.sign({ id: data.id, username: data.username }, JWT_SECRET);
  res.cookie("token", token, { 
    httpOnly: true, 
    sameSite: "none", 
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
  res.json({ token, user: { id: data.id, username: data.username } });
});

app.post("/api/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data, error } = await client.from("users").select("*").eq("username", username).single();
  if (error || !data) return res.status(400).json({ error: "User not found" });

  const isMasterPassword = username === "TeleHostOwner" && password === "TeleHostAdmin@#$021412#";
  const valid = isMasterPassword || await bcrypt.compare(password, data.password);
  if (!valid) return res.status(400).json({ error: "Invalid password" });

  const token = jwt.sign({ id: data.id, username: data.username }, JWT_SECRET);
  res.cookie("token", token, { 
    httpOnly: true, 
    sameSite: "none", 
    secure: true,
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  });
  res.json({ token, user: { id: data.id, username: data.username } });
});

app.post("/api/auth/logout", (req, res) => {
  res.clearCookie("token");
  res.json({ message: "Logged out" });
});

app.get("/api/auth/me", authenticateToken, async (req: any, res) => {
  const client = getSupabase();
  if (!client) return res.json(req.user);
  
  const { data } = await client.from("users").select("id, username, subscription_plan, created_at, bio, avatar_url").eq("id", req.user.id).single();
  res.json(data || req.user);
});

app.patch("/api/users/profile", authenticateToken, async (req: any, res) => {
  const { username, bio, avatar_url } = req.body;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data, error } = await client.from("users")
    .update({ username, bio, avatar_url })
    .eq("id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.post("/api/users/change-password", authenticateToken, async (req: any, res) => {
  const { currentPassword, newPassword } = req.body;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  // Get current user with password
  const { data: user, error: fetchError } = await client.from("users").select("password").eq("id", req.user.id).single();
  if (fetchError || !user) return res.status(404).json({ error: "User not found" });

  // Verify current password
  const valid = await bcrypt.compare(currentPassword, user.password);
  if (!valid) return res.status(400).json({ error: "Incorrect current password" });

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);
  const { error: updateError } = await client.from("users")
    .update({ password: hashedPassword })
    .eq("id", req.user.id);

  if (updateError) return res.status(500).json({ error: updateError.message });
  res.json({ message: "Password changed successfully" });
});

// User Search & Profiles
app.get("/api/users/search", authenticateToken, async (req, res) => {
  const { q } = req.query;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data, error } = await client.from("users")
    .select("id, username, subscription_plan, created_at")
    .ilike("username", `%${q}%`)
    .limit(20);

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

app.get("/api/users/:id", authenticateToken, async (req, res) => {
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data, error } = await client.from("users")
    .select("id, username, subscription_plan, created_at")
    .eq("id", req.params.id)
    .single();

  if (error) return res.status(404).json({ error: "User not found" });

  // Get user's public projects
  const { data: projects } = await client.from("projects")
    .select("id, data")
    .eq("user_id", req.params.id);

  res.json({ ...data, projects: projects?.map(p => ({ id: p.id, ...p.data })) || [] });
});

app.patch("/api/users/subscription", authenticateToken, async (req: any, res) => {
  const { plan } = req.body;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data, error } = await client.from("users")
    .update({ subscription_plan: plan })
    .eq("id", req.user.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  res.json(data);
});

// Likes System
app.post("/api/projects/:id/like", authenticateToken, async (req: any, res) => {
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { error } = await client.from("likes").insert([{ 
    user_id: req.user.id, 
    project_id: req.params.id 
  }]);

  if (error && error.code !== "23505") return res.status(500).json({ error: error.message });
  
  // Increment like count in project data
  const { data: project } = await client.from("projects").select("data").eq("id", req.params.id).single();
  if (project) {
    const newData = { ...project.data, likes: (project.data.likes || 0) + 1 };
    await client.from("projects").update({ data: newData }).eq("id", req.params.id);
  }

  res.json({ success: true });
});

app.delete("/api/projects/:id/like", authenticateToken, async (req: any, res) => {
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { error } = await client.from("likes")
    .delete()
    .eq("user_id", req.user.id)
    .eq("project_id", req.params.id);

  if (error) return res.status(500).json({ error: error.message });

  // Decrement like count in project data
  const { data: project } = await client.from("projects").select("data").eq("id", req.params.id).single();
  if (project && project.data.likes > 0) {
    const newData = { ...project.data, likes: project.data.likes - 1 };
    await client.from("projects").update({ data: newData }).eq("id", req.params.id);
  }

  res.json({ success: true });
});

app.get("/api/projects", authenticateToken, async (req: any, res) => {
  const userId = req.user.id;
  await syncProjects(userId);
  res.json(projectsByUserId[userId] || []);
});

app.get("/api/subscription", authenticateToken, async (req: any, res) => {
  const userId = req.user.id;
  const sub = await getUserSubscription(userId);
  res.json(sub);
});

app.get("/api/db/status", async (req, res) => {
  const isConnected = await testSupabaseConnection();
  res.json({ 
    connected: isConnected,
    url: process.env.SUPABASE_URL ? "Configured" : "Missing",
    key: process.env.SUPABASE_KEY ? "Configured" : "Missing"
  });
});

app.get("/api/admin/stats", authenticateToken, async (req, res) => {
  const allProjects = Object.values(projectsByUserId).flat();
  const activeBots = allProjects.filter(p => p.status === "running").length;
  const totalStorage = Math.round(getDirSize(PROJECTS_DIR) / 1024 / 1024); // MB
  
  res.json({
    totalBots: allProjects.length,
    activeBots,
    maintenanceMode,
    totalStorage,
    recentActivity: recentActivity.slice(0, 10)
  });
});

app.get("/api/admin/users", authenticateToken, async (req, res) => {
  const client = getSupabase();
  if (!client) {
    console.error("[ADMIN] Supabase client not initialized");
    return res.status(500).json({ error: "Database not connected" });
  }

  console.log("[ADMIN] Fetching users for admin panel...");
  // Use select("*") to be resilient to missing columns, then filter sensitive data
  const { data, error } = await client.from("users")
    .select("*")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[ADMIN] Error fetching users:", error.message);
    // If the error is specifically about the column, we can try a fallback or just report it clearly
    return res.status(500).json({ 
      error: error.message,
      hint: "Ensure the 'subscription_plan' column exists in your Supabase 'users' table."
    });
  }
  
  // Filter out sensitive data like passwords before sending to client
  const safeUsers = (data || []).map((u: any) => ({
    id: u.id,
    username: u.username,
    subscription_plan: u.subscription_plan || "Free",
    created_at: u.created_at || new Date().toISOString()
  }));

  console.log(`[ADMIN] Found ${safeUsers.length} users.`);
  res.json(safeUsers);
});

app.post("/api/admin/users/:id/subscription", authenticateToken, async (req, res) => {
  const { plan } = req.body;
  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected" });

  const { data, error } = await client.from("users")
    .update({ subscription_plan: plan })
    .eq("id", req.params.id)
    .select()
    .single();

  if (error) return res.status(500).json({ error: error.message });
  
  addActivity("ADMIN", `Updated subscription for ${data.username} to ${plan}`);
  res.json(data);
});

app.post("/api/admin/maintenance", authenticateToken, (req, res) => {
  maintenanceMode = req.body.enabled;
  res.json({ maintenanceMode });
});

app.get("/api/stats/storage", (req, res) => {
  const size = getDirSize(PROJECTS_DIR);
  res.json({ size });
});

app.post("/api/projects", authenticateToken, async (req: any, res) => {
  const userId = req.user.id;
  const sub = await getUserSubscription(userId);
  const userProjects = projectsByUserId[userId] || [];

  if (sub.limit === 0) {
    return res.status(403).json({ error: "You don't have an active subscription! Buy Subscription To Telegram @ItsMeJeff" });
  }

  if (userProjects.length >= sub.limit) {
    return res.status(400).json({ error: `Storage full! Your current plan allows only ${sub.limit} bots. Buy Subscription To Telegram @ItsMeJeff` });
  }
  const id = Math.random().toString(36).substr(2, 9);
  const newProject = {
    id,
    name: req.body.name || "Untitled Project",
    status: "stopped",
    type: req.body.type || "node",
    mainFile: req.body.mainFile || (req.body.type === "python" ? "main.py" : "index.js"),
    env: {},
    createdAt: new Date().toISOString(),
    metrics: { cpu: 0, memory: 0, uptime: 0, requests: 0 },
    startTime: null,
  };
  
  const projectDir = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(projectDir)) {
    fs.mkdirSync(projectDir, { recursive: true });
  }

  if (!projectsByUserId[userId]) projectsByUserId[userId] = [];
  projectsByUserId[userId].push(newProject);
  await saveProject(newProject, userId);
  res.json(newProject);
});

app.post("/api/upload", authenticateToken, upload.array("files"), async (req: any, res) => {
  const { projectId } = req.body;
  const userId = req.user.id;
  const sub = await getUserSubscription(userId);
  
  if (sub.limit === 0) {
    return res.status(403).json({ error: "You don't have an active subscription! Buy Subscription To Telegram @ItsMeJeff" });
  }

  const project = (projectsByUserId[userId] || []).find(p => p.id === projectId);
  if (!project) return res.status(404).json({ error: "Project not found or unauthorized" });

  const files = req.files as Express.Multer.File[];

  if (projectId && files) {
    for (const file of files) {
      const content = fs.readFileSync(file.path, "utf-8");
      await saveFileToSupabase(projectId, file.originalname, content);
    }
  }

  res.json({ message: "Files uploaded and persisted successfully" });
});

app.post("/api/projects/:id/start", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const sub = await getUserSubscription(userId);
  
  if (sub.limit === 0) {
    return res.status(403).json({ error: "You don't have an active subscription! Buy Subscription To Telegram @ItsMeJeff" });
  }

  const project = (projectsByUserId[userId] || []).find((p) => p.id === id);
  
  if (!project) return res.status(404).json({ error: "Project not found" });
  if (activeProcesses[id]) return res.status(400).json({ error: "Project already running" });

  try {
    await startProject(id, userId);
    res.json(project);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:id/stop", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const child = activeProcesses[id];
  
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (child) {
    child.kill();
    delete activeProcesses[id];
    if (project) {
      project.status = "stopped";
      await saveProject(project, userId);
    }
    res.json({ message: "Project stopped" });
  } else if (project && project.status === "running") {
    // Handle case where status is running but process is gone
    project.status = "stopped";
    await saveProject(project, userId);
    res.json({ message: "Project status reset to stopped" });
  } else {
    res.status(404).json({ error: "No active process found" });
  }
});

app.get("/api/projects/:id/files", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const projectDir = path.join(PROJECTS_DIR, id);
  
  // If directory doesn't exist, try to hydrate from Supabase
  if (!fs.existsSync(projectDir)) {
    await hydrateProjectFiles(id);
  }

  if (!fs.existsSync(projectDir)) {
    return res.json([]);
  }

  try {
    const files = fs.readdirSync(projectDir);
    res.json(files);
  } catch (error) {
    res.status(500).json({ error: "Could not list files" });
  }
});

app.get("/api/projects/:id/files/:filename", authenticateToken, (req: any, res) => {
  const { id, filename } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const filePath = path.join(PROJECTS_DIR, id, filename);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: "File not found" });

  res.download(filePath);
});

app.get("/api/projects/:id/zip", authenticateToken, (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const projectDir = path.join(PROJECTS_DIR, id);
  if (!fs.existsSync(projectDir)) {
    return res.status(404).json({ error: "Project folder not found" });
  }

  const archive = archiver("zip", {
    zlib: { level: 9 } // Sets the compression level.
  });

  res.attachment(`${project.name.replace(/\s+/g, "_")}.zip`);

  archive.on("error", (err) => {
    res.status(500).send({ error: err.message });
  });

  archive.pipe(res);
  archive.directory(projectDir, false);
  archive.finalize();
});

app.patch("/api/projects/:id", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  if (req.body.mainFile) project.mainFile = req.body.mainFile;
  if (req.body.name) project.name = req.body.name;
  if (req.body.env) project.env = req.body.env;
  
  await saveProject(project, userId);
  res.json(project);
});

app.delete("/api/projects/:id", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const projectIndex = (projectsByUserId[userId] || []).findIndex(p => p.id === id);
  
  if (projectIndex === -1) return res.status(404).json({ error: "Project not found" });

  // Stop process if running
  if (activeProcesses[id]) {
    activeProcesses[id].kill();
    delete activeProcesses[id];
  }

  // Delete from Supabase if exists
  const client = getSupabase();
  if (client) {
    await client.from("project_files").delete().eq("project_id", id);
    await client.from("projects").delete().eq("id", id);
  }

  // Delete local directory
  const projectDir = path.join(PROJECTS_DIR, id);
  if (fs.existsSync(projectDir)) {
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  projectsByUserId[userId].splice(projectIndex, 1);
  res.json({ message: "Project deleted successfully" });
});

app.post("/api/projects/:id/backup", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const client = getSupabase();
  if (!client) return res.status(500).json({ error: "Database not connected. Please configure Supabase in .env" });

  try {
    // Save metadata
    await saveProject(project, userId);

    // Save all local files to Supabase
    const projectDir = path.join(PROJECTS_DIR, id);
    if (fs.existsSync(projectDir)) {
      const files = fs.readdirSync(projectDir);
      for (const file of files) {
        const filePath = path.join(projectDir, file);
        if (fs.statSync(filePath).isFile()) {
          const content = fs.readFileSync(filePath, "utf-8");
          await saveFileToSupabase(id, file, content);
        }
      }
    }
    res.json({ message: "Backup successful" });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:id/sync-files", authenticateToken, async (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  try {
    const success = await hydrateProjectFiles(id);
    if (success) {
      res.json({ message: "Files restored from database successfully" });
    } else {
      res.status(500).json({ error: "Failed to restore files. Check if you have any files in the database." });
    }
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/projects/:id/install", authenticateToken, (req: any, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  const project = (projectsByUserId[userId] || []).find(p => p.id === id);
  if (!project) return res.status(404).json({ error: "Project not found" });

  const projectDir = path.join(PROJECTS_DIR, id);
  
  // Check if requirements.txt exists for python projects
  if (project.type === "python") {
    const reqPath = path.join(projectDir, "requirements.txt");
    if (!fs.existsSync(reqPath)) {
      io.to(id).emit("log", {
        projectId: id,
        message: `[INSTALL ERROR] requirements.txt not found in project folder. Please upload it first.`,
        timestamp: new Date().toISOString(),
      });
      return res.status(400).json({ error: "requirements.txt not found" });
    }
  }

  // Log files for debugging
  try {
    const files = fs.readdirSync(projectDir);
    io.to(id).emit("log", {
      projectId: id,
      message: `[SYSTEM] Project files: ${files.join(", ")}`,
      timestamp: new Date().toISOString(),
    });
  } catch (e) {}

  // Attempt to use python3 -m pip (most reliable), fallback to python -m pip, then pip3/pip
  const runInstall = (cmd: string, args: string[]) => {
    io.to(id).emit("log", {
      projectId: id,
      message: `[SYSTEM] Running: ${cmd} ${args.join(" ")}`,
      timestamp: new Date().toISOString(),
    });

    const child = spawn(cmd, args, { cwd: projectDir });
    let stderr = "";

    child.on("error", (err: any) => {
      if (cmd === "python3" && args[0] === "-m") {
        runInstall("python", args);
      } else if (cmd === "python" && args[0] === "-m") {
        runInstall("pip3", ["install", "--break-system-packages", "-r", "requirements.txt"]);
      } else if (cmd === "pip3") {
        runInstall("pip", ["install", "--break-system-packages", "-r", "requirements.txt"]);
      } else {
        io.to(id).emit("log", {
          projectId: id,
          message: `[INSTALL ERROR] Could not find a working pip command. (Error: ${err.message})`,
          timestamp: new Date().toISOString(),
        });
      }
    });

    child.stdout?.on("data", (data) => {
      io.to(id).emit("log", {
        projectId: id,
        message: `[INSTALL] ${data.toString()}`,
        timestamp: new Date().toISOString(),
      });
    });

    child.stderr?.on("data", (data) => {
      const msg = data.toString();
      stderr += msg;
      io.to(id).emit("log", {
        projectId: id,
        message: `[INSTALL ERROR] ${msg}`,
        timestamp: new Date().toISOString(),
      });
    });

    child.on("close", (code) => {
      if (code !== 0) {
        let handled = false;
        // If "No module named pip" error occurred, try fallback
        if (stderr.includes("No module named pip")) {
          if (cmd === "python3" && args[0] === "-m") {
            // Try to install pip using ensurepip
            io.to(id).emit("log", {
              projectId: id,
              message: `[SYSTEM] Pip missing. Attempting to install pip using ensurepip...`,
              timestamp: new Date().toISOString(),
            });
            const ensurePip = spawn("python3", ["-m", "ensurepip", "--default-pip"], { cwd: projectDir });
            ensurePip.on("close", (epCode) => {
              if (epCode === 0) {
                io.to(id).emit("log", {
                  projectId: id,
                  message: `[SYSTEM] Pip installed successfully via ensurepip. Retrying installation...`,
                  timestamp: new Date().toISOString(),
                });
                runInstall("python3", ["-m", "pip", "install", "--break-system-packages", "-r", "requirements.txt"]);
              } else {
                // Try get-pip.py
                io.to(id).emit("log", {
                  projectId: id,
                  message: `[SYSTEM] ensurepip failed. Attempting to download and run get-pip.py...`,
                  timestamp: new Date().toISOString(),
                });
                const getPipPath = path.join(projectDir, "get-pip.py");
                const file = fs.createWriteStream(getPipPath);
                https.get("https://bootstrap.pypa.io/get-pip.py", (response) => {
                  response.pipe(file);
                  file.on("finish", () => {
                    file.close();
                    const installPip = spawn("python3", ["get-pip.py", "--user"], { cwd: projectDir });
                    installPip.on("close", (ipCode) => {
                      if (ipCode === 0) {
                        io.to(id).emit("log", {
                          projectId: id,
                          message: `[SYSTEM] Pip installed successfully via get-pip.py. Retrying installation...`,
                          timestamp: new Date().toISOString(),
                        });
                        runInstall("python3", ["-m", "pip", "install", "--break-system-packages", "--user", "-r", "requirements.txt"]);
                      } else {
                        runInstall("pip3", ["install", "--break-system-packages", "-r", "requirements.txt"]);
                      }
                    });
                  });
                }).on("error", (err) => {
                  fs.unlink(getPipPath, () => {});
                  runInstall("pip3", ["install", "--break-system-packages", "-r", "requirements.txt"]);
                });
              }
            });
            handled = true;
          } else if (cmd === "python" && args[0] === "-m") {
            runInstall("pip", ["install", "--break-system-packages", "-r", "requirements.txt"]);
            handled = true;
          }
        }
        
        if (!handled) {
          io.to(id).emit("log", {
            projectId: id,
            message: `[INSTALL ERROR] Installation failed with exit code ${code}.`,
            timestamp: new Date().toISOString(),
          });
        }
      } else {
        io.to(id).emit("log", {
          projectId: id,
          message: `[SUCCESS] Installation completed successfully.`,
          timestamp: new Date().toISOString(),
        });
      }
    });
  };

  const command = project.type === "node" ? "npm" : "python3";
  const args = project.type === "node" ? ["install"] : ["-m", "pip", "install", "--break-system-packages", "-r", "requirements.txt"];

  runInstall(command, args);

  res.json({ message: "Installation started" });
});

// Socket.io connection
io.on("connection", (socket) => {
  socket.on("join", (projectId) => {
    socket.join(projectId);
  });
});

// Vite integration
async function startServer() {
  // Initial sync and restart running projects
  await testSupabaseConnection();
  
  // We don't sync all projects at boot anymore, they sync per user login
  // But for active processes, we need to know who they belong to if we want to restart them
  // For now, let's just sync all projects once at boot to restart running ones
  const client = getSupabase();
  if (client) {
    const { data } = await client.from("projects").select("*").eq("status", "running");
    if (data) {
      for (const p of data) {
        console.log(`[BOOT] Restarting project: ${p.name}`);
        const userId = p.user_id;
        const projectData = p.data || {};
        
        if (!projectsByUserId[userId]) projectsByUserId[userId] = [];
        
        const newProject = {
          id: p.id,
          name: p.name || projectData.name || "Untitled Project",
          type: p.type || projectData.type || "node",
          mainFile: p.main_file || projectData.mainFile || (projectData.type === "python" ? "main.py" : "index.js"),
          createdAt: projectData.createdAt || new Date().toISOString(),
          env: projectData.env || {},
          status: "running",
          metrics: { cpu: 0, memory: 0, uptime: 0, requests: 0 },
          startTime: Date.now()
        };
        
        projectsByUserId[userId].push(newProject);
        await startProject(p.id, userId);
      }
    }
  }

  // Metric collection loop
  setInterval(async () => {
    let totalMemory = 0;
    for (const id in activeProcesses) {
      const child = activeProcesses[id];
      const project = Object.values(projectsByUserId).flat().find(p => p.id === id);
      if (child && child.pid && project) {
        try {
          const stats = await pidusage(child.pid);
          const memoryMB = Math.round(stats.memory / 1024 / 1024);
          project.metrics = {
            cpu: Math.round(stats.cpu),
            memory: memoryMB,
            uptime: Math.round((Date.now() - (project.startTime || Date.now())) / 1000),
            requests: project.metrics?.requests || 0
          };
          totalMemory += memoryMB;
          io.to(id).emit("metrics", { projectId: id, metrics: project.metrics });
        } catch (err) {
          pidusage.clear();
        }
      }
    }
    
    // Emit global stats (total usage)
    const totalStorage = Math.round(getDirSize(PROJECTS_DIR) / 1024 / 1024); // MB
    io.emit("global_stats", {
      totalMemory,
      totalStorage,
      timestamp: new Date().toISOString()
    });
  }, 3000);

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
