from django.db import migrations, models
import banking.models


def preserve_account_numbers(apps, schema_editor):
    Account = apps.get_model("banking", "Account")
    for account in Account.objects.using(schema_editor.connection.alias).filter(
        account_number__isnull=True
    ).iterator():
        Account.objects.using(schema_editor.connection.alias).filter(
            pk=account.pk, account_number__isnull=True
        ).update(account_number=f"90{account.pk:010d}")


class Migration(migrations.Migration):
    dependencies = [("banking", "0002_googleidentity")]

    operations = [
        migrations.AddField(
            model_name="account",
            name="account_number",
            field=models.CharField(editable=False, max_length=12, null=True, unique=True),
        ),
        migrations.RunPython(preserve_account_numbers),
        migrations.AlterField(
            model_name="account",
            name="account_number",
            field=models.CharField(
                default=banking.models.generate_account_number,
                editable=False, max_length=12, null=True, unique=True,
            ),
        ),
    ]
