from .models import Visit, Polling
from django.db import transaction
from pathlib import Path
from django.conf import settings
import os
import json
import time
import requests
import logging
from threading import Thread

logger = logging.getLogger(__name__)


def _read_cache(audio_file_path: str):
    # TODO: Read from s3 or some cloud object store
    cache_dir = Path(settings.BASE_DIR) / "transcript_cache"
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / f"{os.path.basename(audio_file_path)}.json"
    if cache_file.exists():
        with open(cache_file, "r") as f:
            return json.load(f)
    return None


def _write_cache(audio_file_path: str, transcript_data: dict):
    # TODO: Write to s3 or some cloud object store
    cache_dir = Path(settings.BASE_DIR) / "transcript_cache"
    cache_dir.mkdir(exist_ok=True)
    cache_file = cache_dir / f"{os.path.basename(audio_file_path)}.json"
    with open(cache_file, "w") as f:
        json.dump(transcript_data, f)


def get_transcript_from_deepgram(audio_file_path: str) -> dict:
    audio_size = os.path.getsize(audio_file_path)
    logger.info(f"Audio file size: {audio_size} bytes")

    _existing_response_cache = _read_cache(audio_file_path)
    if _existing_response_cache:
        return _existing_response_cache  # RETURN CACHE DURING DEV: REMOVE LATER

    start_time = time.time()

    # Read the audio file
    with open(audio_file_path, "rb") as f:
        audio_bytes = f.read()
    read_time = time.time() - start_time
    logger.info(f"Time taken to read audio file: {read_time:.2f} seconds")

    # Make the API request
    DG_API_KEY = os.getenv("DEEPGRAM_API_KEY")
    if not DG_API_KEY:
        raise ValueError("DEEPGRAM_API_KEY not found in environment variables")
    response = requests.post(
        "https://api.deepgram.com/v1/listen",
        params={"model": "nova-2-medical", "diarize": "true", "punctuate": "true"},
        headers={"Authorization": f"Token {DG_API_KEY}", "Content-Type": "audio/webm"},
        data=audio_bytes,
    )
    api_time = time.time() - start_time
    logger.info(f"Time taken for Deepgram API call: {api_time:.2f} seconds")
    if response.status_code != 200:
        raise Exception(f"Deepgram API error: {response.text}")
    transcript_data = response.json()

    _write_cache(audio_file_path, transcript_data)

    return transcript_data


def process_transcription(visit: Visit):
    try:
        Polling.objects.create(visit=visit, status="audio_processing_started")

        # Initial transcription
        with transaction.atomic():
            audio_file_path = visit.audio_file.path
            transcript_data = get_transcript_from_deepgram(audio_file_path)
            visit.transcript_text = (
                transcript_data.get("results", {})
                .get("channels", [{}])[0]
                .get("alternatives", [{}])[0]
                .get("transcript", "")
            )
            visit.transcript_json = transcript_data
            visit.save()

            Polling.objects.create(
                visit=visit,
                status="transcription_complete",
                completed=True,
                success=True,
            )

        # Detail extraction
        with transaction.atomic():
            # TODO: Implement actual detail extraction logic
            Polling.objects.create(
                visit=visit,
                status="details_extracted",
                completed=False,
                success=False,
            )

        # Text generation
        with transaction.atomic():
            # TODO: Implement actual text generation logic
            Polling.objects.create(
                visit=visit,
                status="text_generated",
                completed=False,
                success=False,
            )

        Polling.objects.create(
            visit=visit,
            status="completed",
            completed=True,
            success=True,
        )

    except Exception as e:
        Polling.objects.create(
            visit=visit,
            status="error",
            error=str(e),
            completed=True,
            success=False,
        )


def transcribe_audio(visit: Visit):
    thread = Thread(target=process_transcription, args=(visit,))
    thread.daemon = True
    thread.start()
