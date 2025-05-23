# Generated by Django 5.0.6 on 2025-04-20 04:26

import django.utils.timezone
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
    ]

    operations = [
        migrations.CreateModel(
            name='Visit',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('audio_file', models.FileField(blank=True, null=True, upload_to='audio/')),
                ('transcript_text', models.TextField(blank=True, null=True)),
                ('transcript_json', models.JSONField(blank=True, null=True)),
                ('draft_soap_note', models.TextField(blank=True, null=True)),
                ('final_soap_note', models.TextField(blank=True, null=True)),
                ('created_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
        ),
    ]
