// src/TrainMarkers.js
import React, { useState, useEffect } from 'react';
import { Marker, Popup } from 'react-leaflet';
import L from 'leaflet'; // Leaflet for custom icons, etc.

/**
 * Full route color map:
 * (Sourced from MTA or approximations for each line)
 */
function getRouteColor(routeId) {
  // pick color for each route
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
    "S": "#808183",   
    "GS": "#808183",  

    // A, C, E (blue)
    "A": "#2850AD",
    "C": "#2850AD",
    "E": "#2850AD",
    "SR": "#808183",  

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

    // SI (Staten Island)
    "SI": "#A7A9AC"
  };
  return colorMap[routeId] || "#000000";
}

function getTrainIcon(routeId) {
  // builds a custom Leaflet divIcon with route color + label
  const color = getRouteColor(routeId);
  return L.divIcon({
    className: "train-icon",
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
    iconSize: [24, 24]
  });
}

function getStationName(stopId, stationData) {
  // get station's full name from ID
  if (!stopId) return "";
  const st = stationData[stopId];
  return st ? st.name : stopId;
}

// Format timestamp to short date/time
function formatTimestamp(ts) {
  if (!ts) return "";
  const d = new Date(ts * 1000);
  return d.toLocaleString([], {
    dateStyle: "short",
    timeStyle: "short"
  });
}

/**
 * We do a simple position approach:
 * - next_stop_id is typically empty in the new code, so we rarely do midpoint
 * - if both current_stop_id & next_stop_id exist, we do midpoint
 */
function computeTargetPos(trip, stationData, oldPos) {
  const c = stationData[trip.current_stop_id];
  const n = stationData[trip.next_stop_id];
  if (c && n && trip.current_stop_id !== trip.next_stop_id) {
    // average lat/lon for midpoint
    const lat = (c.lat + n.lat) / 2;
    const lon = (c.lon + n.lon) / 2;
    return [lat, lon];
  }
  if (c) return [c.lat, c.lon];
  if (n) return [n.lat, n.lon];
  // if no coords, fallback to old position or default
  return oldPos || [40.75, -73.99];
}

export default function TrainMarkers({ tripsArray, stationData }) {
  const [tripPositions, setTripPositions] = useState({});
  // store each trip's current + target pos

  useEffect(() => {
    // whenever tripsArray changes, recalc the target positions
    setTripPositions(prev => {
      const copy = { ...prev };
      tripsArray.forEach(t => {
        if (!t.trip_id) return;
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
  }, [tripsArray, stationData]);

  useEffect(() => {
    // animate the markers by slowly moving them from pos -> targetPos
    const interval = setInterval(() => {
      setTripPositions(prev => {
        const copy = { ...prev };
        Object.keys(copy).forEach(trip_id => {
          const item = copy[trip_id];
          if (!item.pos || !item.targetPos) return;
          const [lat, lng] = item.pos;
          const [tlat, tlng] = item.targetPos;
          const dist = Math.sqrt((tlat - lat)**2 + (tlng - lng)**2);
          // if close enough, just jump to target
          if (dist < 0.00001) {
            copy[trip_id] = { ...item, pos: item.targetPos };
          } else {
            // otherwise move 10% closer
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
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <>
      {Object.keys(tripPositions).map(trip_id => {
        const t = tripPositions[trip_id];
        if (!t.pos) return null;

        const icon = getTrainIcon(t.route_id);
        const stationName = getStationName(t.current_stop_id, stationData);
        const nextStopName = t.next_stop_id ? getStationName(t.next_stop_id, stationData) : "";
        const timeStr = formatTimestamp(t.timestamp);

        // build the popup
        let atHeadingLine = "";
        if (stationName) {
          atHeadingLine = `<strong>At/Heading to:</strong> ${stationName}<br/>`;
        }

        const nextStopLine = t.next_stop_id
          ? `<strong>Next Stop:</strong> ${nextStopName}<br/>`
          : "";

        const directionLine = t.direction
          ? `<strong>Direction:</strong> ${t.direction}<br/>`
          : "";

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
              <div dangerouslySetInnerHTML={{ __html: popupHtml }} />
            </Popup>
          </Marker>
        );
      })}
    </>
  );
}
