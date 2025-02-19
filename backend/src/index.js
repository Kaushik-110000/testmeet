import express from "express";
import { createWorker } from "mediasoup";
import { Server } from "socket.io";
import cors from "cors";
import dotenv from "dotenv";
import { v4 as uuidv4 } from "uuid";

dotenv.config();

const app = express();
app.use(cors());

const PORT = process.env.PORT || 5000;
const io = new Server({
  cors: {
    origin: process.env.FRONTEND,
    methods: ["GET", "POST"],
  },
});

let worker;
const rooms = new Map(); // Stores room details

// Initialize Mediasoup worker
async function initializeMediasoup() {
  worker = await createWorker({
    logLevel: "warn",
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });
  console.log("Mediasoup worker initialized");
}

initializeMediasoup().catch((err) => console.error("Mediasoup Error:", err));

io.on("connection", (socket) => {
  console.log(`Client connected: ${socket.id}`);

  socket.on("createRoom", async (callback) => {
    try {
      const roomId = uuidv4(); // Generate unique room ID
      const router = await worker.createRouter({
        mediaCodecs: [
          {
            kind: "audio",
            mimeType: "audio/opus",
            clockRate: 48000,
            channels: 2,
          },
          {
            kind: "video",
            mimeType: "video/VP8",
            clockRate: 90000,
            parameters: { "x-google-start-bitrate": 1000 },
          },
        ],
      });

      rooms.set(roomId, { router, transports: [], producers: [] });
      console.log(`Room created: ${roomId}`);
      callback({ roomId });
    } catch (error) {
      console.error("Error creating room:", error);
      callback({ error: error.message });
    }
  });

  socket.on("joinRoom", async ({ roomId }, callback) => {
    try {
      if (!rooms.has(roomId)) {
        return callback({ error: "Room not found" });
      }

      socket.join(roomId);
      const room = rooms.get(roomId);
      socket.emit("rtpCapabilities", room.router.rtpCapabilities);
    } catch (error) {
      console.error("Join Room Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("createWebRtcTransport", async ({ direction }, callback) => {
    try {
      const roomId = [...socket.rooms].find((room) => room !== socket.id);
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const transport = await room.router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: process.env.PUBLIC_IP || null }],
        enableUdp: true,
        enableTcp: true,
        preferUdp: true,
      });

      transport.appData = { socketId: socket.id, direction };
      room.transports.push(transport);

      callback({
        params: {
          id: transport.id,
          iceParameters: transport.iceParameters,
          iceCandidates: transport.iceCandidates,
          dtlsParameters: transport.dtlsParameters,
        },
      });

      transport.on("close", () => {
        room.transports = room.transports.filter((t) => t.id !== transport.id);
      });
    } catch (error) {
      console.error("WebRTC Transport Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("produce", async ({ kind, rtpParameters }, callback) => {
    try {
      const roomId = [...socket.rooms].find((room) => room !== socket.id);
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const transport = room.transports.find(
        (t) => t.appData.socketId === socket.id && t.appData.direction === "producer"
      );
      if (!transport) throw new Error("Producer transport not found");

      const producer = await transport.produce({ kind, rtpParameters, appData: { socketId: socket.id } });
      room.producers.push(producer);
      socket.to(roomId).emit("newProducer", { producerId: producer.id });

      callback({ id: producer.id });
    } catch (error) {
      console.error("Produce Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    try {
      const roomId = [...socket.rooms].find((room) => room !== socket.id);
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const producer = room.producers.find((p) => p.id === producerId);
      if (!producer) throw new Error("Producer not found");

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error("Cannot consume");
      }

      const transport = room.transports.find(
        (t) => t.appData.socketId === socket.id && t.appData.direction === "consumer"
      );
      if (!transport) throw new Error("Consumer transport not found");

      const consumer = await transport.consume({ producerId, rtpCapabilities, paused: false });

      callback({
        params: {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        },
      });
    } catch (error) {
      console.error("Consume Error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log(`Client disconnected: ${socket.id}`);
    rooms.forEach((room) => {
      room.producers = room.producers.filter((p) => p.appData.socketId !== socket.id);
      room.transports = room.transports.filter((t) => {
        if (t.appData.socketId === socket.id) {
          t.close();
          return false;
        }
        return true;
      });
    });
  });
});

const server = app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
io.listen(server);
