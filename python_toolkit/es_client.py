#!/usr/bin/env python3
"""
Python Elasticsearch REST API Client
Uses Python's standard library (urllib.request) to execute Elasticsearch queries.
Zero third-party dependencies required.
"""

import json
import urllib.request
import urllib.error

INDEX_NAME = "web-server-logs"

ES_MAPPING = {
    "settings": {
        "number_of_shards": 1,
        "number_of_replicas": 0
    },
    "mappings": {
        "properties": {
            "@timestamp": {"type": "date"},
            "client_ip": {"type": "ip", "fields": {"keyword": {"type": "keyword"}}},
            "http_method": {"type": "keyword"},
            "endpoint": {
                "type": "text",
                "fields": {"raw": {"type": "keyword"}}
            },
            "status_code": {"type": "integer"},
            "status_group": {"type": "keyword"},
            "response_size": {"type": "long"},
            "response_time_ms": {"type": "float"},
            "referrer": {"type": "keyword"},
            "user_agent": {"type": "text", "fields": {"keyword": {"type": "keyword", "ignore_above": 256}}},
            "is_error": {"type": "boolean"},
            "raw_message": {"type": "text"}
        }
    }
}

class PythonElasticsearchClient:
    def __init__(self, host="http://localhost:9200", index=INDEX_NAME):
        self.host = host.rstrip("/")
        self.index = index

    def _request(self, endpoint, method="GET", data=None, headers=None):
        url = f"{self.host}/{endpoint.lstrip('/')}"
        req_headers = {"Content-Type": "application/json"}
        if headers:
            req_headers.update(headers)

        body = None
        if data is not None:
            if isinstance(data, (dict, list)):
                body = json.dumps(data).encode("utf-8")
            elif isinstance(data, str):
                body = data.encode("utf-8")
            elif isinstance(data, bytes):
                body = data

        req = urllib.request.Request(url, data=body, headers=req_headers, method=method)
        try:
            with urllib.request.urlopen(req, timeout=10) as response:
                resp_body = response.read().decode("utf-8")
                return json.loads(resp_body) if resp_body else {}
        except urllib.error.HTTPError as e:
            err_body = e.read().decode("utf-8", errors="ignore")
            try:
                return json.loads(err_body)
            except Exception:
                raise Exception(f"HTTP {e.code}: {err_body}")
        except urllib.error.URLError as e:
            raise ConnectionError(f"Could not connect to Elasticsearch at {self.host}: {e.reason}")

    def ping(self):
        try:
            res = self._request("/")
            return "version" in res
        except Exception:
            return False

    def check_health(self):
        return self._request("/_cluster/health")

    def index_exists(self):
        try:
            self._request(f"/{self.index}", method="HEAD")
            return True
        except Exception:
            return False

    def create_index(self):
        return self._request(f"/{self.index}", method="PUT", data=ES_MAPPING)

    def delete_index(self):
        try:
            return self._request(f"/{self.index}", method="DELETE")
        except Exception as e:
            return {"error": str(e)}

    def bulk_index(self, docs):
        """Indexes documents using the high-performance Elasticsearch _bulk API."""
        if not docs:
            return {"count": 0}

        ndjson_lines = []
        for doc in docs:
            ndjson_lines.append(json.dumps({"index": {"_index": self.index}}))
            ndjson_lines.append(json.dumps(doc))
        ndjson_payload = "\n".join(ndjson_lines) + "\n"

        return self._request(
            "/_bulk",
            method="POST",
            data=ndjson_payload,
            headers={"Content-Type": "application/x-ndjson"}
        )

    def count(self):
        return self._request(f"/{self.index}/_count")

    def search(self, query):
        return self._request(f"/{self.index}/_search", method="POST", data=query)
