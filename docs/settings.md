# Settings

## User Identity

The settings page now exposes the Cognito-backed profile attributes that this application allows users to edit directly:

- `given_name`
- `family_name`
- `locale`
- `address`
- `gender`
- `nickname`
- `phone_number`
- `website`
- `custom:organization`

These values are stored in the Cognito user pool, not in an application database table.

### Notes

- `phone_number` should use E.164 format, for example `+12065550123`.
- `locale` should use a BCP 47 language tag, for example `en-US`.
- `website` should be a valid `http://` or `https://` URL.

The Cognito `updated_at` claim is not configurable as an editable profile field in this stack, so it is not exposed in settings.

If Cognito requires verification for an updated attribute, the UI surfaces that after save.
