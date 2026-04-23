# Vendors

Vendors are companies whose product teams sponsor events and become reachable
to members on connection.

## Data model

- `Vendor { id, name, tagline, description, logoUrl, website, tags[] }`
- `VendorContact { id, name, role: "sales" | "technical_sales", email, phone }`
- Edge `HAS_CONTACT: Vendor → VendorContact`.
- Edge `FEATURES: Event → Vendor` surfaces the vendor on event pages.

## Admin workflow

Admins create vendors at
[`/admin/vendors/new`](../app/web/src/routes/_authenticated/_layout/admin/vendors/new.tsx).
The form creates the `Vendor` vertex plus one `VendorContact` vertex and
`HAS_CONTACT` edge per row.

## Contact reveal

Email and phone on `VendorContact` are **not returned** by `listVendors` or
`getVendor` unless the caller has a `CONNECTED_WITH(status=connected)` edge
to a vendor-team member (see [members.md](./members.md)). The gating happens
inside `api/lambda/social.ts` — UI is just the consumer.
