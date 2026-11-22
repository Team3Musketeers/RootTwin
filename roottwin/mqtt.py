"""Small MQTT publisher shared by the command API, scenario runner and scripts."""
from __future__ import annotations

import json
import os
import threading

import paho.mqtt.client as mqtt

from roottwin.contracts import Command, command_topic


class MqttPublisher:
    def __init__(self, host: str | None = None, port: int | None = None, client_id: str = "roottwin-pub"):
        self.host = host or os.getenv("MQTT_HOST", "localhost")
        self.port = int(port or os.getenv("MQTT_PORT", "1883"))
        self._client = mqtt.Client(mqtt.CallbackAPIVersion.VERSION2, client_id=client_id)
        self._client.reconnect_delay_set(min_delay=1, max_delay=10)
        self._lock = threading.Lock()
        self._started = False

    def start(self) -> "MqttPublisher":
        if not self._started:
            self._client.connect(self.host, self.port, keepalive=30)
            self._client.loop_start()
            self._started = True
        return self

    def stop(self) -> None:
        if self._started:
            self._client.loop_stop()
            self._client.disconnect()
            self._started = False

    def publish_json(self, topic: str, body: dict | str, qos: int = 1, timeout: float = 5.0) -> None:
        payload = body if isinstance(body, str) else json.dumps(body, default=str)
        with self._lock:
            info = self._client.publish(topic, payload, qos=qos)
        info.wait_for_publish(timeout=timeout)
        if not info.is_published():
            raise ConnectionError(f"MQTT publish to {topic} not acknowledged")

    def send_command(self, line_id: str, target: str, cmd: Command) -> str:
        topic = command_topic(line_id, target, cmd)
        self.publish_json(topic, cmd.model_dump_json())
        return topic

    def __enter__(self) -> "MqttPublisher":
        return self.start()

    def __exit__(self, *exc) -> None:
        self.stop()
