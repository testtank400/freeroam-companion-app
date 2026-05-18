# Character Cards TODO

## Completed Features
- [x] Live API integration with getfreeroam.com (server-side cookie proxy)
- [x] Character grid with headshots, backstory previews, and privacy badges
- [x] Collections system with portrait cards and collection view
- [x] Multi-select system (Ctrl/Cmd and Shift-click) with bulk actions
- [x] Character profile modal with About and Appearance tabs
- [x] Tags section in profile modal (fandom and regular tags with emojis)
- [x] Search and filtering (name, privacy, favorites, personas)
- [x] CRUD operations (create, edit, duplicate, favorite, delete characters/collections)
- [x] Characters in collections hidden from main roster
- [x] Favorites chip with live count badge
- [x] Collection cards with cover images and character counts
- [x] Edit collection modal with name, description, and cover image upload
- [x] Bulk action bar with Add to Collection, Favorite/Unfavorite, and Clear
- [x] Add dropdown menu (Character + Collection creation)
- [x] Save/Saved button in profile modal header
- [x] Enlarged scrollbar (14px width, easier to grab, tactical amber styling)

## Pending Features
- [x] Migrate collections from localStorage to Manus database (persist across devices)
- [x] Fix mobile responsiveness: header layout on small screens
- [x] Fix mobile responsiveness: filter chips row (overflow/wrapping)
- [x] Fix mobile responsiveness: character grid columns on mobile
- [x] Fix mobile responsiveness: collections strip on mobile
- [x] Add character_extended DB table to store full unlimited backstory/appearance
- [x] Server: trim content to Freeroam limits on create/update, parse limit from error response
- [x] Server: save full content to character_extended after successful sync
- [x] Client: load full content from character_extended when editing/viewing
- [x] Client: show trim warning toast with actual limit from Freeroam response
- [x] Add character_nsfw DB table (character_id, is_nsfw) for NSFW flag storage
- [x] Add tRPC procedures: getNsfw (batch fetch flags), toggleNsfw (flip flag for one character)
- [x] Add NSFW toggle button in CharacterProfile modal action bar
- [x] Add SFW filter chip to hide NSFW-tagged characters from the main grid
- [x] Fix search: scope to collection members when inside a collection, search all when outside
- [ ] Headshot upload/linking for characters
- [ ] Cover image upload/linking for collections (partially done - URL input works)
- [ ] Advanced filtering options
- [ ] Character export/import
- [ ] Collection sharing
