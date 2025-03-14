1\. Introduction
----------------

You've probably heard a million times that Redpanda is this "Kafka API-compatible" streaming engine that's faster, simpler, and doesn't require a dedicated team just to keep it from crashing. But if you've ever tried to set up a new streaming project in Kafka, you know the hassle: ZooKeeper. Tuning a small galaxy of server.properties. Figuring out broker counts and hoping half your cluster doesn't spontaneously combust.

Redpanda promises 10x lower latencies, 3-6x cost efficiency, and at least 3x fewer brokers needed to get the same throughput. That's nice in theory, but what does it look like when you actually build an app? Enter this NYC Subway Real-Time Tracker, a somewhat masochistic attempt to watch trains in real time.

Here's the spoiler:

-   We fetch live MTA data (eight separate GTFS feeds).

-   We publish them to Redpanda.

-   The front end---built in React---consumes them via Server-Sent Events (SSE).

-   We visualize train locations on a map.

All the code is basically the same we'd have used with Kafka, but we quietly swapped in Redpanda's bootstrap servers. No Zookeeper, no additional complexity. Let's break it down in obscene detail so you can see what's going on.

* * * * *

2\. Why Redpanda Instead of Kafka or Pulsar?
--------------------------------------------

### Kafka

If you're reading this, you likely know Kafka. It's the big dog in streaming, used by everyone from Fortune 50 to the random dev building a side project. But it can be heavy for smaller or mid-size teams. If you want quick local dev cycles or a simpler operational overhead, Kafka's multi-node architecture, plus ZooKeeper, can feel like you're setting up a second job.

### Pulsar

Pulsar is another alternative---supported by Apache, with some interesting features like tiered storage. But if you're already knee-deep in Kafka's tooling and want the same APIs, it can be a bigger jump to Pulsar's new concepts (tenants, namespaces, topics). It's definitely a valid streaming choice, but its different APIs might require more code rewriting.

### Redpanda

Redpanda is a single binary, no ZooKeeper, fully Kafka API-compatible engine, written in modern C++. It targets extremely low latencies while reducing your cluster size. That means you can just point your existing Kafka client code at Redpanda's broker addresses and see immediate performance and operational benefits. No major rewrites. No new mental overhead. No second job.

In short:

-   Kafka is powerful but can be overkill or complex to manage.

-   Pulsar is interesting, but a bigger leap from Kafka's architecture and APIs.

-   Redpanda is effectively Kafka without the Kafka baggage.

* * * * *

3\. High-Level Architecture
---------------------------

Below is a simplified diagram of our architecture. (Yes, it's simplified, because MTA's GTFS feeds are already complicated enough.)

sql

Copy

+------------------+      Produce       +------------------+

 |  MTA GTFS Feeds  |  1)  ----------->  |  Redpanda Topic  |

 | (8 Endpoints)    |                   |   "mta-feed"      |

 +------------------+                   +-------------------+

              |                                     |

              |                                     |

    2) Fetch & Parse                           3) Consume

              |                                     |

       +---------------+         SSE        +------------------+

       | Flask Backend |  <---------------  |  React Frontend  |

       | (app.py)      |  4) event-stream   |  (Leaflet Map)   |

       +---------------+                   +------------------+

1.  We pull train updates from eight separate MTA GTFS endpoints.

2.  We parse them in Python, transform them into a consistent JSON structure, and produce them to our Redpanda topic named mta-feed.

3.  We have a Flask endpoint that acts as a consumer from the same mta-feed topic. This consumer feeds data out to the front end in a real-time stream (SSE).

4.  The React app visualizes all that data on a live map.

That's the gist. Let's get deeper.

* * * * *

4\. Backend Walkthrough (Flask + Python + Redpanda)
---------------------------------------------------

### 4.1. Configuration and Setup

The backend is a simple Flask app. We rely on flask_cors for CORS handling (so our React app can talk to it), plus the standard Python requests library to pull data from MTA. We also import the official Kafka libraries for Python, which we simply repurpose to talk to Redpanda.

Key config snippet (Python):

''' BOOTSTRAP_SERVERS = "cv7j8ci9anc1h5oh9sa0.any.us-east-1.mpx.prd.cloud.redpanda.com:9092"

TOPIC_NAME = "mta-feed"

producer = KafkaProducer(

    bootstrap_servers=BOOTSTRAP_SERVERS,

    security_protocol="SASL_SSL",

    sasl_mechanism="SCRAM-SHA-256",

    sasl_plain_username="YOUR_USERNAME",

    sasl_plain_password="YOUR_PASSWORD",

    value_serializer=lambda v: json.dumps(v).encode("utf-8")

) '''

Observations:

-   We're literally using KafkaProducer from the Python kafka-python library. No changes other than pointing to the Redpanda cluster.

-   SASL/SSL is required for auth. We just pass in the correct credentials for Redpanda.

-   Because Redpanda is Kafka-API compatible, we do not need any new library.

### 4.2. Fetching MTA GTFS Feeds

We're pulling from eight different MTA endpoints to cover basically all NYC subway lines. Each feed is a protobuf (gtfs_realtime_pb2.FeedMessage), so we parse that, extract relevant trip updates, and throw them into a list.

Key logic (Python):

''' def fetch_all_feeds():

    global last_fetched_trips

    all_trips = []

    for feed_url in MTA_FEEDS:

        try:

            resp = requests.get(feed_url, headers=HEADERS, timeout=10)

            # ... error checks ...

            feed = gtfs_realtime_pb2.FeedMessage()

            feed.ParseFromString(resp.content)

            for entity in feed.entity:

                if not entity.trip_update and not entity.vehicle:

                    continue

                # Extract trip_id, route_id, current_stop_id, etc.

                # Filter out unknown routes

                # Build the record

                all_trips.append(rec)

        except Exception as e:

            # Handle error

    # Produce everything to Redpanda

    for td in all_trips:

        producer.send(TOPIC_NAME, value=td)

    producer.flush()

    last_fetched_trips = all_trips

    print(f"[INFO] Produced {len(all_trips)} trip updates total") '''


We schedule this function to run every few seconds using the schedule library. This ensures near real-time updates. Because MTA data can update frequently, we want a constant flow into Redpanda.

### 4.3. Producers: Publishing Trip Updates to Redpanda

As shown above, each trip record is just a Python dictionary:

'''

{

  "trip_id": trip_id,

  "route_id": route_id,

  "current_stop_id": current_stop_id,

  "next_stop_id": next_stop_id,

  "direction": direction,

  "timestamp": ...

}

'''

We produce that dictionary directly with:


''' producer.send(TOPIC_NAME, value=td) '''

Thanks to our value_serializer, it's automatically JSON-encoded and published. Notice we don't have any separate "schema registry," nor do we jump through Avro hoops here. We're keeping it straightforward. If you need or prefer Avro (or Protobuf, ironically), you can do that too.

### 4.4. Consumers: The SSE Endpoint

We also have a neat Flask endpoint /train-stream that uses a server-sent events (SSE) approach. On each client request, we spin up a new KafkaConsumer with a random group ID:

'''

consumer = KafkaConsumer(

    TOPIC_NAME,

    bootstrap_servers=BOOTSTRAP_SERVERS,

    security_protocol="SASL_SSL",

    sasl_mechanism="SCRAM-SHA-256",

    # ...

    group_id=f"mta-group-{uuid.uuid4()}",

    value_deserializer=lambda m: json.loads(m.decode("utf-8"))

)
'''

Then we:

'''

for msg in consumer:

    yield f"data: {json.dumps(msg.value)}\n\n"

'''

That's SSE in a nutshell: we yield each message with the data: prefix, and the front end is set up to handle message events. This is simpler than messing with WebSockets or some heavier real-time library. If SSE is "so 2015," it's because it works great for 95% of these streaming UI scenarios.

Why a random group ID?\
So each new connection starts reading from the "latest" offset. If we used one fixed group, new consumers would share offset commits. That might mean a new consumer wouldn't see messages if an old consumer was already committing them. By using a random ID, each consumer effectively gets its own ephemeral subscription to the topic.

### 4.5. Stations CSV Data

We also have a small stations.csv that we load to map stop_id -> station name, lat, lon. This is optional but nice for giving us more user-friendly station names rather than cryptic IDs. The CSV is in the format:

'''

stop_id,stop_name,stop_lat,stop_lon

101,Van Cortlandt Park - 242 St,40.7302,-74.00

...

This data is pulled into the Flask app with:

python

Copy

def load_station_data():

    # Read stations.csv, store in a dict station_data[stop_id] = {...}

'''

We can then look up station details in the front end or back end as needed.

* * * * *

5\. Frontend Walkthrough (React, Leaflet, SSE)
----------------------------------------------

### 5.1. Data Flow

On the React side:

1.  The app loads station data with a quick REST call (/stations).

2.  It connects to our SSE endpoint (/train-stream).

3.  Every message from SSE is a JSON string containing the most recent trip updates.

4.  We store them in a local state (tripMap) keyed by trip_id.

5.  We display them on a Leaflet map as moving markers.

6.  We also show them in a collapsible schedule panel.

### 5.2. Connecting to the SSE Stream

In App.js, we do this:

'''

useEffect(() => {

  const sse = new EventSource("http://localhost:8000/train-stream");

  sse.addEventListener("open", () => {

    setIsConnected(true);

  });

  sse.addEventListener("message", (e) => {

    try {

      const dataStr = e.data;

      const evt = JSON.parse(dataStr);

      // Update raw messages + tripMap

    } catch (err) {

      console.error("SSE parse error:", err);

    }

  });

  sse.addEventListener("error", () => {

    setIsConnected(false);

  });

  return () => sse.close();

}, []);

'''

This is the entire real-time connection logic on the front end. No custom library, no special subscription logic. SSE is just a standard browser feature. The big advantage is that it's an easy one-liner on the server (yield messages) and an easy setup on the client (EventSource).

### 5.3. Displaying Trains in Real Time

We then pass the aggregated list of trips (tripMap) to our map. We rely on Leaflet to do the heavy lifting for mapping. Each trip is pinned to a location derived from current_stop_id and optionally next_stop_id. Because the MTA feed includes a vehicle location that references a stop_id, we only have station-based locations. We do a small trick: if we have both a current stop and a next stop, we place the train's marker in the midpoint between them. That's the best we can do with limited data. (If you had continuous lat/lon for each train, you could display it more accurately.)

### 5.4. TrainMarkers.js

Here's the logic that actually positions the markers:

'''

function computeTargetPos(trip, stationData, oldPos) {

  const c = stationData[trip.current_stop_id];

  const n = stationData[trip.next_stop_id];

  // If both stops exist, use midpoint

  if (c && n && trip.current_stop_id !== trip.next_stop_id) {

    return [(c.lat + n.lat)/2, (c.lon + n.lon)/2];

  }

  if (c) return [c.lat, c.lon];

  if (n) return [n.lat, n.lon];

  return oldPos || [40.75, -73.99]; // fallback

}

'''

Then we do a slight interpolation over time (setInterval with a small factor) to show a slow "movement" effect between the old position and the new target. It's not physically accurate, but it looks cooler than having them teleport from station to station.

### 5.5. TrainSchedulePanel.js

For a textual summary, we group the trips by route_id. So for each route (e.g., "A" or "6"), we can show a collapsible panel with all the active trains. That panel will show:

-   Trip ID

-   Direction (Northbound or Southbound)

-   Current Stop

-   Next Stop

-   Timestamp

We color-code the panels by route color, so it's visually consistent with MTA branding. The logic is straightforward:

1.  We sort the trips by route.

2.  We display them.

3.  If you expand the route panel, you see details.

* * * * *

6\. Deep-Dive: Comparing Redpanda, Kafka, and Pulsar
----------------------------------------------------

Here's the million-dollar question: Why is Redpanda so beneficial for this kind of real-time app?

-   Kafka typically requires ZooKeeper for cluster coordination. If you want high availability, you spin up multiple brokers plus multiple ZK nodes. For a personal project or smaller production scenario, you might find yourself either paying for a Kafka SaaS or wrestling with an overly complex cluster.

-   Pulsar relies on BookKeeper for data storage and ZooKeeper for metadata. So you're effectively setting up a multi-component system. If you want to store data durably, that's a few more moving parts. Yes, you can find managed Pulsar offerings, but you also lose out on the direct Kafka API compatibility.

-   Redpanda lumps the entire solution into a single binary, no ZK. You want a 3-node cluster? Great---just spin up three Redpanda processes. You want to test locally? One rpk container start command (Redpanda's CLI) can handle that. If you have existing Kafka code, you basically switch the bootstrap_servers and call it a day.

Performance:

-   Written in C++, Redpanda claims significantly better latencies and throughput than Kafka's Java-based approach. The difference is stark, especially under high concurrency.

-   Because we're doing real-time updates and serving them to a front end, we're extremely sensitive to even slight lags. Redpanda's lower average latency ensures our UI feels snappy.

Resource efficiency:

-   Redpanda requires fewer brokers for the same throughput. In many use cases, if you needed 6 Kafka brokers, you might handle the same load with 2-3 Redpanda brokers. That's not just marketing fluff: it's partly because of the C++ efficiency and the lack of external ZooKeeper.

API:

-   We can use the standard Kafka Python library with no changes. That's huge. Migrating from a Kafka PoC to Redpanda is minimal friction. The same can't be said for switching to Pulsar's API.

* * * * *

7\. What About Scaling, Latency, and Costs?
-------------------------------------------

Scaling:\
If you want more throughput, you add more Redpanda brokers. You can scale up just like you would Kafka---topic partitions, consumer groups, the usual. But you don't have to manage separate ZooKeeper nodes or worry about a mismatch between Kafka brokers and ZK.

Latency:\
Redpanda is optimized for minimal tail latency. In typical scenarios, you might see it performing better than Kafka by a factor, especially when everything's hammered at once. If you're building a project where near-immediate data is important (like real-time dashboards, ML pipelines, or, say, a subway tracker), that's a big advantage.

Costs:\
Fewer nodes, less overhead, simpler architecture. That means you can do more with less. If you're on the hook for your own AWS/GCP bills, that's a direct cost saving. If you're at a big enterprise, that's fewer "holy cow, we need 10 extra brokers" requests to your ops team.

* * * * *

8\. Conclusion & Next Steps
---------------------------

So that's the official, insanely detailed breakdown of our NYC Subway Real-Time Tracker using Redpanda. We:

1.  Spin up a minimal Redpanda cluster (or use a hosted instance).

2.  Fetch MTA's GTFS feeds in Python with Flask.

3.  Produce them to Redpanda with the standard Kafka Python client.

4.  Expose a streaming SSE endpoint for the front end.

5.  Show the data on a Leaflet map in React.

It's Kafka, but simpler. We get the same consumer groups, topics, offsets, etc., but with fewer moving parts and better performance. And that's a big deal for developers who don't want to waste half their time messing with configuration or scaling overhead.

If you're interested in extending the project, here are some ideas:

-   Geo-Position Calculation: The MTA feed sometimes includes raw lat/lon for each vehicle. We could integrate that to show exact train locations instead of stop-based interpolation.

-   Historical Playback: Store the data in Redpanda for a day and build a "replay" feature to see how trains moved over time.

-   Alerts and Notifications: Because Redpanda is real-time, you can add a consumer that triggers push notifications if a train is severely delayed.

In short, if you're sick of feeling like your streaming engine is streaming your free time away, give Redpanda a spin. You might find that all the complexity you assumed was "just part of Kafka" isn't actually necessary. This is the new wave of real-time data, and it's not going anywhere---especially if we can keep those trains on the map for everyone to see.

Happy coding, and good luck tracking those trains!

* * * * *

### Appendix: Example Code Snippets for Quick Reference

Backend

'''
from flask import Flask, Response, jsonify

from kafka import KafkaProducer, KafkaConsumer

# ...

app = Flask(__name__)

producer = KafkaProducer(

    bootstrap_servers="your-redpanda-endpoint:9092",

    security_protocol="SASL_SSL",

    sasl_mechanism="SCRAM-SHA-256",

    sasl_plain_username="...",

    sasl_plain_password="...",

    value_serializer=lambda v: json.dumps(v).encode("utf-8")

)
''' 
1.

Fetching and Producing

''' 
def fetch_all_feeds():

    trips = []

    for feed_url in MTA_FEEDS:

        # Parse the feed

        # ...

        trips.append({

            "trip_id": ...,

            "route_id": ...,

            # ...

        })

    # Produce

    for t in trips:

        producer.send("mta-feed", value=t)

    producer.flush()

'''

Consumer + SSE\

'''

@app.route("/train-stream")

def train_stream():

    def event_stream():

        consumer = KafkaConsumer(

            "mta-feed",

            group_id=f"mta-group-{uuid.uuid4()}",

            bootstrap_servers="your-redpanda-endpoint:9092",

            # ...

        )

        for msg in consumer:

            yield f"data: {json.dumps(msg.value)}\n\n"

    return Response(event_stream(), mimetype="text/event-stream")

'''

'''
useEffect(() => {

  const sse = new EventSource("http://localhost:8000/train-stream");

  sse.onmessage = (e) => {

    const data = JSON.parse(e.data);

    // update state

  };

  return () => sse.close();

}, []);
'''

Leaflet Markers

'''
function TrainMarkers({ tripsArray, stationData }) {

  // ...

  return (

    <>

      {tripsArray.map(trip => (

        <Marker

          key={trip.trip_id}

          position={[lat, lng]}

          icon={getTrainIcon(trip.route_id)}

        >

          <Popup>

            {/* show trip details */}

          </Popup>

        </Marker>

      ))}

    </>

  );

}

'''

* * * * *

That's everything (and then some) you need to demonstrate a thorough technical understanding of this Redpanda-based real-time subway tracker. Hopefully, it's enough detail for even the toughest "but how does that handle X?" interview question. If you manage to do this in Kafka or Pulsar, you'll have a bigger operational stack. With Redpanda, it's a single binary or a single managed cluster---less overhead, more time to do other things (like debugging your code or bemoaning weekend train schedules).

Welcome to the simpler side of real-time streaming. Enjoy!
