// src/App.js
import React, { useState, useEffect } from 'react';            // standard React hooks
import EventSource from 'react-native-sse';                    // SSE client for React Native
import { MapContainer, TileLayer } from 'react-leaflet';       // Leaflet map components
import 'leaflet/dist/leaflet.css';                             // default Leaflet CSS
import './App.css';                                            // our app's custom CSS

import TrainMarkers from './TrainMarkers';                     // custom component for train pins
import TrainSchedulePanel from './TrainSchedulePanel';          // custom panel for train schedule listing

function App() {
  const [stationData, setStationData] = useState({});          // holds station info
  const [tripMap, setTripMap] = useState({});                  // object storing current trips
  const [isConnected, setIsConnected] = useState(false);       // SSE connection status

  // New: track last 5 raw SSE messages
  const [rawMessages, setRawMessages] = useState([]);
  // Toggle for the “Raw Feed” box
  const [showRawFeed, setShowRawFeed] = useState(false);

  // 1) Load station data from backend
  useEffect(() => {
    fetch("http://localhost:8000/stations")
      .then(res => res.json())
      .then(data => {
        setStationData(data);
        console.log("Loaded station data with", Object.keys(data).length, "entries");
      })
      .catch(err => console.error("Failed to load station data:", err));
  }, []);
  // ^ runs once on mount, fetches station data from backend

  // 2) Connect SSE for real-time train updates
  useEffect(() => {
    const sse = new EventSource("http://localhost:8000/train-stream");
    // connect to that SSE endpoint

    sse.addEventListener("open", () => {
      setIsConnected(true);
      console.log("SSE connected");
    });
    // ^ triggers when SSE is up

    sse.addEventListener("message", (e) => {
      // each new SSE message is an MTA trip update
      try {
        const dataStr = e.data;      // raw JSON string
        const evt = JSON.parse(dataStr);
        // parse the JSON so we can use it

        // Update rawMessages (keep only last 5 messages)
        setRawMessages(prev => {
          const next = [dataStr, ...prev];
          return next.slice(0, 5);
        });

        // If the msg has a trip_id, store it in our tripMap
        if (evt.trip_id) {
          setTripMap(prev => {
            const copy = { ...prev };
            copy[evt.trip_id] = {
              ...copy[evt.trip_id],
              ...evt
            };
            return copy;
          });
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    });

    sse.addEventListener("error", () => {
      setIsConnected(false);
      console.log("SSE error");
    });

    // cleanup if component unmounts
    return () => sse.close();
  }, []);

  // Convert tripMap object to an array for easier iteration
  const tripsArray = Object.values(tripMap);

  // toggles our “Raw Feed” box
  const handleToggleRawFeed = () => {
    setShowRawFeed(prev => !prev);
  };

  return (
    <div className="App">
      <header>
        <h1>NYC Subway Tracker</h1>
        <div className="status-bar">
          <div className="connection-status">
            Redpanda: {isConnected ? "Connected ✅" : "Disconnected ❌"}
          </div>
          {/* “?” (plus) button to toggle raw feed panel */}
          <button className="info-btn" onClick={handleToggleRawFeed}>+</button>
        </div>
      </header>

      {/* The small raw feed panel, only if showRawFeed is true */}
      {showRawFeed && (
        <div className="raw-feed-box">
          <h4> topic consume mta-feed (last 5 msgs)</h4>
          <div className="feed-lines">
            {rawMessages.map((msg, idx) => (
              <div key={idx} className="feed-line">{msg}</div>
            ))}
          </div>
        </div>
      )}

      <div className="map-container">
        {/* Leaflet map centered on Manhattan-ish coords */}
        <MapContainer center={[40.75, -73.99]} zoom={12} style={{ height: "600px", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <TrainMarkers tripsArray={tripsArray} stationData={stationData} />
          {/* Markers for trains rendered here */}
        </MapContainer>
      </div>

      <TrainSchedulePanel tripsArray={tripsArray} stationData={stationData} />
      {/* Panel listing trains by route */}
    </div>
  );
}

export default App;
