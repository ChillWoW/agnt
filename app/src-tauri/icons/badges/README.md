# Taskbar overlay badges

`1.png` .. `9.png` and `9plus.png` are 32x32 RGBA PNGs used as Windows
taskbar overlay icons to show unread conversation/permission/question
count. They are resolved at runtime by the `set_unread_badge` Tauri
command in `app/src-tauri/src/lib.rs`.

To regenerate after tweaking colors or the font:

```
bun run app/src-tauri/icons/badges/generate-badges.ts
```

Bundled into release builds via the `"icons/badges/*"` entry in
`bundle.resources` inside `app/src-tauri/tauri.conf.json`.
