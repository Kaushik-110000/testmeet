import React, { useState, useRef, useEffect } from 'react';
import io from 'socket.io-client';
import * as mediasoupClient from 'mediasoup-client';

// Create a socket connection to your backend server.
const socket = io('http://localhost:5000');

function MeetInterface() {
  const [roomId, setRoomId] = useState("");
  const [currentRoom, setCurrentRoom] = useState(null);
  const [device, setDevice] = useState(null);
  const [producerTransport, setProducerTransport] = useState(null);
  const [consumerTransport, setConsumerTransport] = useState(null);
  const [localStream, setLocalStream] = useState(null);

  const localVideoRef = useRef(null);
  const remoteVideoRef = useRef(null);

  // Function to join a room (whether creating or joining)
  const joinRoom = (room) => {
    socket.emit('joinRoom', { roomId: room });
    setCurrentRoom(room);
  };

  // Called when creating a room
  const handleCreateRoom = () => {
    console.log("Creating room...");
    // For demo purposes, we use a fixed room id.
    const newRoom = "DemoRoom123";
    joinRoom(newRoom);
  };

  // Called when joining a room by its id
  const handleJoinRoom = () => {
    console.log("Joining room with ID:", roomId);
    joinRoom(roomId);
  };

  // Called when leaving a room.
  const handleLeaveRoom = () => {
    console.log("Leaving room...");
    setCurrentRoom(null);
    // Stop local media if active.
    if (localStream) {
      localStream.getTracks().forEach(track => track.stop());
      setLocalStream(null);
    }
    // Optionally, inform the server of leaving.
  };

  // Start the camera and produce media via the producer transport.
  const handleStartCamera = async () => {
    try {
      // Capture local video and audio.
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: true });
      setLocalStream(stream);
      if (localVideoRef.current) {
        localVideoRef.current.srcObject = stream;
      }
      // When a producer transport is ready, produce your video track.
      if (producerTransport && stream.getVideoTracks().length > 0) {
        const videoTrack = stream.getVideoTracks()[0];
        producerTransport.produce({
          track: videoTrack,
          appData: { mediaTag: "video" }
        })
        .then(producer => {
          console.log("Producer created with ID:", producer.id);
        })
        .catch(err => {
          console.error("Error producing video:", err);
        });
      }
    } catch (error) {
      console.error("Error accessing media devices:", error);
    }
  };

  // When the room is joined, listen for Mediasoup server events.
  useEffect(() => {
    if (currentRoom) {
      // Listen for RTP capabilities from the server.
      socket.on('rtpCapabilities', async (routerRtpCapabilities) => {
        console.log('Received RTP capabilities from server:', routerRtpCapabilities);
        try {
          // Initialize the mediasoup-client Device.
          const device = new mediasoupClient.Device();
          await device.load({ routerRtpCapabilities });
          setDevice(device);
          // Create the transport for producing your media.
          createProducerTransport(device);
        } catch (err) {
          console.error("Error loading Mediasoup device:", err);
        }
      });

      // Listen for notifications of new remote producers.
      socket.on('newProducer', ({ producerId, socketId }) => {
        console.log('New remote producer available:', producerId);
        // If consumer transport is not yet created, create one.
        if (!consumerTransport && device) {
          createConsumerTransport(device, producerId);
        } else if (consumerTransport && device) {
          // Or simply consume the new producer.
          consumeMedia(producerId, consumerTransport, device);
        }
      });
    }

    // Clean up the listeners when leaving the room.
    return () => {
      socket.off('rtpCapabilities');
      socket.off('newProducer');
    };
  }, [currentRoom, device, consumerTransport, producerTransport]);

  // Create a transport for sending (producing) media.
  const createProducerTransport = (device) => {
    socket.emit('createWebRtcTransport', { direction: "producer" }, ({ params, error }) => {
      if (error) {
        console.error("Error creating producer transport:", error);
        return;
      }
      // Use the received parameters to create a send transport.
      const transport = device.createSendTransport(params);
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        // Send DTLS parameters to the server to connect the transport.
        socket.emit('connectTransport', { transportId: params.id, dtlsParameters, direction: "producer" }, (response) => {
          if (response.error) {
            errback(response.error);
          } else {
            callback();
          }
        });
      });
      transport.on('produce', ({ kind, rtpParameters, appData }, callback, errback) => {
        // Tell the server to produce this track.
        socket.emit('produce', { kind, rtpParameters, appData }, (response) => {
          if (response.error) {
            errback(response.error);
          } else {
            callback({ id: response.id });
          }
        });
      });
      setProducerTransport(transport);
    });
  };

  // Create a transport for receiving (consuming) remote media.
  const createConsumerTransport = (device, newProducerId) => {
    socket.emit('createWebRtcTransport', { direction: "consumer" }, ({ params, error }) => {
      if (error) {
        console.error("Error creating consumer transport:", error);
        return;
      }
      // Use the received parameters to create a receive transport.
      const transport = device.createRecvTransport(params);
      transport.on('connect', ({ dtlsParameters }, callback, errback) => {
        socket.emit('connectTransport', { transportId: params.id, dtlsParameters, direction: "consumer" }, (response) => {
          if (response.error) {
            errback(response.error);
          } else {
            callback();
          }
        });
      });
      setConsumerTransport(transport);
      // Consume the new producer’s media.
      consumeMedia(newProducerId, transport, device);
    });
  };

  // Consume a remote producer’s media and display it.
  const consumeMedia = (producerId, transport, device) => {
    socket.emit('consume', { producerId, rtpCapabilities: device.rtpCapabilities }, (response) => {
      if (response.error) {
        console.error("Error consuming media:", response.error);
        return;
      }
      const { params } = response;
  
      // Use the transport to consume the track
      const consumer = transport.consume({
        id: params.id,
        producerId: params.producerId,
        kind: params.kind,
        rtpParameters: params.rtpParameters,
      });
  
      console.log("Consumer created:", consumer); // Debugging: Log the consumer object
  
      // Ensure the consumer has a valid track
      if (!consumer.track) {
        console.error("Consumer track is missing!");
        return;
      }
  
      // Create a new MediaStream for the remote video
      const remoteStream = new MediaStream();
      remoteStream.addTrack(consumer.track); // Add the track to the stream
  
      // Display the remote stream in the video element
      if (remoteVideoRef.current) {
        remoteVideoRef.current.srcObject = remoteStream;
      }
    });
  };

  return (
    <div className="min-h-screen bg-gradient-to-r from-blue-800 to-purple-800 flex flex-col">
      {/* Header with room controls */}
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

      {/* Main video display area */}
      <main className="flex-grow flex flex-col items-center justify-center px-4">
        {currentRoom && (
          <div className="mb-4">
            <span className="text-white text-lg">Current Room: </span>
            <span className="text-white font-bold">{currentRoom}</span>
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 w-full max-w-6xl">
          {/* Local Video */}
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
          {/* Remote Video */}
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

      {/* Footer with call controls */}
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
