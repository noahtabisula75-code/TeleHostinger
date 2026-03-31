import express from "express";
import { createServer } from "http";
import { Server } from "socket.io";
import { createServer as createViteServer } from "vite";
import { Telegraf } from "telegraf";
import path from "path";
import multer from "multer";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import AdmZip from "adm-zip";
import axios from "axios";

// Global error handlers to prevent process crashes
process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

const projectsDir = path.join(process.cwd(), "projects");

if (!fs.existsSync(projectsDir)) {
  fs.mkdirSync(projectsDir);
}

interface ProjectMetadata {
  id: string;
  name: string;
  type: "nodejs" | "python";
  token?: string;
  mainScript?: string;
  createdAt: string;
  isLiked?: boolean;
  status?: "offline" | "online" | "starting";
  startedAt?: string;
  userId?: string;
  githubUrl?: string;
}

// In-memory state for running processes
interface ProjectState {
  status: "offline" | "online" | "starting";
  process: ChildProcess | Telegraf | null;
  startedAt?: string;
}

const projectStates = new Map<string, ProjectState>();

const ADMIN_CREDENTIALS = {
  username: "TeleHostAdmin123",
  password: "TeleHostAdmin@2011#"
};

const PLANS = {
  default: { maxProjects: 3, storageGB: 0.5 },
  starter: { maxProjects: 5, storageGB: 1 },
  pro: { maxProjects: 10, storageGB: 3 },
  ultra: { maxProjects: 15, storageGB: 5 }
};

interface UserProfile {
  id: string;
  username: string;
  password?: string;
  plan: string;
  createdAt: string;
}

async function getUsers(): Promise<UserProfile[]> {
  const usersFile = path.join(process.cwd(), "users.json");
  if (!fs.existsSync(usersFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(usersFile, "utf8"));
  } catch {
    return [];
  }
}

async function saveUsers(users: UserProfile[]) {
  const usersFile = path.join(process.cwd(), "users.json");
  fs.writeFileSync(usersFile, JSON.stringify(users, null, 2));
}

async function getUserPlan(userId: string): Promise<string> {
  const users = await getUsers();
  const user = users.find(u => u.id === userId);
  return user?.plan || "default";
}

async function setUserPlan(userId: string, plan: string) {
  const users = await getUsers();
  const index = users.findIndex(u => u.id === userId);
  if (index >= 0) {
    users[index].plan = plan;
    await saveUsers(users);
  }
}

// Local Storage Setup
const projectsFile = path.join(process.cwd(), "projects.json");

async function getProjects(): Promise<ProjectMetadata[]> {
  if (!fs.existsSync(projectsFile)) return [];
  try {
    return JSON.parse(fs.readFileSync(projectsFile, "utf8"));
  } catch (err) {
    console.error("Error reading projects.json:", err);
    return [];
  }
}

async function saveProject(project: ProjectMetadata) {
  const projects = await getProjects();
  const index = projects.findIndex(p => p.id === project.id);
  if (index >= 0) {
    projects[index] = project;
  } else {
    projects.push(project);
  }
  try {
    fs.writeFileSync(projectsFile, JSON.stringify(projects, null, 2));
  } catch (err) {
    console.error("Error saving projects.json:", err);
  }
}

// Disable Supabase storage sync as we'll use local storage only
async function uploadToSupabase() {
  // No-op: Using local storage only
}

async function downloadFromSupabase() {
  // No-op: Using local storage only
}

function getProjectDir(projectId: string) {
  const dir = path.join(projectsDir, projectId);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function startServer() {
  const app = express();
  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: "*" },
  });

  const PORT = process.env.PORT || 3000;

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok", time: new Date().toISOString() });
  });

  const tryPipInstall = (projectId: string, cmd: string, args: string[]): Promise<boolean> => {
    return new Promise((resolve, reject) => {
      const projectDir = getProjectDir(projectId);
      const pip = spawn(cmd, args, { cwd: projectDir });
      
      pip.on("error", (err) => reject(err));

      pip.stdout.on("data", (data) => {
        io.to(projectId).emit("log", { projectId, type: "info", message: `[pip] ${data.toString().trim()}` });
      });

      pip.stderr.on("data", (data) => {
        io.to(projectId).emit("log", { projectId, type: "info", message: `[pip-warn] ${data.toString().trim()}` });
      });

      pip.on("close", (code) => {
        if (code === 0) resolve(true);
        else reject(new Error(`Pip failed with code ${code}`));
      });
    });
  };

  const bootstrapPip = async (projectId: string): Promise<boolean> => {
    const projectDir = getProjectDir(projectId);
    const getPipPath = path.join(projectDir, "get-pip.py");
    io.to(projectId).emit("log", { projectId, type: "info", message: "Downloading get-pip.py for emergency bootstrap..." });
    
    try {
      const response = await fetch("https://bootstrap.pypa.io/get-pip.py");
      if (!response.ok) throw new Error(`Failed to download get-pip.py: ${response.statusText}`);
      const buffer = await response.arrayBuffer();
      fs.writeFileSync(getPipPath, Buffer.from(buffer));
      
      io.to(projectId).emit("log", { projectId, type: "info", message: "Running get-pip.py..." });
      await tryPipInstall(projectId, "python3", [path.basename(getPipPath), "--user"]);
      io.to(projectId).emit("log", { projectId, type: "success", message: "Emergency pip bootstrap successful!" });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      io.to(projectId).emit("log", { projectId, type: "error", message: `Emergency bootstrap failed: ${message}` });
      return false;
    }
  };

  const runPipInstall = async (projectId: string, requirementsFilename: string) => {
    io.to(projectId).emit("log", { projectId, type: "info", message: "Installing dependencies from requirements.txt..." });
    try {
      try {
        await tryPipInstall(projectId, "pip3", ["install", "-r", requirementsFilename]);
      } catch (e: unknown) {
        const isEnoent = e && typeof e === 'object' && 'code' in e && e.code === 'ENOENT';
        if (isEnoent) {
          io.to(projectId).emit("log", { projectId, type: "info", message: "pip3 not found, trying python3 -m pip..." });
          try {
            await tryPipInstall(projectId, "python3", ["-m", "pip", "install", "-r", requirementsFilename]);
          } catch {
            io.to(projectId).emit("log", { projectId, type: "info", message: "pip module missing, attempting to bootstrap with ensurepip..." });
            try {
              await tryPipInstall(projectId, "python3", ["-m", "ensurepip", "--user"]);
              await tryPipInstall(projectId, "python3", ["-m", "pip", "install", "--user", "-r", requirementsFilename]);
            } catch {
              io.to(projectId).emit("log", { projectId, type: "info", message: "ensurepip failed, attempting emergency get-pip.py bootstrap..." });
              const bootstrapped = await bootstrapPip(projectId);
              if (bootstrapped) {
                await tryPipInstall(projectId, "python3", ["-m", "pip", "install", "--user", "-r", requirementsFilename]);
              } else {
                await tryPipInstall(projectId, "pip", ["install", "-r", requirementsFilename]);
              }
            }
          }
        } else throw e;
      }
      io.to(projectId).emit("log", { projectId, type: "success", message: "Dependencies installed successfully!" });
      return true;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      io.to(projectId).emit("log", { projectId, type: "error", message: `Failed to install dependencies: ${message}` });
      return false;
    }
  };

  const launchProject = async (id: string) => {
    try {
      // Sync files down from Supabase first (for free hosting persistence)
      await downloadFromSupabase();

      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) throw new Error("Project not found");

      const token = project.token;
      const mainScript = project.mainScript;

      projectStates.set(id, { status: "starting", process: null });
      io.to(id).emit("status", { projectId: id, status: "starting" });
      io.to(id).emit("log", { projectId: id, type: "info", message: `Starting ${project.type} deployment...` });

      if (project.type === "nodejs") {
        if (mainScript && fs.existsSync(path.join(getProjectDir(id), mainScript))) {
          io.to(id).emit("log", { projectId: id, type: "info", message: `Spawning node process for ${mainScript}...` });
          const nodeProc = spawn("node", [mainScript], {
            cwd: getProjectDir(id),
            env: { ...process.env, BOT_TOKEN: token }
          });
          nodeProc.stdout.on("data", (data) => io.to(id).emit("log", { projectId: id, type: "bot", message: `[node] ${data.toString().trim()}` }));
          nodeProc.stderr.on("data", (data) => io.to(id).emit("log", { projectId: id, type: "error", message: `[node-err] ${data.toString().trim()}` }));
          nodeProc.on("close", (code) => {
            projectStates.set(id, { status: "offline", process: null });
            io.to(id).emit("status", { projectId: id, status: "offline" });
            io.to(id).emit("log", { projectId: id, type: "info", message: `Process exited with code ${code}` });
            saveProject({ ...project, status: "offline", startedAt: undefined });
          });
          const startedAt = new Date().toISOString();
          projectStates.set(id, { status: "online", process: nodeProc, startedAt });
          await saveProject({ ...project, status: "online", startedAt });
        } else if (token) {
          io.to(id).emit("log", { projectId: id, type: "info", message: "No script found, launching default Telegraf bot..." });
          const bot = new Telegraf(token);
          bot.start((ctx) => ctx.reply("Welcome to your TeleHost bot! 🚀"));
          bot.on("text", (ctx) => {
            io.to(id).emit("log", { projectId: id, type: "bot", message: `Received: "${ctx.message.text}" from ${ctx.from.first_name}` });
            ctx.reply(`You said: ${ctx.message.text}`);
          });
          await bot.launch();
          const startedAt = new Date().toISOString();
          projectStates.set(id, { status: "online", process: bot, startedAt });
          await saveProject({ ...project, status: "online", startedAt });
        } else {
          throw new Error("Token required for default bot or script required for custom bot");
        }
      } else {
        if (!mainScript || !fs.existsSync(path.join(getProjectDir(id), mainScript))) {
          throw new Error("Python main script required (upload a .py file)");
        }
        
        // Check for requirements.txt and install if exists
        const reqPath = path.join(getProjectDir(id), "requirements.txt");
        if (fs.existsSync(reqPath)) {
          await runPipInstall(id, "requirements.txt");
        }
        
        io.to(id).emit("log", { projectId: id, type: "info", message: `Spawning python process for ${mainScript}...` });
        const pyProc = spawn("python3", [mainScript], {
          cwd: getProjectDir(id),
          env: { ...process.env, PYTHONUNBUFFERED: "1" }
        });
        pyProc.stdout.on("data", (data) => io.to(id).emit("log", { projectId: id, type: "bot", message: `[python] ${data.toString().trim()}` }));
        pyProc.stderr.on("data", (data) => io.to(id).emit("log", { projectId: id, type: "error", message: `[python-err] ${data.toString().trim()}` }));
        pyProc.on("close", (code) => {
          projectStates.set(id, { status: "offline", process: null });
          io.to(id).emit("status", { projectId: id, status: "offline" });
          io.to(id).emit("log", { projectId: id, type: "info", message: `Python process exited with code ${code}` });
          saveProject({ ...project, status: "offline", startedAt: undefined });
        });
        const startedAt = new Date().toISOString();
        projectStates.set(id, { status: "online", process: pyProc, startedAt });
        await saveProject({ ...project, status: "online", startedAt });
      }

      const finalState = projectStates.get(id);
      io.to(id).emit("status", { projectId: id, status: "online", startedAt: finalState?.startedAt });
      io.to(id).emit("log", { projectId: id, type: "success", message: "Deployment successful!" });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      projectStates.set(id, { status: "offline", process: null });
      io.to(id).emit("status", { projectId: id, status: "offline" });
      io.to(id).emit("log", { projectId: id, type: "error", message: `Deployment failed: ${message}` });
      
      const projects = await getProjects();
      const p = projects.find(p => p.id === id);
      if (p) saveProject({ ...p, status: "offline", startedAt: undefined });
      throw error;
    }
  };

  const bootstrapProjects = async () => {
    console.log("[bootstrap] Auto-restarting projects...");
    const projects = await getProjects();
    for (const project of projects) {
      if (project.status === "online") {
        console.log(`[bootstrap] Restarting project ${project.name} (${project.id})...`);
        launchProject(project.id).catch(err => console.error(`[bootstrap] Failed to restart ${project.id}:`, err));
      }
    }
  };

  // Socket.io Room Management
  io.on("connection", (socket) => {
    socket.on("join", (projectId) => {
      socket.join(projectId);
    });
  });

  // Project Management API
  app.get("/api/projects", async (req, res) => {
    try {
      const projects = await getProjects();
      const projectsWithStatus = projects.map(p => {
        const state = projectStates.get(p.id);
        return {
          ...p,
          status: state?.status || "offline",
          startedAt: state?.startedAt
        };
      });
      res.json(projectsWithStatus);
    } catch (err) {
      console.error("Error in GET /api/projects:", err);
      res.status(500).json({ error: "Failed to fetch projects" });
    }
  });

  app.post("/api/projects", async (req, res) => {
    try {
      const { name, type, userId } = req.body;
      if (!name || !type || !userId) return res.status(400).json({ error: "Name, type, and userId required" });
      
      const projects = await getProjects();
      const userProjects = projects.filter(p => p.userId === userId);
      const userPlan = await getUserPlan(userId);
      const limit = PLANS[userPlan as keyof typeof PLANS]?.maxProjects || PLANS.default.maxProjects;

      if (userProjects.length >= limit) {
        return res.status(403).json({ 
          error: `Project limit reached. Your current plan (${userPlan}) allows up to ${limit} projects.`,
          limitReached: true
        });
      }

      const newProject: ProjectMetadata = {
        id: Math.random().toString(36).substr(2, 9),
        name,
        type,
        createdAt: new Date().toISOString(),
        isLiked: false,
        userId
      };
      
      await saveProject(newProject);
      getProjectDir(newProject.id); // Ensure directory exists
      res.json(newProject);
    } catch (err) {
      console.error("Error in POST /api/projects:", err);
      res.status(500).json({ error: "Failed to create project" });
    }
  });

  app.post("/api/projects/:id/like", async (req, res) => {
    try {
      const { id } = req.params;
      const { isLiked } = req.body;
      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      project.isLiked = isLiked;
      await saveProject(project);
      res.json({ success: true, isLiked: project.isLiked });
    } catch (err) {
      console.error("Error in POST /api/projects/:id/like:", err);
      res.status(500).json({ error: "Failed to update project" });
    }
  });

  app.delete("/api/projects/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      // Stop if running
      const state = projectStates.get(id);
      if (state?.process) {
        if (project.type === "nodejs" && state.process instanceof Telegraf) {
          await state.process.stop();
        } else if (state.process instanceof ChildProcess) {
          state.process.kill();
        }
      }
      projectStates.delete(id);

      const updatedProjects = projects.filter(p => p.id !== id);
      fs.writeFileSync(projectsFile, JSON.stringify(updatedProjects, null, 2));
      
      const projectDir = getProjectDir(id);
      if (fs.existsSync(projectDir)) {
        fs.rmSync(projectDir, { recursive: true, force: true });
      }
      
      res.json({ success: true });
    } catch (err) {
      console.error("Error in DELETE /api/projects/:id:", err);
      res.status(500).json({ error: "Failed to delete project" });
    }
  });

  // Project-specific API
  app.get("/api/projects/:id/status", async (req, res) => {
    try {
      const { id } = req.params;
      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const checkCommand = (cmd: string, args: string[]): Promise<boolean> => {
        return new Promise((resolve) => {
          try {
            const proc = spawn(cmd, args);
            proc.on("error", () => resolve(false));
            proc.on("close", (code) => resolve(code === 0));
          } catch { resolve(false); }
        });
      };

      const pythonAvailable = await checkCommand("python3", ["--version"]);
      let pipAvailable = await checkCommand("pip3", ["--version"]);
      if (!pipAvailable && pythonAvailable) pipAvailable = await checkCommand("python3", ["-m", "pip", "--version"]);
      
      const state = projectStates.get(id);
      res.json({ 
        status: state?.status || "offline", 
        startedAt: state?.startedAt,
        diagnostics: { python: pythonAvailable, pip: pipAvailable }
      });
    } catch (err) {
      console.error("Error in GET /api/projects/:id/status:", err);
      res.status(500).json({ error: "Failed to fetch status" });
    }
  });

  const projectUpload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => {
        const dir = getProjectDir(req.params.id);
        console.log(`[multer] Uploading ${file.fieldname} to ${dir}`);
        cb(null, dir);
      },
      filename: (req, file, cb) => {
        console.log(`[multer] File name: ${file.originalname}`);
        cb(null, file.originalname);
      },
    }),
    limits: { fileSize: 50 * 1024 * 1024 } // 50MB
  });

  app.post("/api/projects/:id/deploy", projectUpload.fields([
    { name: "script", maxCount: 1 },
    { name: "requirements", maxCount: 1 },
    { name: "extraFiles", maxCount: 10 }
  ]), async (req, res) => {
    try {
      const { id } = req.params;
      const { token: newToken } = req.body;
      
      console.log(`[deploy] Starting deployment for project ${id}`);
      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const files = req.files as { [fieldname: string]: Express.Multer.File[] };
      const scriptFile = files?.script?.[0];
      const requirementsFile = files?.requirements?.[0];
      const extraFiles = files?.extraFiles || [];

      if (scriptFile) await uploadToSupabase();
      if (requirementsFile) await uploadToSupabase();
      await Promise.all(extraFiles.map(() => uploadToSupabase()));

      if (scriptFile) console.log(`[deploy] Script file uploaded: ${scriptFile.originalname}`);
      if (requirementsFile) console.log(`[deploy] Requirements file uploaded: ${requirementsFile.originalname}`);
      if (extraFiles.length > 0) {
        console.log(`[deploy] ${extraFiles.length} extra files uploaded`);
        extraFiles.forEach(f => console.log(`[deploy] - ${f.originalname}`));
      }

      // Use provided token or fall back to stored one
      const token = newToken || project.token;
      // Use provided script or fall back to stored one
      const mainScript = scriptFile ? scriptFile.originalname : project.mainScript;

      // Update project metadata if changed
      if (token !== project.token || mainScript !== project.mainScript) {
        project.token = token;
        project.mainScript = mainScript;
        await saveProject(project);
      }

      // Stop existing
      const oldState = projectStates.get(id);
      if (oldState?.process) {
        io.to(id).emit("log", { projectId: id, type: "info", message: "Stopping existing process..." });
        if (project.type === "nodejs" && oldState.process instanceof Telegraf) await oldState.process.stop();
        else if (oldState.process instanceof ChildProcess) oldState.process.kill();
      }

      await launchProject(id);
      res.json({ success: true });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      res.status(500).json({ error: message });
    }
  });

  app.post("/api/projects/:id/stop", async (req, res) => {
    const { id } = req.params;
    const state = projectStates.get(id);
    const projects = await getProjects();
    const project = projects.find(p => p.id === id);
    if (!state?.process || !project) return res.status(400).json({ error: "Not running" });

    if (project.type === "nodejs" && state.process instanceof Telegraf) await state.process.stop();
    else if (state.process instanceof ChildProcess) state.process.kill();

    projectStates.set(id, { status: "offline", process: null });
    io.to(id).emit("status", { projectId: id, status: "offline" });
    io.to(id).emit("log", { projectId: id, type: "info", message: "Stopped manually." });
    await saveProject({ ...project, status: "offline", startedAt: undefined });
    res.json({ success: true });
  });

  app.post("/api/projects/:id/github-import", async (req, res) => {
    try {
      const { id } = req.params;
      const { githubUrl } = req.body;
      if (!githubUrl) return res.status(400).json({ error: "GitHub URL required" });

      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      // Parse GitHub URL to get zip download link
      // Example: https://github.com/user/repo -> https://github.com/user/repo/archive/refs/heads/main.zip
      let zipUrl = githubUrl.replace(/\/$/, "");
      if (!zipUrl.endsWith(".zip")) {
        zipUrl = `${zipUrl}/archive/refs/heads/main.zip`;
      }

      io.to(id).emit("log", { projectId: id, type: "info", message: `Importing from GitHub: ${githubUrl}...` });

      const response = await axios.get(zipUrl, { responseType: "arraybuffer" });
      const zip = new AdmZip(Buffer.from(response.data));
      const projectDir = getProjectDir(id);

      // Extract to a temporary directory first to handle the top-level folder in the zip
      const tempDir = path.join(projectDir, "_temp_import");
      if (!fs.existsSync(tempDir)) fs.mkdirSync(tempDir);
      zip.extractAllTo(tempDir, true);

      // Move files from the extracted top-level folder to projectDir
      const extractedFolders = fs.readdirSync(tempDir);
      if (extractedFolders.length > 0) {
        const topFolder = path.join(tempDir, extractedFolders[0]);
        if (fs.statSync(topFolder).isDirectory()) {
          const files = fs.readdirSync(topFolder);
          for (const file of files) {
            const src = path.join(topFolder, file);
            const dest = path.join(projectDir, file);
            if (fs.existsSync(dest)) {
              if (fs.statSync(dest).isDirectory()) {
                fs.rmSync(dest, { recursive: true, force: true });
              } else {
                fs.unlinkSync(dest);
              }
            }
            fs.renameSync(src, dest);
          }
        }
      }

      fs.rmSync(tempDir, { recursive: true, force: true });

      project.githubUrl = githubUrl;
      await saveProject(project);

      io.to(id).emit("log", { projectId: id, type: "success", message: "GitHub import successful!" });
      res.json({ success: true });
    } catch (err: unknown) {
      console.error("GitHub import error:", err);
      const message = err instanceof Error ? err.message : String(err);
      res.status(500).json({ error: `GitHub import failed: ${message}` });
    }
  });

  app.get("/api/projects/:id/files", async (req, res) => {
    try {
      const { id } = req.params;
      const projects = await getProjects();
      const project = projects.find(p => p.id === id);
      if (!project) return res.status(404).json({ error: "Project not found" });

      const dir = getProjectDir(id);
      const files = fs.readdirSync(dir);
      const details = files.map(f => {
        const s = fs.statSync(path.join(dir, f));
        return { name: f, size: s.size, modifiedAt: s.mtime, isDirectory: s.isDirectory() };
      });
      res.json(details);
    } catch { res.status(500).json({ error: "Failed to list files" }); }
  });

  app.delete("/api/projects/:id/files/:filename", (req, res) => {
    const filePath = path.join(getProjectDir(req.params.id), req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    fs.unlinkSync(filePath);
    res.json({ success: true });
  });

  app.get("/api/projects/:id/files/:filename", (req, res) => {
    const filePath = path.join(getProjectDir(req.params.id), req.params.filename);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: "Not found" });
    res.download(filePath);
  });

  // Auth Routes
  app.post("/api/auth/signup", async (req, res) => {
    try {
      const { username, password } = req.body;
      if (!username || !password) return res.status(400).json({ error: "Username and password required" });
      
      const users = await getUsers();
      if (users.find(u => u.username === username) || username === ADMIN_CREDENTIALS.username) {
        return res.status(400).json({ error: "Username already exists" });
      }

      const newUser = {
        id: Math.random().toString(36).substr(2, 9),
        username,
        password, // In a real app, hash this!
        plan: "default",
        createdAt: new Date().toISOString()
      };

      users.push(newUser);
      await saveUsers(users);
      
      const userWithoutPassword = { ...newUser };
      delete userWithoutPassword.password;
      res.json(userWithoutPassword);
    } catch (err) {
      console.error("Signup error:", err);
      res.status(500).json({ error: "Signup failed" });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const { username, password } = req.body;
      
      // Check Admin
      if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        return res.json({
          id: "admin-id",
          username: ADMIN_CREDENTIALS.username,
          isAdmin: true,
          plan: "ultra"
        });
      }

      const users = await getUsers();
      const user = users.find(u => u.username === username && u.password === password);
      
      if (!user) return res.status(401).json({ error: "Invalid credentials" });

      const userWithoutPassword = { ...user };
      delete userWithoutPassword.password;
      res.json({ ...userWithoutPassword, isAdmin: false });
    } catch (err) {
      console.error("Login error:", err);
      res.status(500).json({ error: "Login failed" });
    }
  });

  // Admin Routes
  app.get("/api/admin/users", async (req, res) => {
    try {
      const users = await getUsers();
      const usersWithPlans = users.map(u => ({
        id: u.id,
        username: u.username,
        plan: u.plan
      }));
      res.json(usersWithPlans);
    } catch (err) {
      console.error("Admin fetch users error:", err);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  app.post("/api/admin/update-plan", async (req, res) => {
    try {
      const { userId, plan } = req.body;
      if (!userId || !plan) return res.status(400).json({ error: "userId and plan required" });
      if (!PLANS[plan as keyof typeof PLANS]) return res.status(400).json({ error: "Invalid plan" });

      await setUserPlan(userId, plan);
      res.json({ success: true, plan });
    } catch (err) {
      console.error("Admin update plan error:", err);
      res.status(500).json({ error: "Failed to update plan" });
    }
  });

  app.all("/api/*", (req, res) => {
    res.status(404).json({ error: `API Route ${req.method} ${req.url} not found` });
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({ 
      server: { middlewareMode: true }, 
      appType: "spa" 
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (req, res) => res.sendFile(path.join(distPath, "index.html")));
  }

  httpServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    bootstrapProjects().catch(err => console.error("[bootstrap] Critical error:", err));
  });
}

startServer().catch(err => {
  console.error("CRITICAL: Failed to start server:", err);
  process.exit(1);
});
