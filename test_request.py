import requests
import json

url = "http://127.0.0.1:3000/api/analyze"
payload = {"claim": "The moon landing was faked in a studio by Stanley Kubrick."}

try:
    response = requests.post(url, json=payload)
    print("STATUS:", response.status_code)
    print(json.dumps(response.json(), indent=2))
except Exception as e:
    print("ERROR:", e)
