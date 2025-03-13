import React, { useState, useEffect } from 'react'; // standard React imports for state & side-effects
import { Marker, Popup } from 'react-leaflet'; // Leaflet components for markers & popups
import L from 'leaflet'; // main Leaflet lib for icons, etc.

/**
 * Full route color map:
 * (Sourced from MTA or approximations for each line)
 */
function getRouteColor(routeId) {
  // dictionary mapping route -> color hex
  const colorMap = {
    // 1-7 lines
    "1": "#EE352E",
    "2": "#EE352E",
    "3": "#EE352E",
    "4": "#00933C",
    "5": "#00933C",
    "6": "#00933C",
    "6X": "#00933C",
    "7": "#B933AD",
    "7X": "#B933AD",
    "S": "#808183",   // shuttles, etc.
    "GS": "#808183",  // grand central shuttle

    // A, C, E (blue)
    "A": "#2850AD",
    "C": "#2850AD",
    "E": "#2850AD",
    "SR": "#808183",  // 42 St shuttle?

    // G (light green)
    "G": "#6CBE45",

    // N, Q, R, W (yellow)
    "N": "#FCCC0A",
    "Q": "#FCCC0A",
    "R": "#FCCC0A",
    "W": "#FCCC0A",

    // B, D, F, M, SF (orange)
    "B": "#FF6319",
    "D": "#FF6319",
    "F": "#FF6319",
    "M": "#FF6319",
    "SF": "#FF6319",

    // J, Z (brown)
    "J": "#996633",
    "Z": "#996633",

    // L (gray or silver)
    "L": "#A7A9AC",

    // Staten Island (SI) often #A7A9AC or #0039A6
    "SI": "#A7A9AC"
  };
  return colorMap[routeId] || "#000000"; // fallback to black if unknown
}

function getTrainIcon(routeId) {
  // pick the color from above method
  const color = getRouteColor(routeId);
  // return a custom Leaflet icon with that color
  return L.divIcon({
    className: "train-icon", // for CSS
    html: `
      <div style="
        background-color: ${color};
        width: 24px;
        height: 24px;
        border-radius: 50%;
        display: flex;
        align-items: center;
        justify-content: center;
        font-size: 12px;
        color: #ffffff;
      ">
        ${routeId}
      </div>
    `,
    iconSize: [24, 24] // size of that div
  });
}

function getStationName(stopId, stationData) {
  // returns station's name if we have it, else fallback
  if (!stopId) return "";
  const st = stationData[stopId];
  return st ? st.name : stopId;
}

// Format timestamp to short date/time
function formatTimestamp(ts) {
  // if no timestamp, just return empty
  if (!ts) return "";
  const d = new Date(ts * 1000); // convert seconds -> ms
  return d.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });
}

/**
 * We do a simple position approach:
 * - next_stop_id is typically empty in the new code, so we rarely do midpoint
 * - if both current_stop_id & next_stop_id are found, we do midpoint
 */
function computeTargetPos(trip, stationData, oldPos) {
  // figure out station coords for current/next
  const c = stationData[trip.current_stop_id];
  const n = stationData[trip.next_stop_id];
  if (c && n && trip.current_stop_id !== trip.next_stop_id) {
    // naive midpoint between the two coords
    const lat = (c.lat + n.lat) / 2;
    const lon = (c.lon + n.lon) / 2;
    return [lat, lon];
  }
  if (c) return [c.lat, c.lon]; // if only c
  if (n) return [n.lat, n.lon]; // if only n
  return oldPos || [40.75, -73.99]; // fallback
}

export default function TrainMarkers({ tripsArray, stationData }) {
  // track each trip's positions in a local dictionary
  const [tripPositions, setTripPositions] = useState({});

  useEffect(() => {
    // whenever tripsArray or stationData changes, recalc target pos
    setTripPositions(prev => {
      const copy = { ...prev };
      tripsArray.forEach(t => {
        if (!t.trip_id) return; // skip if no ID
        const existing = copy[t.trip_id] || { pos: null, targetPos: null };
        const newTarget = computeTargetPos(t, stationData, existing.pos);
        copy[t.trip_id] = {
          ...existing,
          ...t,
          targetPos: newTarget,
          pos: existing.pos || newTarget
        };
      });
      return copy;
    });
  }, [tripsArray, stationData]); // run whenever these change

  useEffect(() => {
    // set up a timer that updates pos -> targetPos every second
    const interval = setInterval(() => {
      setTripPositions(prev => {
        const copy = { ...prev };
        Object.keys(copy).forEach(trip_id => {
          const item = copy[trip_id];
          if (!item.pos || !item.targetPos) return;
          const [lat, lng] = item.pos;
          const [tlat, tlng] = item.targetPos;
          const dist = Math.sqrt((tlat - lat)**2 + (tlng - lng)**2);
          if (dist < 0.00001) {
            // basically already there
            copy[trip_id] = { ...item, pos: item.targetPos };
          } else {
            // move 10% closer each tick
            const factor = 0.1;
            copy[trip_id] = {
              ...item,
              pos: [
                lat + factor*(tlat - lat),
                lng + factor*(tlng - lng)
              ]
            };
          }
        });
        return copy;
      });
    }, 1000); // 1-second interval

    return () => clearInterval(interval); // cleanup
  }, []);

  return (
    <>
      {Object.keys(tripPositions).map(trip_id => {
        const t = tripPositions[trip_id];
        if (!t.pos) return null; // skip if no position

        const icon = getTrainIcon(t.route_id); // get icon for route
        const stationName = getStationName(t.current_stop_id, stationData);
        const nextStopName = t.next_stop_id ? getStationName(t.next_stop_id, stationData) : "";
        const timeStr = formatTimestamp(t.timestamp);

        // "At/Heading to: X" only if stationName is not empty
        let atHeadingLine = "";
        if (stationName) {
          atHeadingLine = `<strong>At/Heading to:</strong> ${stationName}<br/>`;
        }

        // "Next Stop" only if next_stop_id is present
        const nextStopLine = t.next_stop_id
          ? `<strong>Next Stop:</strong> ${nextStopName}<br/>`
          : "";

        // "Direction" if present
        const directionLine = t.direction
          ? `<strong>Direction:</strong> ${t.direction}<br/>`
          : "";

        // building popup HTML
        const popupHtml = `
          <div>
            <strong>Trip ID:</strong> ${t.trip_id}<br/>
            <strong>Route:</strong> ${t.route_id}<br/>
            ${directionLine}
            ${atHeadingLine}
            ${nextStopLine}
            <strong>Timestamp:</strong> ${timeStr}
          </div>
        `;

        return (
          <Marker key={trip_id} position={t.pos} icon={icon}>
            <Popup>
              {/* use dangerouslySetInnerHTML so we can do <br/>, <strong> in the HTML */}
              <div dangerouslySetInnerHTML={{ __html: popupHtml }} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
