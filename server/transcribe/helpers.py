from pathlib import Path
from django.conf import settings
import os
import json
import time
import requests
import logging

logger = logging.getLogger(__name__)


def _read_cache(audio_file_path: str):
    # TODO: Read from s3 or some cloud object store
    cache_dir = Path(settings.BASE_DIR) / "transcript_cache"
    cache_dir.mkdir(exist_ok=True)

    # # TODO: REMOVE LATER. Find the first JSON file and return it
    # json_files = list(cache_dir.glob("*.json"))
    # if json_files:
    #     # Use the first JSON file found
    #     cache_file = json_files[0]
    #     logger.info(f"Using cached transcript from {cache_file.name}")

    cache_file = cache_dir / f"{os.path.basename(audio_file_path)}.json"  # TODO: Uncomment later
    if cache_file.exists():
        with open(cache_file, "r") as f:
            return json.load(f)

    logger.info("No cached transcripts found")
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

    # _existing_response_cache = _read_cache(audio_file_path)
    # if _existing_response_cache:
    #     return _existing_response_cache  # RETURN CACHE DURING DEV: REMOVE LATER

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


def preprocess_transcript(transcript_data: dict) -> dict:
    """
    Preprocess the transcript data to group words into sentences by speaker.

    Args:
        transcript_data: Raw transcript data from Deepgram API

    Returns:
        dict: Processed transcript with sentences grouped by speaker
    """
    # Get the words from the transcript data
    words = (
        transcript_data.get("results", {})
        .get("channels", [{}])[0]
        .get("alternatives", [{}])[0]
        .get("words", [])
    )

    if not words:
        return {"sentences": []}

    # Group words by speaker
    sentences = []
    current_sentence = None
    current_speaker = None

    for i, word in enumerate(words):
        if current_sentence is None or word["speaker"] != current_speaker:
            # Start a new sentence if we're starting or changing speaker
            if current_sentence:
                sentences.append(current_sentence)
            current_sentence = {
                "sentence_id": i,
                "sentence": word["punctuated_word"],
                "start": word["start"],
                "end": word["end"],
                "speaker": word["speaker"],
                "speaker_name": f"Speaker {word['speaker']}",
                # TODO: update this ^ with who the speaker is. Doctor/Patient/Family
            }
            current_speaker = word["speaker"]
        else:
            # Continue the current sentence
            current_sentence["sentence"] += f" {word['punctuated_word']}"
            current_sentence["end"] = word["end"]

    # Add the last sentence if it exists
    if current_sentence:
        sentences.append(current_sentence)

    return {"sentences": sentences}
