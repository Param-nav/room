import express from "express";
import http from "http";
import cors from "cors";
import bcrypt from "bcryptjs";
import { Server } from "socket.io";
import { v4 as uuidv4 } from "uuid";

// ----------------- CONFIG -----------------
const PORT = process.env.PORT || 5000;
const app = express();

app.use(
  cors({
    origin: "*",
    methods: ["GET", "POST"],
    allowedHeaders: ["Content-Type"],
  })
);

app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket signaling server
const io = new Server(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
  pingTimeout: 30000,
  pingInterval: 10000,
});

// ----------------- TEMP DATABASE -----------------
const users = [];
const rooms = {};

// ----------------- AUTH ROUTES -----------------

// ✅ Signup
app.post("/signup", async (req, res) => {
  try {
    const { username, password, name, gender, country } = req.body;
    if (!username || !password)
      return res.status(400).json({ success: false, msg: "Missing credentials" });

    if (users.find((u) => u.username === username))
      return res
        .status(400)
        .json({ success: false, msg: "Username already exists" });

    const hash = await bcrypt.hash(password, 10);
    const newUser = { username, password: hash, name, gender, country };
    users.push(newUser);

    const safeUser = { ...newUser };
    delete safeUser.password;

    res.json({
      success: true,
      msg: "User registered successfully",
      user: safeUser,
    });
  } catch (err) {
    console.error("❌ Signup error:", err);
    res.status(500).json({ success: false, msg: "Server error during signup" });
  }
});

// ✅ Login
app.post("/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    const user = users.find((u) => u.username === username);
    if (!user)
      return res.status(400).json({ success: false, msg: "Invalid username" });

    const valid = await bcrypt.compare(password, user.password);
    if (!valid)
      return res.status(400).json({ success: false, msg: "Invalid password" });

    const safeUser = { ...user };
    delete safeUser.password;

    res.json({
      success: true,
      msg: "Login successful",
      user: safeUser,
    });
  } catch (err) {
    console.error("❌ Login error:", err);
    res.status(500).json({ success: false, msg: "Server error during login" });
  }
});

// ----------------- SOCKET.IO LOGIC -----------------
io.on("connection", (socket) => {
  console.log(`⚡ User connected: ${socket.id}`);

  // ✅ Create Room
  socket.on("create-room", () => {
    const roomId = uuidv4();
    rooms[roomId] = { users: [] };
    socket.emit("room-created", roomId);
    console.log(`🟢 Room created: ${roomId}`);
  });

  // ✅ Join Room
  socket.on("join-room", ({ roomId, username }) => {
    const room = rooms[roomId];
    if (!room) return socket.emit("room-error", "Room not found");

    const existingUsers = room.users.map((u) => ({
      id: u.id,
      username: u.username,
    }));
    socket.emit("existing-users", existingUsers);

    room.users.push({ id: socket.id, username });
    socket.join(roomId);
    socket.to(roomId).emit("user-joined", { id: socket.id, username });
    console.log(`👤 ${username} joined room ${roomId}`);
  });

  // ✅ WebRTC Signaling
  socket.on("offer", ({ to, offer }) => {
    io.to(to).emit("offer", { from: socket.id, offer });
  });

  socket.on("answer", ({ to, answer }) => {
    io.to(to).emit("answer", { from: socket.id, answer });
  });

  socket.on("ice-candidate", ({ to, candidate }) => {
    io.to(to).emit("ice-candidate", { from: socket.id, candidate });
  });

  // ✅ Leave Room
  socket.on("leave-room", ({ roomId }) => {
    const room = rooms[roomId];
    if (!room) return;

    room.users = room.users.filter((u) => u.id !== socket.id);
    socket.leave(roomId);
    socket.to(roomId).emit("user-left", socket.id);

    if (room.users.length === 0) delete rooms[roomId];
  });

  // ✅ Disconnect
  socket.on("disconnect", () => {
    console.log(`❌ User disconnected: ${socket.id}`);
    for (const [roomId, room] of Object.entries(rooms)) {
      const user = room.users.find((u) => u.id === socket.id);
      if (!user) continue;

      room.users = room.users.filter((u) => u.id !== socket.id);
      socket.to(roomId).emit("user-left", socket.id);

      if (room.users.length === 0) delete rooms[roomId];
    }
  });
});

app.get("/", (req, res) => {
  res.send("✅ Video Signal Server is live on Render!");
});

// ----------------- START SERVER -----------------
server.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
});
