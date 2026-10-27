# iOS handoff: Essentials auction cards show the profile photo, not the QHP photo (27 Oct 2026)

Owner: "in Essentials, the client's photo currently comes from the QHP; remove that connection and show the photo
whose URL is in profiles.avatar_url". Android commit of 27 Oct 2026. No SQL.

## The change
`useAuctionClientPhotos(clientIds)` in `src/lib/essentialsAuctionQueries.ts` stops reading `qhp_details` and reads:
```ts
supabase.from('clients').select('id, profiles:profile_id(avatar_url)').in('id', ids)
```
Map `client id -> avatar_url` when the value is an `http(s)` URL (it is a public `avatars` bucket URL such as
`https://<project>.supabase.co/storage/v1/object/public/avatars/<uid>/avatar.jpg`). The embed shape can be an
object or a one-element array (`Array.isArray(r.profiles) ? r.profiles[0] : r.profiles`). Any error → `{}` and the
cards show initials. Query key `['essentials-auction-photos', 'v2', ids]`, staleTime 5 min. Trainers and physios can
read the embed (probed as Sagar).

## Copy
- Thumbnail accessibility label: "NAME, profile photo".
- Under the name when a photo exists: "TAP THE PHOTO TO SEE IT LARGE" (was "TAP THE PHOTO FOR THE QHP FRONT VIEW").
- Lightbox title: "NAME · PROFILE PHOTO" (was "· QHP FRONT VIEW").
- The quiz sheet (`AuctionQuizSheet`) only receives the URL; no change.

## Today
No Essentials client has an avatar yet (0 client profiles with `avatar_url`), so every card shows initials until the
clients upload a photo in the client app. The card and lightbox code paths are unchanged otherwise.
