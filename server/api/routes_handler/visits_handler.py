from ninja import Router
from django.core.files.base import ContentFile
from visits.models import Visit
from django.http import JsonResponse

router = Router()


@router.post("/visits", tags=["Visits"])
def create_visit(request):
    visit = Visit.objects.create()
    return JsonResponse({"visit_id": visit.id})


@router.post("/visits/{visit_id}/audio", tags=["Visits"])
def upload_audio(request, visit_id: int):
    try:
        visit = Visit.objects.get(id=visit_id)
        audio_file = request.FILES.get("audio")
        if audio_file:
            visit.audio_file.save(
                f"visit_{visit_id}_{audio_file.name}", ContentFile(audio_file.read())
            )
            visit.save()
            return JsonResponse({"status": "success"})
        return JsonResponse({"error": "No audio file provided"}, status=400)
    except Visit.DoesNotExist:
        return JsonResponse({"error": "Visit not found"}, status=404)
    except Exception as e:
        return JsonResponse({"error": str(e)}, status=500)
