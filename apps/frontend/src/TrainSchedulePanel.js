// src/TrainSchedulePanel.js
import React, { useState } from 'react';

function formatTime(ts) {
  // helper to convert UNIX time to short date/time
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });
}

function getStationName(stopId, stationData) {
  // looks up station name by ID
  if (!stopId) return "";
  const st = stationData[stopId];
  return st ? st.name : stopId;
}

function getRouteColor(route) {
  // returns a color for each route line
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
  return colorMap[route] || "#333333";
}

export default function TrainSchedulePanel({ tripsArray, stationData }) {
  // We'll group trains by route
  const routeMap = {};
  tripsArray.forEach(trip => {
    const r = trip.route_id || "??";
    if (!routeMap[r]) routeMap[r] = [];
    routeMap[r].push(trip);
  });

  // keep track of which routes are "expanded"
  const [expanded, setExpanded] = useState({});
  const toggle = (r) => {
    setExpanded(prev => ({ ...prev, [r]: !prev[r] }));
  };

  // sort route keys so they appear in alphabetical order
  const sortedRoutes = Object.keys(routeMap).sort();

  return (
    <div className="schedule-panel">
      <h2>Train Schedules</h2>
      {sortedRoutes.map(route => {
        const color = getRouteColor(route);
        const trains = routeMap[route];
        const isOpen = expanded[route] || false;

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
  // a small sub-component to display a single trip
  const stationName = getStationName(trip.current_stop_id, stationData);
  const nextName = trip.next_stop_id ? getStationName(trip.next_stop_id, stationData) : "";
  const timeStr = formatTime(trip.timestamp);

  // "At/Heading to"
  let atHeadingLine = null;
  if (stationName) {
    atHeadingLine = (
      <div>
        <strong>At/Heading to:</strong> {stationName}
      </div>
    );
  }

  // Next stop only if next_stop_id is not empty
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
