import React, { useState, useRef, useEffect } from "react";
import io from "socket.io-client";
import * as mediasoupClient from "mediasoup-client";

// Use environment variable correctly for frontend
const socket = io(import.meta.env.VITE_BACKEND || "http://localhost:5000");

function MeetInterface() {
  const [roomId, setRoomId] = useState("");
  const [currentRoom, setCurrentRoom] = useState(null);
  const [device, setDevice] = useState(null);
  const [producerTransport, setProducerTransport] = useState(null);
  const [consumerTransport, setConsumerTransport] = useState(null);
  const [localStream, setLocalStream] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  const joinRoom = (room) => {
    socket.emit("joinRoom", { roomId: room });
    setCurrentRoom(room);
  };

  const handleCreateRoom = () => {
    socket.emit("createRoom", (response) => {
      if (response.error) {
        console.error("Room creation failed:", response.error);
      } else {
        console.log("Room ID:", response.roomId);
        setRoomId(response.roomId); // Store the room ID
        joinRoom(response.roomId);
      }
    });
  };

  const handleJoinRoom = () => {
    console.log(roomId, "YOur room id trying to join");
    if (!roomId) {
      alert("Enter a valid Room ID!");
      return;
    }
    socket.emit("joinRoom", { roomId }, (response) => {
      if (response.error) {
        console.error("Join Room Failed:", response.error);
      } else {
        console.log("Joined room:", roomId);
        setCurrentRoom(roomId);
      }
    });
  };

  const handleLeaveRoom = () => {
    setCurrentRoom(null);
    if (localStream) {
      localStream.getTracks().forEach((track) => track.stop());
      setLocalStream(null);
    }
  };

  const handleStartCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: true,
        audio: true,
      });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
    }
  };

  useEffect(() => {
    if (currentRoom) {
      socket.on("rtpCapabilities", async (routerRtpCapabilities) => {
        try {
          const device = new mediasoupClient.Device();
          await device.load({ routerRtpCapabilities });
          setDevice(device);
        } catch (err) {
          console.error("Error loading Mediasoup device:", err);
        }
      });
      socket.on("newProducer", ({ producerId }) => {
        if (consumerTransport && device) {
          consumeMedia(producerId, consumerTransport, device);
        }
      });
    }
    return () => {
      socket.off("rtpCapabilities");
      socket.off("newProducer");
    };
  }, [currentRoom, device, consumerTransport]);

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-800 to-purple-800 flex flex-col">
      <header className="p-4 flex justify-between items-center">
        <h1 className="text-2xl text-white font-bold">Let's Meet</h1>
        <div className="flex items-center space-x-4">
          <input
            type="text"
            className="px-3 py-2 rounded-md text-black bg-white focus:outline-none"
            placeholder="Room ID"
            value={roomId}
            onChange={(e) => setRoomId(e.target.value)}
          />
          <button
            onClick={handleJoinRoom}
            className="bg-blue-500 hover:bg-blue-600 text-white px-4 py-2 rounded-md"
          >
            Join
          </button>
          <button
            onClick={handleCreateRoom}
            className="bg-green-500 hover:bg-green-600 text-white px-4 py-2 rounded-md"
          >
            Create
          </button>
        </div>
      </header>
      <main className="flex-grow flex flex-col items-center justify-center px-4">
        {currentRoom && (
          <div className="mb-4">
            <span className="text-white text-lg">Current Room: </span>
            <span className="text-white font-bold">{currentRoom}</span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-6xl">
          <div className="relative bg-gray-100 rounded-lg overflow-hidden shadow-lg">
            <video
              ref={localVideoRef}
              autoPlay
              playsInline
              className="w-full h-[350px] object-cover"
            />
            <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 text-xs rounded">
              Local
            </div>
          </div>
          <div className="relative bg-gray-100 rounded-lg overflow-hidden shadow-lg">
            <video
              ref={remoteVideoRef}
              autoPlay
              playsInline
              className="w-full h-[350px] object-cover"
            />
            <div className="absolute top-2 left-2 bg-black bg-opacity-50 text-white px-2 py-1 text-xs rounded">
              Remote
            </div>
          </div>
        </div>
      </main>
      <footer className="p-4 flex justify-center space-x-6">
        <button
          onClick={handleStartCamera}
          className="bg-yellow-500 hover:bg-yellow-600 text-white px-6 py-3 rounded-full shadow-md"
        >
          Start Camera
        </button>
        <button
          onClick={handleLeaveRoom}
          className="bg-red-500 hover:bg-red-600 text-white px-6 py-3 rounded-full shadow-md"
        >
          End Call
        </button>
      </footer>
    </div>
  );
}

export default MeetInterface;
