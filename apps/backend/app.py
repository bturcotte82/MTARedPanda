import os  # let us do path/file stuff
import time  # for sleep and timing
import json  # we handle JSON for data
import threading  # for background threads
import schedule  # for scheduling repeated tasks
import requests  # so we can call MTA endpoints
import csv  # parse CSV for station data
import uuid  # generate unique IDs for consumer group
from flask import Flask, Response, jsonify  # basic Flask web methods
from flask_cors import CORS  # handle cross-origin requests
from kafka import KafkaProducer, KafkaConsumer  # produce/consume from Redpanda
from datetime import datetime, timezone  # for timestamps in UTC
from google.transit import gtfs_realtime_pb2  # parse GTFS-RT protobuf

app = Flask(__name__)  # create the Flask app instance
CORS(app, resources={r"/*": {"origins": "*"}})  # allow CORS for all routes

# REDPANDA / KAFKA CONFIG
BOOTSTRAP_SERVERS = "localhost:9092"   # this is our Redpanda broker
TOPIC_NAME = "mta-feed"  # we'll produce/consume from this single topic


# MTA FEEDS: All 8 endpoints for full coverage
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


# HEADERS: If you need an API key, add it here
HEADERS = {
    # "x-api-key": "YOUR_API_KEY_HERE"  # can fill in if required
}

FETCH_INTERVAL_SECONDS = 5  # how often we poll MTA feeds

producer = KafkaProducer(
    bootstrap_servers=BOOTSTRAP_SERVERS,  # point to Redpanda
    value_serializer=lambda v: json.dumps(v).encode("utf-8")  # turn dict to JSON bytes
)

last_fetched_trips = []  # store the last batch of trips we got

# (Optional) station data
station_data = {}  # we can fill this with station lat/lon

def load_station_data():
    """
    If you have a 'stations.csv' with columns:
       stop_id, stop_name, stop_lat, stop_lon
    we load it for station lookups.
    """
    csv_path = os.path.join(os.path.dirname(__file__), "stations.csv")  # figure out full path
    if not os.path.exists(csv_path):  # if no CSV, just warn
        print("[WARN] stations.csv not found, skipping station data load.")
        return
    count = 0  # track how many stations we read
    with open(csv_path, "r", encoding="utf-8") as f:  # open CSV
        reader = csv.DictReader(f)  # read it as dicts
        for row in reader:  # loop each station row
            sid = row["stop_id"].strip()  # the station ID
            station_data[sid] = {
                "name": row["stop_name"],
                "lat": float(row["stop_lat"]),
                "lon": float(row["stop_lon"])
            }
            count += 1  # increment station count
    print(f"[INFO] Loaded {count} stations from {csv_path}")  # done loading


# PARSE DIRECTION FROM TRIP ID
def parse_direction(trip_id: str):
    """
    If trip_id includes '..N', say Northbound,
    If '..S', say Southbound,
    else None.
    """
    if "..N" in trip_id:  # if it has ..N
        return "Northbound"  # say north
    elif "..S" in trip_id:  # if ..S
        return "Southbound"  # say south
    return None  # else no direction


# ROUTE VALIDATION: We accept all MTA lines here
VALID_ROUTES = {
    "1","2","3","4","5","6","6X","7","7X","S","GS",
    "A","C","E","SR","G","N","Q","R","W","B","D","F","M","SF","J","Z","L","SI"
}


# MAIN FETCH LOGIC: For each of the 8 feeds
def fetch_all_feeds():
    global last_fetched_trips  # so we can store them in that global
    all_trips = []  # accumulate everything from all feeds

    for feed_url in MTA_FEEDS:  # loop over each feed
        try:
            resp = requests.get(feed_url, headers=HEADERS, timeout=10)  # call MTA feed
            if resp.status_code != 200:  # if not success
                print(f"[ERROR] Feed {feed_url} returned {resp.status_code}")
                continue

            raw = resp.content  # get raw bytes
            feed = gtfs_realtime_pb2.FeedMessage()  # create a FeedMessage object
            feed.ParseFromString(raw)  # parse the protobuf from raw bytes

            for entity in feed.entity:  # loop each entity in the feed
                if not entity.trip_update and not entity.vehicle:
                    continue  # skip if no trip_update or vehicle data

                trip_id = ""
                route_id = ""
                current_stop_id = ""
                next_stop_id = ""   # We no longer parse upcoming stops

                if entity.trip_update:  # if there's trip_update info
                    trip_id = entity.trip_update.trip.trip_id
                    route_id = entity.trip_update.trip.route_id

                if entity.vehicle:  # if there's vehicle data
                    veh = entity.vehicle
                    if not trip_id:
                        trip_id = veh.trip.trip_id
                    if not route_id:
                        route_id = veh.trip.route_id
                    if veh.stop_id:
                        current_stop_id = veh.stop_id

                if not route_id:
                    continue  # skip if no route

                # Filter only if route is recognized
                if route_id not in VALID_ROUTES:
                    continue

                direction = parse_direction(trip_id)  # figure out N or S

                rec = {
                    "trip_id": trip_id,
                    "route_id": route_id,
                    "current_stop_id": current_stop_id,
                    "next_stop_id": next_stop_id,  # remains empty
                    "direction": direction,
                    "timestamp": int(datetime.now(timezone.utc).timestamp())
                }
                all_trips.append(rec)  # store that in our big list
        except Exception as e:  # handle exceptions
            print(f"[ERROR] Could not fetch/parse feed {feed_url}: {e}")
            continue

    # Produce everything to Redpanda
    for td in all_trips:
        producer.send(TOPIC_NAME, value=td)  # send each rec to the topic
    producer.flush()  # make sure they get delivered

    last_fetched_trips = all_trips  # store in global
    print(f"[INFO] Produced {len(all_trips)} trip updates total at {datetime.now()}")  # log

def schedule_fetch():
    schedule.every(FETCH_INTERVAL_SECONDS).seconds.do(fetch_all_feeds)  # run fetch_all_feeds every 5s
    while True:
        schedule.run_pending()  # do scheduled tasks
        time.sleep(1)  # short sleep


# FLASK ROUTES
@app.route("/latest-trips")
def latest_trips():
    return jsonify(last_fetched_trips), 200  # return the last fetched trips as JSON

@app.route("/stations")
def get_stations():
    return jsonify(station_data), 200  # serve up station data as JSON if loaded

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
            auto_offset_reset="latest",
            enable_auto_commit=False,
            group_id=f"mta-group-{uuid.uuid4()}",
            value_deserializer=lambda m: json.loads(m.decode("utf-8"))
        )
        for msg in consumer:  # forever read messages
            yield f"data: {json.dumps(msg.value)}\n\n"  # SSE format

    return Response(event_stream(), mimetype="text/event-stream")  # return SSE response

if __name__ == "__main__":
    load_station_data()  # load stations if CSV is present
    threading.Thread(target=schedule_fetch, daemon=True).start()  # start the scheduler in a background thread
    app.run(port=8000, debug=True)  # run Flask on port 8000, with debug
