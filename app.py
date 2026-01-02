import os
import time
import json
from urllib.parse import urlencode

import requests
from flask import Flask, redirect, request, session, jsonify, render_template
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)
app.secret_key = os.environ.get("FLASK_SECRET", "dev-secret-change-me")

def _get_oauth_config():
    load_dotenv()
    return {
        "client_id": os.environ.get("OSM_CLIENT_ID", ""),
        "client_secret": os.environ.get("OSM_CLIENT_SECRET", ""),
        "base_url": os.environ.get("BASE_URL", ""),
    }

OSM_OAUTH_AUTHORIZE = "https://www.openstreetmap.org/oauth2/authorize"
OSM_OAUTH_TOKEN = "https://www.openstreetmap.org/oauth2/token"
OSM_API = "https://api.openstreetmap.org/api/0.6"
OVERPASS_APIS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.nchc.org.tw/api/interpreter",
]
MAPBOX_TOKEN = os.environ.get("MAPBOX_TOKEN", "")

REQUIRED_TAGS = ["name", "operator"]
ALLOWED_TAGS = [
    "name",
    "operator",
    "brand",
    "socket:type2",
    "socket:ccs",
    "socket:chademo",
    "fast_charge",
    "fee",
    "charge",
    "payment:app:qr",
    "capacity",
    "charging_station:output",
    "opening_hours",
    "access",
    "amenity",
]


def _require_auth():
    token = session.get("osm_access_token")
    if not token:
        return None, (jsonify({"error": "not_authenticated"}), 401)
    return token, None


def _oauth_headers(token):
    return {"Authorization": f"Bearer {token}"}


def _fetch_osm_user(token):
    resp = requests.get(f"{OSM_API}/user/details.json", headers=_oauth_headers(token), timeout=20)
    resp.raise_for_status()
    return resp.json()


def _build_changeset_xml(comment, source, tags):
    if not comment:
        raise ValueError("changeset comment required")
    changeset_tags = {
        "comment": comment,
        "created_by": "OpenEVmap",
        "source": source or "survey",
    }
    changeset_tags.update(tags or {})
    tags_xml = "".join(
        f'<tag k="{k}" v="{v}"/>' for k, v in changeset_tags.items() if v is not None
    )
    return f"""<osm>
  <changeset>
    {tags_xml}
  </changeset>
</osm>"""


def _normalize_tags(tags):
    out = {}
    for key, value in (tags or {}).items():
        if key not in ALLOWED_TAGS:
            continue
        if value is None:
            continue
        value = str(value).strip()
        if value == "":
            continue
        out[key] = value
    if "amenity" not in out:
        out["amenity"] = "charging_station"
    return out


@app.route("/")
def index():
    return render_template("index.html", mapbox_token=MAPBOX_TOKEN)


@app.route("/auth/osm")
def auth_osm():
    cfg = _get_oauth_config()
    if not cfg["client_id"] or not cfg["client_secret"]:
        return "Missing OSM_CLIENT_ID/OSM_CLIENT_SECRET. Set them in .env and restart.", 500
    base_url = cfg["base_url"] or request.host_url.rstrip("/")
    params = {
        "response_type": "code",
        "client_id": cfg["client_id"],
        "redirect_uri": f"{base_url}/auth/osm/callback",
        "scope": "read_prefs write_api",
        "state": str(int(time.time())),
    }
    return redirect(f"{OSM_OAUTH_AUTHORIZE}?{urlencode(params)}")


@app.route("/auth/osm/callback")
def auth_osm_callback():
    code = request.args.get("code")
    if not code:
        return "Missing code", 400
    cfg = _get_oauth_config()
    base_url = cfg["base_url"] or request.host_url.rstrip("/")
    data = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": f"{base_url}/auth/osm/callback",
    }
    token_resp = requests.post(
        OSM_OAUTH_TOKEN,
        data=data,
        auth=(cfg["client_id"], cfg["client_secret"]),
        timeout=20,
    )
    if not token_resp.ok:
        return (
            f"Token exchange failed ({token_resp.status_code}): {token_resp.text}",
            500,
        )
    token_json = token_resp.json()
    session["osm_access_token"] = token_json.get("access_token")

    try:
        user_json = _fetch_osm_user(session["osm_access_token"])
        session["osm_user"] = user_json.get("user", {})
    except Exception:
        session["osm_user"] = {}

    return redirect("/")


@app.route("/auth/logout", methods=["POST"])
def auth_logout():
    session.clear()
    return "ok"


@app.route("/api/me")
def api_me():
    token = session.get("osm_access_token")
    user = session.get("osm_user") or {}
    return jsonify({"authenticated": bool(token), "user": user})


@app.route("/api/pois")
def api_pois():
    bbox = request.args.get("bbox")
    if not bbox:
        return jsonify({"error": "bbox_required"}), 400
    try:
        west, south, east, north = [float(x) for x in bbox.split(",")]
    except ValueError:
        return jsonify({"error": "invalid_bbox"}), 400
    query = f"""[out:json][timeout:25];
(
  node["amenity"="charging_station"]({south},{west},{north},{east});
);
out center tags meta;"""
    last_error = None
    for api_url in OVERPASS_APIS:
        try:
            resp = requests.post(api_url, data=query, timeout=30)
            resp.raise_for_status()
            return jsonify(resp.json())
        except requests.exceptions.Timeout as exc:
            last_error = ("overpass_timeout", str(exc))
            continue
        except requests.exceptions.HTTPError as exc:
            status = exc.response.status_code if exc.response else 502
            last_error = ("overpass_error", status)
            continue
        except requests.exceptions.RequestException as exc:
            last_error = ("overpass_unavailable", str(exc))
            continue
    return jsonify({"error": "overpass_unavailable", "details": last_error}), 502


@app.route("/api/changeset", methods=["POST"])
def api_create_changeset():
    token, err = _require_auth()
    if err:
        return err
    payload = request.json or {}
    comment = payload.get("comment")
    source = payload.get("source")
    tags = payload.get("tags") or {}
    tags = _normalize_tags(tags)

    missing = [t for t in REQUIRED_TAGS if t not in tags]
    if missing:
        return jsonify({"error": "missing_tags", "tags": missing}), 400

    changeset_xml = _build_changeset_xml(comment, source, None)
    create_resp = requests.put(
        f"{OSM_API}/changeset/create",
        data=changeset_xml,
        headers=_oauth_headers(token),
        timeout=20,
    )
    create_resp.raise_for_status()
    changeset_id = create_resp.text.strip()

    lat = payload.get("lat")
    lon = payload.get("lon")
    if lat is None or lon is None:
        return jsonify({"error": "missing_coordinates"}), 400

    tags_xml = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
    node_xml = f"""<osm>
  <node changeset=\"{changeset_id}\" lat=\"{lat}\" lon=\"{lon}\">
    {tags_xml}
  </node>
</osm>"""
    node_resp = requests.put(
        f"{OSM_API}/node/create",
        data=node_xml,
        headers=_oauth_headers(token),
        timeout=20,
    )
    node_resp.raise_for_status()
    node_id = node_resp.text.strip()

    close_resp = requests.put(
        f"{OSM_API}/changeset/{changeset_id}/close",
        headers=_oauth_headers(token),
        timeout=20,
    )
    close_resp.raise_for_status()

    return jsonify({"changeset_id": changeset_id, "node_id": node_id})


@app.route("/api/changeset/update", methods=["PATCH"])
def api_update_poi():
    token, err = _require_auth()
    if err:
        return err

    payload = request.json or {}
    comment = payload.get("comment")
    source = payload.get("source")
    tags = payload.get("tags") or {}
    tags = _normalize_tags(tags)

    elem_type = payload.get("type")
    elem_id = payload.get("id")
    version = payload.get("version")
    lat = payload.get("lat")
    lon = payload.get("lon")

    if elem_type not in ["node"]:
        return jsonify({"error": "invalid_type"}), 400
    if not elem_id or not version:
        return jsonify({"error": "missing_id_version"}), 400
    if lat is None or lon is None:
        return jsonify({"error": "missing_coordinates"}), 400

    changeset_xml = _build_changeset_xml(comment, source, None)
    create_resp = requests.put(
        f"{OSM_API}/changeset/create",
        data=changeset_xml,
        headers=_oauth_headers(token),
        timeout=20,
    )
    create_resp.raise_for_status()
    changeset_id = create_resp.text.strip()

    tags_xml = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
    update_xml = f"""<osm>
  <{elem_type} id=\"{elem_id}\" version=\"{version}\" changeset=\"{changeset_id}\">
    {tags_xml}
  </{elem_type}>
</osm>"""
    update_resp = requests.put(
        f"{OSM_API}/{elem_type}/{elem_id}",
        data=update_xml,
        headers=_oauth_headers(token),
        timeout=20,
    )
    update_resp.raise_for_status()

    close_resp = requests.put(
        f"{OSM_API}/changeset/{changeset_id}/close",
        headers=_oauth_headers(token),
        timeout=20,
    )
    close_resp.raise_for_status()

    return jsonify({"changeset_id": changeset_id, "updated": True})


@app.route("/api/changeset/batch", methods=["POST"])
def api_batch_update():
    token, err = _require_auth()
    if err:
        return err

    payload = request.json or {}
    comment = payload.get("comment")
    source = payload.get("source")
    updates = payload.get("updates") or []

    if not updates:
        return jsonify({"error": "no_updates"}), 400

    changeset_xml = _build_changeset_xml(comment, source, None)
    create_resp = requests.put(
        f"{OSM_API}/changeset/create",
        data=changeset_xml,
        headers=_oauth_headers(token),
        timeout=20,
    )
    create_resp.raise_for_status()
    changeset_id = create_resp.text.strip()

    try:
        for update in updates:
            elem_type = update.get("type")
            elem_id = update.get("id")
            version = update.get("version")
            lat = update.get("lat")
            lon = update.get("lon")
            tags = _normalize_tags(update.get("tags") or {})
            if elem_type not in ["node"]:
                return jsonify({"error": "invalid_type", "item": update}), 400
            if not elem_id or not version:
                return jsonify({"error": "missing_id_version", "item": update}), 400
            if lat is None or lon is None:
                return jsonify({"error": "missing_coordinates", "item": update}), 400

            tags_xml = "".join(f'<tag k="{k}" v="{v}"/>' for k, v in tags.items())
            update_xml = f"""<osm>
  <{elem_type} id="{elem_id}" version="{version}" changeset="{changeset_id}" lat="{lat}" lon="{lon}">
    {tags_xml}
  </{elem_type}>
</osm>"""
            update_resp = requests.put(
                f"{OSM_API}/{elem_type}/{elem_id}",
                data=update_xml,
                headers=_oauth_headers(token),
                timeout=20,
            )
            if not update_resp.ok:
                return (
                    jsonify(
                        {
                            "error": "update_failed",
                            "status": update_resp.status_code,
                            "details": update_resp.text,
                            "item": update,
                        }
                    ),
                    400,
                )
    finally:
        try:
            requests.put(
                f"{OSM_API}/changeset/{changeset_id}/close",
                headers=_oauth_headers(token),
                timeout=20,
            )
        except requests.RequestException:
            pass

    return jsonify({"changeset_id": changeset_id, "updated": len(updates)})


if __name__ == "__main__":
    port = int(os.environ.get("PORT", "5891"))
    app.run(debug=True, port=port)
