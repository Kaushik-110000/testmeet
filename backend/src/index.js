const express = require("express");
const http = require("http");
const { createWorker } = require("mediasoup");
const socketIo = require("socket.io");
const cors = require("cors");
const dotenv = require("dotenv");
const app = express();

app.use(cors());
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: process.env.Frontend, // Adjust if your frontend runs on a different port
    methods: ["GET", "POST"],
  },
});

// Mediasoup variables

let worker;
const rooms = new Map(); // Key: roomId, Value: { router, transports, producers }

async function initializeMediasoup() {
  worker = await createWorker({
    logLevel: "warn",
    rtcMinPort: 10000,
    rtcMaxPort: 10100,
  });

  console.log("Mediasoup worker created");
}

initializeMediasoup().catch((err) =>
  console.error("Failed to initialize mediasoup:", err)
);

io.on("connection", (socket) => {
  console.log("Client connected:", socket.id);

  socket.on("joinRoom", async ({ roomId }, callback) => {
    try {
      socket.join(roomId);
      let room = rooms.get(roomId);

      if (!room) {
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
        room = { router, transports: [], producers: [] };
        rooms.set(roomId, room);
      }

      socket.emit("rtpCapabilities", room.router.rtpCapabilities);
    } catch (error) {
      console.error("joinRoom error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("createWebRtcTransport", async ({ direction }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(
        (room) => room !== socket.id
      );
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const transport = await room.router.createWebRtcTransport({
        listenIps: [{ ip: "0.0.0.0", announcedIp: null }], // Use your server's IP in production
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
      console.error("createWebRtcTransport error:", error);
      callback({ error: error.message });
    }
  });

  socket.on(
    "connectTransport",
    async ({ transportId, dtlsParameters }, callback) => {
      try {
        const roomId = Array.from(socket.rooms).find(
          (room) => room !== socket.id
        );
        const room = rooms.get(roomId);
        if (!room) throw new Error("Room not found");

        const transport = room.transports.find((t) => t.id === transportId);
        if (!transport) throw new Error("Transport not found");

        await transport.connect({ dtlsParameters });
        callback({ success: true });
      } catch (error) {
        console.error("connectTransport error:", error);
        callback({ error: error.message });
      }
    }
  );

  socket.on("produce", async ({ kind, rtpParameters, appData }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(
        (room) => room !== socket.id
      );
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const transport = room.transports.find(
        (t) =>
          t.appData.socketId === socket.id && t.appData.direction === "producer"
      );
      if (!transport) throw new Error("Producer transport not found");

      const producer = await transport.produce({
        kind,
        rtpParameters,
        appData: { ...appData, socketId: socket.id },
      });

      console.log("Producer created on backend:", producer); // Debugging: Log the producer object

      room.producers.push(producer);
      socket.to(roomId).emit("newProducer", { producerId: producer.id });

      callback({ id: producer.id });
    } catch (error) {
      console.error("produce error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("consume", async ({ producerId, rtpCapabilities }, callback) => {
    try {
      const roomId = Array.from(socket.rooms).find(
        (room) => room !== socket.id
      );
      const room = rooms.get(roomId);
      if (!room) throw new Error("Room not found");

      const producer = room.producers.find((p) => p.id === producerId);
      if (!producer) throw new Error("Producer not found");

      if (!room.router.canConsume({ producerId, rtpCapabilities })) {
        throw new Error("Cannot consume");
      }

      const transport = room.transports.find(
        (t) =>
          t.appData.socketId === socket.id && t.appData.direction === "consumer"
      );
      if (!transport) throw new Error("Consumer transport not found");

      const consumer = await transport.consume({
        producerId,
        rtpCapabilities,
        paused: false,
      });

      console.log("Consumer created on backend:", consumer); // Debugging: Log the consumer object

      callback({
        params: {
          id: consumer.id,
          producerId: consumer.producerId,
          kind: consumer.kind,
          rtpParameters: consumer.rtpParameters,
        },
      });
    } catch (error) {
      console.error("consume error:", error);
      callback({ error: error.message });
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    rooms.forEach((room, roomId) => {
      room.producers = room.producers.filter(
        (p) => p.appData.socketId !== socket.id
      );
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

server.listen(5000, () => console.log("Server running on port 5000"));
