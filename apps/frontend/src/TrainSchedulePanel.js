import React, { useState } from 'react'; // pull in React and useState hook

function formatTime(ts) {
  // function to format Unix seconds -> short local date/time
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function getStationName(stopId, stationData) {
  // tries to get station name from our dictionary
  if (!stopId) return "";
  const st = stationData[stopId];
  return st ? st.name : stopId;
}

function getRouteColor(route) {
  // basic color map for each route ID
  const colorMap = {
    "1": "#EE352E",
    "2": "#EE352E",
    "3": "#EE352E",
    "4": "#00933C",
    "5": "#00933C",
    "6": "#00933C",
    "6X": "#00933C",
    "7": "#B933AD",
    "7X": "#B933AD",
    "S": "#808183",
    "GS": "#808183",

    "A": "#2850AD",
    "C": "#2850AD",
    "E": "#2850AD",
    "SR": "#808183",

    "G": "#6CBE45",

    "N": "#FCCC0A",
    "Q": "#FCCC0A",
    "R": "#FCCC0A",
    "W": "#FCCC0A",

    "B": "#FF6319",
    "D": "#FF6319",
    "F": "#FF6319",
    "M": "#FF6319",
    "SF": "#FF6319",

    "J": "#996633",
    "Z": "#996633",

    "L": "#A7A9AC",

    "SI": "#A7A9AC"
  };
  return colorMap[route] || "#333333"; // default if not found
}

export default function TrainSchedulePanel({ tripsArray, stationData }) {
  // grouping trains by route
  const routeMap = {}; // route -> array of trains
  tripsArray.forEach(trip => {
    const r = trip.route_id || "??"; // fallback label if no route
    if (!routeMap[r]) routeMap[r] = [];
    routeMap[r].push(trip);
  });

  const [expanded, setExpanded] = useState({}); // track which routes are open
  const toggle = (r) => {
    // flip open/closed for a route
    setExpanded(prev => ({ ...prev, [r]: !prev[r] }));
  };

  const sortedRoutes = Object.keys(routeMap).sort(); // sort route IDs for stable order

  return (
    <div className="schedule-panel">
      <h2>Train Schedules</h2>
      {sortedRoutes.map(route => {
        const color = getRouteColor(route); // pick a color for that route
        const trains = routeMap[route]; // all trains for this route
        const isOpen = expanded[route] || false; // is it expanded?

        return (
          <div
            key={route}
            style={{
              backgroundColor: color,
              color: "#ffffff",
              padding: "0.5rem",
              borderRadius: "4px",
              marginBottom: "1rem"
            }}
          >
            <div
              style={{ cursor: "pointer" }}
              onClick={() => toggle(route)}
            >
              <strong>Route {route}</strong> ({trains.length} trains)
              <span style={{ marginLeft: "1rem" }}>{isOpen ? "[-]" : "[+]"}</span>
            </div>
            {isOpen && (
              <div style={{ marginTop: "0.5rem" }}>
                {trains.map(t => (
                  <TripItem
                    key={t.trip_id}
                    trip={t}
                    stationData={stationData}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function TripItem({ trip, stationData }) {
  // single train item
  const stationName = getStationName(trip.current_stop_id, stationData);
  const nextName = trip.next_stop_id ? getStationName(trip.next_stop_id, stationData) : "";
  const timeStr = formatTime(trip.timestamp);

  // "At/Heading to" line if we have a station
  let atHeadingLine = null;
  if (stationName) {
    atHeadingLine = (
      <div>
        <strong>At/Heading to:</strong> {stationName}
      </div>
    );
  }

  // only show next stop if next_stop_id exists
  const nextStopLine = trip.next_stop_id
    ? (
      <div>
        <strong>Next Stop:</strong> {nextName}
      </div>
    ) : null;

  return (
    <div
      style={{
        backgroundColor: "#f9f9f9",
        color: "#000000",
        marginBottom: "0.5rem",
        borderRadius: "4px",
        padding: "0.5rem"
      }}
    >
      <div>
        <strong>Trip ID:</strong> {trip.trip_id}
      </div>
      {trip.direction && (
        <div>
          <strong>Direction:</strong> {trip.direction}
        </div>
      )}

      {atHeadingLine}
      {nextStopLine}

      <div style={{ marginTop: "0.5rem" }}>
        <strong>Timestamp:</strong> {timeStr}
      </div>
    </div>
  );
}
