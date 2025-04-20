from django.db import models
from django.utils import timezone


class Visit(models.Model):
    audio_file = models.FileField(upload_to="audio/", null=True, blank=True)
    transcript_text = models.TextField(null=True, blank=True)
    transcript_json = models.JSONField(null=True, blank=True)
    draft_soap_note = models.TextField(null=True, blank=True)
    final_soap_note = models.TextField(null=True, blank=True)
    # doctor_id = models.IntegerField(null=True, blank=True)  # these will be foreign key fields once we have Doctor and Patient models
    # patient_id = models.IntegerField(null=True, blank=True)
    created_at = models.DateTimeField(default=timezone.now)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Visit {self.id} - {self.created_at.strftime('%Y-%m-%d %H:%M:%S')}"
