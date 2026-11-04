import secrets

from django.db import migrations, models
import django.utils.timezone


def populate_cards(apps, schema_editor):
    Card = apps.get_model('banking', 'VirtualCard')
    for card in Card.objects.using(schema_editor.connection.alias).all().iterator():
        while True:
            stem = '4' + ''.join(str(secrets.randbelow(10)) for _ in range(14))
            total = sum((d * 2 - 9 if d * 2 > 9 else d * 2) if i % 2 == 0 else d
                        for i, d in enumerate(map(int, stem)))
            number = stem + str(-total % 10)
            if not Card.objects.using(schema_editor.connection.alias).filter(number=number).exists():
                break
        card.number = number
        card.security_code = f'{secrets.randbelow(1000):03d}'
        card.issued_at = card.created_at
        card.save(update_fields=['number', 'security_code', 'issued_at'])


class Migration(migrations.Migration):
    dependencies = [('banking', '0005_account_address_account_payment_locked_account_phone_and_more')]
    operations = [
        migrations.AddField(model_name='virtualcard', name='network', field=models.CharField(choices=[('visa', 'VISA'), ('rupay', 'RuPay'), ('mastercard', 'Mastercard')], default='visa', max_length=10)),
        migrations.AddField(model_name='virtualcard', name='number', field=models.CharField(editable=False, max_length=16, null=True, unique=True)),
        migrations.AddField(model_name='virtualcard', name='security_code', field=models.CharField(default='', editable=False, max_length=3), preserve_default=False),
        migrations.AddField(model_name='virtualcard', name='issued_at', field=models.DateTimeField(default=django.utils.timezone.now)),
        migrations.RunPython(populate_cards, migrations.RunPython.noop),
        migrations.AlterField(model_name='virtualcard', name='number', field=models.CharField(editable=False, max_length=16, unique=True)),
    ]
