import os
import json
import time
import logging
import functions_framework
import google.auth
from google.auth.transport.requests import Request
import requests
from requests.adapters import HTTPAdapter
from urllib3.util import Retry

PROJECT_ID = os.environ.get("PROJECT_ID", "YOUR_PROJECT_ID")
REGION = os.environ.get("REGION", "us-central1")
CLUSTER_ID = os.environ.get("CLUSTER_ID", "alloydb-psa-cluster")
PRIMARY_INSTANCE = os.environ.get("PRIMARY_INSTANCE", "alloydb-psa-instance")
READ_POOL_INSTANCE = os.environ.get("READ_POOL_INSTANCE", "alloydb-psa-instance-read-pool")

def create_session():
    session = requests.Session()
    retries = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[500, 502, 503, 504],
        raise_on_status=False
    )
    session.mount("https://", HTTPAdapter(max_retries=retries))
    return session

def get_auth_headers(credentials):
    if not credentials.valid:
        credentials.refresh(Request())
    return {
        "Authorization": f"Bearer {credentials.token}",
        "Content-Type": "application/json",
        "Connection": "close"  # Force fresh connection to avoid urllib3 socket drops on Google API endpoints
    }

def get_instance_state(session, credentials, instance_id):
    url = f"https://alloydb.googleapis.com/v1/projects/{PROJECT_ID}/locations/{REGION}/clusters/{CLUSTER_ID}/instances/{instance_id}"
    for attempt in range(3):
        try:
            headers = get_auth_headers(credentials)
            res = session.get(url, headers=headers, timeout=15)
            if res.status_code == 200:
                return res.json().get('state')
        except Exception as e:
            logging.warning(f"Attempt {attempt + 1} failed getting state for {instance_id}: {e}")
            time.sleep(2)
    return None

def set_activation_policy(session, credentials, instance_id, policy):
    url = f"https://alloydb.googleapis.com/v1/projects/{PROJECT_ID}/locations/{REGION}/clusters/{CLUSTER_ID}/instances/{instance_id}?updateMask=activationPolicy"
    body = {"activationPolicy": policy}
    for attempt in range(3):
        try:
            headers = get_auth_headers(credentials)
            res = session.patch(url, headers=headers, json=body, timeout=15)
            if res.status_code in [200, 202]:
                return res.json()
            return res.json()
        except Exception as e:
            logging.warning(f"Attempt {attempt + 1} failed setting policy for {instance_id}: {e}")
            time.sleep(2)
    return {"error": "Failed to update activation policy after retries"}

@functions_framework.http
def manage_cluster(request):
    """
    HTTP Cloud Function to start or pause an AlloyDB cluster.
    Expected request: JSON body {"action": "start"} or {"action": "pause"} 
    or query param ?action=start / ?action=pause
    """
    request_json = request.get_json(silent=True) or {}
    action = request.args.get('action') or request_json.get('action')
    
    if action not in ['start', 'pause', 'stop']:
        return (json.dumps({'error': 'Invalid action. Must be "start", "pause", or "stop"'}), 400, {'Content-Type': 'application/json'})

    credentials, _ = google.auth.default(scopes=["https://www.googleapis.com/auth/cloud-platform"])
    session = create_session()

    results = {}
    if action == "start":
        # 1. Start Primary instance first if not READY
        primary_state = get_instance_state(session, credentials, PRIMARY_INSTANCE)
        if primary_state != "READY":
            if primary_state != "STARTING":
                results[PRIMARY_INSTANCE] = set_activation_policy(session, credentials, PRIMARY_INSTANCE, "ALWAYS")
            else:
                results[PRIMARY_INSTANCE] = {"status": "Already STARTING"}
            
            # Wait for Primary to become READY before starting Read Pool
            start_time = time.time()
            while time.time() - start_time < 280:
                time.sleep(10)
                state = get_instance_state(session, credentials, PRIMARY_INSTANCE)
                if state == "READY":
                    break
        else:
            results[PRIMARY_INSTANCE] = {"status": "Already READY"}

        # 2. Start Read Pool instance
        read_pool_state = get_instance_state(session, credentials, READ_POOL_INSTANCE)
        if read_pool_state != "READY":
            if read_pool_state != "STARTING":
                results[READ_POOL_INSTANCE] = set_activation_policy(session, credentials, READ_POOL_INSTANCE, "ALWAYS")
            else:
                results[READ_POOL_INSTANCE] = {"status": "Already STARTING"}
        else:
            results[READ_POOL_INSTANCE] = {"status": "Already READY"}

    else:
        # Pause: Stop Read Pool first, then Primary
        read_pool_state = get_instance_state(session, credentials, READ_POOL_INSTANCE)
        if read_pool_state != "STOPPED":
            if read_pool_state != "STOPPING":
                results[READ_POOL_INSTANCE] = set_activation_policy(session, credentials, READ_POOL_INSTANCE, "NEVER")
            else:
                results[READ_POOL_INSTANCE] = {"status": "Already STOPPING"}
            
            start_time = time.time()
            while time.time() - start_time < 280:
                time.sleep(10)
                state = get_instance_state(session, credentials, READ_POOL_INSTANCE)
                if state == "STOPPED":
                    break
        else:
            results[READ_POOL_INSTANCE] = {"status": "Already STOPPED"}

        primary_state = get_instance_state(session, credentials, PRIMARY_INSTANCE)
        if primary_state != "STOPPED":
            if primary_state != "STOPPING":
                results[PRIMARY_INSTANCE] = set_activation_policy(session, credentials, PRIMARY_INSTANCE, "NEVER")
            else:
                results[PRIMARY_INSTANCE] = {"status": "Already STOPPING"}
        else:
            results[PRIMARY_INSTANCE] = {"status": "Already STOPPED"}

    return (json.dumps({'status': f'Cluster {action} processed successfully', 'results': results}), 200, {'Content-Type': 'application/json'})
