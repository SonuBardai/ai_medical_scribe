from ninja import Router, Schema
import logging
from visits.models import Visit

logger = logging.getLogger(__name__)

router = Router()


class SpeakerUpdateSchema(Schema):
    speaker: int
    speaker_name: str
    visit_id: int


@router.post("/update_speaker")
def update_speaker(request, data: SpeakerUpdateSchema):
    try:
        visit = Visit.objects.get(id=data.visit_id)

        # Get existing speaker mapping or create new one
        speaker_mapping = visit.transcript_json.get("speaker_mapping", {})

        # Update the mapping
        speaker_mapping[data.speaker] = data.speaker_name

        # Update the transcript_json with new mapping
        visit.transcript_json["speaker_mapping"] = speaker_mapping
        visit.save()

        return {"success": True, "message": "Speaker mapping updated successfully"}
    except Visit.DoesNotExist:
        return {"success": False, "message": "Visit not found"}
    except Exception as e:
        logger.error(f"Error updating speaker: {str(e)}")
        return {"success": False, "message": str(e)}
