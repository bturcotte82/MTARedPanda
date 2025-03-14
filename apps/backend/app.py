import os
import time
import json
import threading
import schedule
import requests
import csv
import uuid

from flask import Flask, Response, jsonify
from flask_cors import CORS
from kafka import KafkaProducer, KafkaConsumer
from datetime import datetime, timezone
from google.transit import gtfs_realtime_pb2

app = Flask(__name__)
CORS(app, resources={r"/*": {"origins": "*"}})

################################################
# REDPANDA / KAFKA CONFIG
################################################
BOOTSTRAP_SERVERS = "cv7j8ci9anc1h5oh9sa0.any.us-east-1.mpx.prd.cloud.redpanda.com:9092" 
TOPIC_NAME = "mta-feed"

################################################
# MTA FEEDS: All 8 endpoints for full coverage
################################################
MTA_FEEDS = [
    # 1) Lines A, C, E, SR
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-ace",
    # 2) G
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-g",
    # 3) N, Q, R, W
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-nqrw",
    # 4) B, D, F, M, SF
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-bdfm",
    # 5) J, Z
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-jz",
    # 6) L
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-l",
    # 7) SIR
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs-si",
    # 8) Lines 1,2,3,4,5,6,7,S are the default feed:
    "https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds/nyct%2Fgtfs"
]

################################################
# HEADERS: If you need an API key, add it here
################################################
HEADERS = {
    # "x-api-key": "YOUR_API_KEY_HERE"
}

FETCH_INTERVAL_SECONDS = 5

# Create the Kafka producer with SASL_SSL & SCRAM-SHA-256
producer = KafkaProducer(
    bootstrap_servers=BOOTSTRAP_SERVERS,
    security_protocol="SASL_SSL",
    sasl_mechanism="SCRAM-SHA-256",
    sasl_plain_username="bturcotte",
    sasl_plain_password="9989",
    value_serializer=lambda v: json.dumps(v).encode("utf-8")
)

last_fetched_trips = []

# (Optional) station data
station_data = {}

def load_station_data():
    """
    If you have a 'stations.csv' with columns:
       stop_id, stop_name, stop_lat, stop_lon
    we load it for station lookups.
    """
    csv_path = os.path.join(os.path.dirname(__file__), "stations.csv")
    if not os.path.exists(csv_path):
        print("[WARN] stations.csv not found, skipping station data load.")
        return
    count = 0
    with open(csv_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            sid = row["stop_id"].strip()
            station_data[sid] = {
                "name": row["stop_name"],
                "lat": float(row["stop_lat"]),
                "lon": float(row["stop_lon"])
            }
            count += 1
    print(f"[INFO] Loaded {count} stations from {csv_path}")

################################################
# PARSE DIRECTION FROM TRIP ID
################################################
def parse_direction(trip_id: str):
    """
    If trip_id includes '..N', say Northbound,
    If '..S', say Southbound,
    else None.
    """
    if "..N" in trip_id:
        return "Northbound"
    elif "..S" in trip_id:
        return "Southbound"
    return None

################################################
# ROUTE VALIDATION: We accept all MTA lines here
################################################
VALID_ROUTES = {
    "1","2","3","4","5","6","6X","7","7X","S","GS",
    "A","C","E","SR","G","N","Q","R","W","B","D","F","M","SF","J","Z","L","SI"
}

################################################
# MAIN FETCH LOGIC: For each of the 8 feeds
################################################
def fetch_all_feeds():
    global last_fetched_trips
    all_trips = []

    for feed_url in MTA_FEEDS:
        try:
            resp = requests.get(feed_url, headers=HEADERS, timeout=10)
            if resp.status_code != 200:
                print(f"[ERROR] Feed {feed_url} returned {resp.status_code}")
                continue

            raw = resp.content
            feed = gtfs_realtime_pb2.FeedMessage()
            feed.ParseFromString(raw)

            for entity in feed.entity:
                if not entity.trip_update and not entity.vehicle:
                    continue

                trip_id = ""
                route_id = ""
                current_stop_id = ""
                next_stop_id = ""   # We no longer parse upcoming stops

                if entity.trip_update:
                    trip_id = entity.trip_update.trip.trip_id
                    route_id = entity.trip_update.trip.route_id

                if entity.vehicle:
                    veh = entity.vehicle
                    if not trip_id:
                        trip_id = veh.trip.trip_id
                    if not route_id:
                        route_id = veh.trip.route_id
                    if veh.stop_id:
                        current_stop_id = veh.stop_id

                if not route_id:
                    continue
                # Filter only if route is recognized
                if route_id not in VALID_ROUTES:
                    continue

                direction = parse_direction(trip_id)

                rec = {
                    "trip_id": trip_id,
                    "route_id": route_id,
                    "current_stop_id": current_stop_id,
                    "next_stop_id": next_stop_id,  # remains empty
                    "direction": direction,
                    "timestamp": int(datetime.now(timezone.utc).timestamp())
                }
                all_trips.append(rec)
        except Exception as e:
            print(f"[ERROR] Could not fetch/parse feed {feed_url}: {e}")
            continue

    # Produce everything to Redpanda
    for td in all_trips:
        producer.send(TOPIC_NAME, value=td)
    producer.flush()

    last_fetched_trips = all_trips
    print(f"[INFO] Produced {len(all_trips)} trip updates total at {datetime.now()}")

def schedule_fetch():
    schedule.every(FETCH_INTERVAL_SECONDS).seconds.do(fetch_all_feeds)
    while True:
        schedule.run_pending()
        time.sleep(1)

################################################
# FLASK ROUTES
################################################
@app.route("/latest-trips")
def latest_trips():
    return jsonify(last_fetched_trips), 200

@app.route("/stations")
def get_stations():
    return jsonify(station_data), 200

@app.route("/train-stream")
def train_stream():
    """
    SSE endpoint that consumes from the single 'mta-feed' topic
    in Redpanda, with random group_id, so each new connection
    sees new data.
    """
    def event_stream():
        consumer = KafkaConsumer(
            TOPIC_NAME,
            bootstrap_servers=BOOTSTRAP_SERVERS,
            security_protocol="SASL_SSL",
            sasl_mechanism="SCRAM-SHA-256",
            sasl_plain_username="bturcotte",
            sasl_plain_password="9989",
            auto_offset_reset="latest",
            enable_auto_commit=False,
            group_id=f"mta-group-{uuid.uuid4()}",
            value_deserializer=lambda m: json.loads(m.decode("utf-8"))
        )
        for msg in consumer:
            yield f"data: {json.dumps(msg.value)}\n\n"
    return Response(event_stream(), mimetype="text/event-stream")

if __name__ == "__main__":
    load_station_data()
    threading.Thread(target=schedule_fetch, daemon=True).start()
    app.run(port=8000, debug=True)
