import json
from channels.generic.websocket import AsyncWebsocketConsumer


class SignalConsumer(AsyncWebsocketConsumer):
    async def connect(self):
        await self.accept()

    async def receive(self, text_data):
        data = json.loads(text_data)
        # Relay message to other peer if needed
        await self.send(text_data=json.dumps(data))
