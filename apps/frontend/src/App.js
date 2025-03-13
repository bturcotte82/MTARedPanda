import React, { useState, useEffect } from 'react'; // import React, plus some hooks
import EventSource from 'react-native-sse'; // SSE library for iOS/Android but also works in web env
import { MapContainer, TileLayer } from 'react-leaflet'; // Leaflet components
import 'leaflet/dist/leaflet.css'; // Leaflet default styles
import './App.css'; // our custom styles

import TrainMarkers from './TrainMarkers'; // component that shows the moving train markers
import TrainSchedulePanel from './TrainSchedulePanel'; // component that shows the route-based list

function App() { // our main React component
  const [stationData, setStationData] = useState({}); // hold all station info from backend
  const [tripMap, setTripMap] = useState({}); // store events keyed by trip_id
  const [isConnected, setIsConnected] = useState(false); // track if SSE is open

  const [rawMessages, setRawMessages] = useState([]); // keep last 5 raw SSE lines
  const [showRawFeed, setShowRawFeed] = useState(false); // toggle for the debug feed panel

  // 1) Load station data
  useEffect(() => { // run once on mount
    fetch("http://localhost:8000/stations") // call backend route
      .then(res => res.json()) // parse response as JSON
      .then(data => {
        setStationData(data); // store station data
        console.log("Loaded station data with", Object.keys(data).length, "entries");
      })
      .catch(err => console.error("Failed to load station data:", err));
  }, []); // empty deps => runs once

  // 2) Connect SSE
  useEffect(() => { // set up SSE on mount
    const sse = new EventSource("http://localhost:8000/train-stream"); // connect to server SSE route
    sse.addEventListener("open", () => { // when SSE opens
      setIsConnected(true); // mark connected
      console.log("SSE connected");
    });
    sse.addEventListener("message", (e) => { // every time we get a new event
      try {
        const dataStr = e.data; // raw string from SSE
        const evt = JSON.parse(dataStr); // parse to object

        // store the raw message in "rawMessages", only keep 5
        setRawMessages(prev => {
          const next = [dataStr, ...prev];
          return next.slice(0, 5); // limit to 5 items
        });

        // if it has a trip_id, we add/merge into tripMap
        if (evt.trip_id) {
          setTripMap(prev => {
            const copy = { ...prev };
            copy[evt.trip_id] = {
              ...copy[evt.trip_id],
              ...evt
            };
            return copy; // return updated map
          });
        }
      } catch (err) {
        console.error("SSE parse error:", err);
      }
    });
    sse.addEventListener("error", () => { // if SSE hits an error
      setIsConnected(false); // mark disconnected
      console.log("SSE error");
    });

    return () => sse.close(); // cleanup on unmount
  }, []); // empty deps => runs once

  const tripsArray = Object.values(tripMap); // convert map to array for easier iteration

  const handleToggleRawFeed = () => { // toggles the raw SSE feed panel
    setShowRawFeed(prev => !prev);
  };

  return (
    <div className="App"> {/* main wrapper */}
      <header>
        <h1>NYC Subway Tracker</h1>
        <div className="status-bar"> {/* container for status + button */}
          <div className="connection-status">
            Redpanda: {isConnected ? "Connected ✅" : "Disconnected ❌"} {/* SSE state */}
          </div>
          <button className="info-btn" onClick={handleToggleRawFeed}>+</button> {/* toggle debug feed */}
        </div>
      </header>

      {/* show raw feed if user toggles */}
      {showRawFeed && (
        <div className="raw-feed-box">
          <h4> topic consume mta-feed (last 5 msgs)</h4>
          <div className="feed-lines">
            {rawMessages.map((msg, idx) => (
              <div key={idx} className="feed-line">{msg}</div> // each raw JSON line
            ))}
          </div>
        </div>
      )}

      <div className="map-container"> {/* container for leaflet map */}
        <MapContainer center={[40.75, -73.99]} zoom={12} style={{ height: "600px", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://osm.org/copyright">OpenStreetMap</a>'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <TrainMarkers tripsArray={tripsArray} stationData={stationData} /> {/* all trains */}
        </MapContainer>
      </div>

      <TrainSchedulePanel tripsArray={tripsArray} stationData={stationData} /> {/* route-based listing */}
    </div>
  );
}

export default App; // export the main component
